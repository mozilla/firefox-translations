/* eslint-disable no-case-declarations */
/* eslint-disable max-lines */
/* global LanguageDetection, browser, PingSender, BERGAMOT_VERSION_FULL,
Telemetry, loadFastText, FastText, Sentry, settings, deserializeError,
modelRegistryRootURL, modelRegistryRootURLTest, modelRegistry, AndroidUI, DOMPurify */

/*
 * we need the background script in order to have full access to the
 * WebExtensionAPI as also the privileged experiment APIs that we define
 * in controller/experiments. Although part of the controller,
 * this script does not have access to the page content, since it runs in the
 * extension's background process.
 */

const extensionVersion = browser.runtime.getManifest().version;
const scrubSentryEvent = ev => {

  /*
   * scrub extension installation id or any other url host
   * urls are also stripped on backend based on global PII rule for Mozilla org
   */
  const removeUrlHost = s => s.replace(/(moz-extension|http|https):\/\/[^/?#]*(.*)/gm, "$2");
  try {
    if (ev.request) Reflect.deleteProperty(ev.request, "url");
    for (let ex of ev.exception.values) {
      for (let frame of ex.stacktrace.frames) {
        frame.filename = removeUrlHost(frame.filename);
      }
    }
  } catch (ex) {
    console.error(ex)
    console.error("Error in scrubbing Sentry data. " +
      "Skipping to not propagate to global onerror and avoid sending sensitive data")
    return null;
  }
  if (settings.sentryDebug) console.info("Sentry event: ", ev);
  return ev;
}

const initializeSentry = () => {
  Sentry.init({
    dsn: settings.sentryDsn,
    tracesSampleRate: 1.0,
    debug: settings.sentryDebug,
    release: `firefox-translations@${extensionVersion}`,
    beforeSend: scrubSentryEvent,
    integrations(integrations) {
      // integrations will be all default integrations
      return integrations.filter(function(integration) {
        return integration.name !== "Breadcrumbs";
      });
    },
  });
}

window.addEventListener("load", function () {
  browser.storage.local.get({ errorCollectionConsent: true }).then(item => {
    if (item.errorCollectionConsent) {
      initializeSentry();
      console.log("Initializing Sentry");
    }
  });
});

let cachedEnvInfo = null;
let pingSender = new PingSender();
let modelFastText = null;
let modelFastTextReadyPromise = null;

let isBuiltInEnabled = null;
let telemetryByTab = new Map();
let pingByTab = new Set();
let translationRequestsByTab = new Map();
let outboundRequestsByTab = new Map();
const translateAsBrowseMap = new Map();
let isMochitest = false;
const languageModelFileTypes = ["model", "lex", "vocab", "qualityModel", "srcvocab", "trgvocab"];
const CACHE_NAME = "fxtranslations";
const FT_SCORE_THRESHOLD = 0.75;
const FT_SCORE_THRESHOLD_FREE_FORM = 0.5;
let popupPreLoadText = null;
let timeoutPopupPreLoadText = null;
let platform = "desktop";

const init = () => {
  browser.storage.local.get({ telemetryCollectionConsent: true }).then(item => {
    pingSender.setUploadEnabled(item.telemetryCollectionConsent);
  });
  if (platform === "desktop") {
    Sentry.wrap(async () => {
      cachedEnvInfo = await browser.experiments.telemetryEnvironment.getFxTelemetryMetrics();
      telemetryByTab.forEach(t => t.environment(cachedEnvInfo));
    });
  }
}

const getTelemetry = tabId => {
    if (!telemetryByTab.has(tabId)) {
        let telemetry = new Telemetry(pingSender);
        telemetryByTab.set(tabId, telemetry);
      telemetry.versions(extensionVersion, "?", BERGAMOT_VERSION_FULL);
        if (cachedEnvInfo) {
            telemetry.environment(cachedEnvInfo);
        }
    }
    return telemetryByTab.get(tabId);
}

const isFrameLoaded = async (tabId, frameId) => {
  let loadedFrames = await browser.webNavigation.getAllFrames({ tabId });
  for (let frame of loadedFrames) {
    if (frame.frameId === frameId) return true;
  }
  return false;
}

const onError = error => {
  // this means frame is already unloaded. Even though we check it, race conditions are still possible
  if (error.message.endsWith("Could not establish connection. Receiving end does not exist.")) {
    console.warn(error);
  } else throw error;
}

const submitPing = tabId => {
  if (pingByTab.has(tabId)) {
    getTelemetry(tabId).submit();
    pingByTab.delete(tabId);
  }
  telemetryByTab.delete(tabId);
  translationRequestsByTab.delete(tabId);
  outboundRequestsByTab.delete(tabId);
}

// eslint-disable-next-line max-lines-per-function,complexity
const messageListener = function(message, sender) {
  // eslint-disable-next-line complexity,max-lines-per-function
    Sentry.wrap(async() => {
      switch (message.command) {
        case "detectPageLanguage": {
          await modelFastTextReadyPromise;

          /*
           * call fasttext to detect the language of the snippet
           * extracted from the page
           */
          const cleanedWords = message.languageDetection.wordsToDetect
            .toLowerCase()
            .trim()
            .replace(/(\r\n|\n|\r)/gm, " ");
          const [score, ftLanguage] = modelFastText
            .predict(cleanedWords, 1, 0.0)
            .get(0);
          if (!sender.tab && score > FT_SCORE_THRESHOLD_FREE_FORM) {
            // this is coming from the popup. send and bail
            browser.runtime.sendMessage({
                command: "responseDetectPageLanguage",
                pageLanguage: Intl.getCanonicalLocales(ftLanguage.replace("__label__", ""))[0]
            });
            break;
          }
          let pageLanguage = "";

          if (score > FT_SCORE_THRESHOLD) {
            pageLanguage = ftLanguage.replace("__label__", "");
          } else if (message.languageDetection.htmlElementLanguage.length > 0) {
            pageLanguage = message.languageDetection.htmlElementLanguage.substring(0,2);
          } else {
            break;
          }

          /*
           * language detector returns "no" for Norwegian Bokmål ("nb")
           * so we need to default it to "nb", since that's what FF
           * localization mechanisms has set
           */
          if (pageLanguage === "no") pageLanguage = "nb"
          browser.tabs.sendMessage(sender.tab.id, {
            command: "responseDetectPageLanguage",
            pageLanguage: Intl.getCanonicalLocales(pageLanguage)[0],
            isAutoTranslateOn: translateAsBrowseMap.get(sender.tab.id)?.translatingAsBrowse
          })
          break;
        }
        case "monitorTabLoad":
          if (isBuiltInEnabled || (isBuiltInEnabled === null && await browser.experiments.translationbar.isBuiltInEnabled())) return;
          if (!await isFrameLoaded(sender.tab.id, sender.frameId)) return;
            browser.tabs.sendMessage(
                    sender.tab.id,
                    { command: "responseMonitorTabLoad", tabId: sender.tab.id },
                    { frameId: sender.frameId }
                    ).catch(onError);
            // loading of other frames may be delayed
            if (sender.frameId !== 0) {
              if (translationRequestsByTab.has(sender.tab.id)) {
                let requestMessage = translationRequestsByTab.get(sender.tab.id);
                if (!await isFrameLoaded(sender.tab.id, sender.frameId)) return;
                browser.tabs.sendMessage(
                  requestMessage.tabId,
                  {
                      command: "translationRequested",
                      tabId: requestMessage.tabId,
                      from: requestMessage.from,
                      to: requestMessage.to,
                      withOutboundTranslation: requestMessage.withOutboundTranslation,
                      withQualityEstimation: requestMessage.withQualityEstimation
                  },
                  { frameId: sender.frameId }
                ).catch(onError);
              }
              if (outboundRequestsByTab.has(sender.tab.id)) {
                if (!await isFrameLoaded(sender.tab.id, sender.frameId)) return;
                browser.tabs.sendMessage(
                    sender.tab.id,
                    outboundRequestsByTab.get(sender.tab.id),
                    { frameId: sender.frameId }
                  ).catch(onError);
              }
            }
            break;
        case "displayTranslationBar":

          // first thing is to check if the user does no want to see the translationbar offered
          const neverOfferTranslation = await browser.storage.local.get("neverOfferTranslation-check");
          if (neverOfferTranslation["neverOfferTranslation-check"]) return;

          /*
           * request the experiments API do display the infobar
           */

          // we fallback to english if the browser's language is not supported
          if (!message.languageDetection.languagesSupportedSet.has(message.languageDetection.navigatorLanguage)) {
            message.languageDetection.navigatorLanguage = "en";
          }
          let from = "en".concat(message.languageDetection.pageLanguage);
          let to = message.languageDetection.navigatorLanguage.substring(0,2).concat("en");
          if (from === "enen") from = to;
          if (to === "enen") to = from;

          // we then ask the api for the localized version of the language codes
          browser.tabs.sendMessage(
            sender.tab.id,
            {
              command: "localizedLanguages",
              localizedPageLanguage: await browser.experiments.translationbar
                .getLocalizedLanguageName(message.languageDetection.pageLanguage),
              localizedNavigatorLanguage: await browser.experiments.translationbar
                .getLocalizedLanguageName(message.languageDetection.navigatorLanguage),
              platform
            }
          );

          // we don't have the experiments API (neither OT) on android and the UI is rendered by the page using shadowroot, so we break here
          if (platform === "android") break;

          const isOutboundTranslationSupported = message.languageDetection.languagePairsSupportedSet.has(from) &&
            message.languageDetection.languagePairsSupportedSet.has(to);

          await browser.experiments.translationbar.show(
            sender.tab.id,
            message.languageDetection.pageLanguage,
            message.languageDetection.navigatorLanguage,
            {
              displayStatisticsMessage: browser.i18n.getMessage("displayStatisticsMessage"),
              outboundTranslationsMessage: browser.i18n.getMessage("outboundTranslationsMessage"),
              qualityEstimationMessage: browser.i18n.getMessage("errorHighlightingMessage"),
              surveyMessage: browser.i18n.getMessage("surveyMessage"),
              translateAsBrowseOn: browser.i18n.getMessage("translateAsBrowseOn"),
              translateAsBrowseOff: browser.i18n.getMessage("translateAsBrowseOff"),
              thisPageIsIn: browser.i18n.getMessage("translationBarPageIsIn"),
              translateButton: browser.i18n.getMessage("translationBarTranslateButton"),
              optionsButton: browser.i18n.getMessage("translationBarOptionsButton"),
              neverThisSiteLabel: browser.i18n.getMessage("translationBarNeverThisSiteLabel"),
              neverThisSiteAccesskey: browser.i18n.getMessage("translationBarNeverThisSiteAccesskey"),
              neverForLanguageLabel: browser.i18n.getMessage("neverForLanguageLabel", ["%S"]),
              neverForLanguageAccesskey: browser.i18n.getMessage("neverForLanguageAccesskey"),
              optionsMenuLabel: browser.i18n.getMessage("optionsMenuLabel"),
              optionsMenuAccesskey: browser.i18n.getMessage("optionsMenuAccesskey"),
              closeNotificationTooltip: browser.i18n.getMessage("closeNotification"),
              neverOfferTranslation: browser.i18n.getMessage("neverOfferTranslation")
            },
            false,
            {
              outboundtranslations: await browser.storage.local.get("outboundtranslations-check"),
              qualityestimations: await browser.storage.local.get("qualityestimations-check"),
              neverOfferTranslation
            },
            translateAsBrowseMap.get(sender.tab.id)
              ? translateAsBrowseMap.get(sender.tab.id)
              : { translatingAsBrowse: false }
            ,
            isOutboundTranslationSupported
          );
          break;
        case "translate":
          if (!await isFrameLoaded(sender.tab.id, sender.frameId)) return;
          // propagate translation message from iframe to top frame
          // eslint-disable-next-line require-atomic-updates
          message.frameId = sender.frameId;
          browser.tabs.sendMessage(
            message.tabId,
            message,
            { frameId: 0 }
          ).catch(onError);
          break;
        case "showSurvey":
          browser.tabs.create({ url:
              `https://qsurvey.mozilla.com/s3/Firefox-Translations?version=${extensionVersion}&from_lang=${message.from}&to_lang=${message.to}` });
          break;
        case "translationComplete":
          if (!await isFrameLoaded(sender.tab.id, message.translationMessage.frameId)) return;
          // propagate translation message from top frame to the source frame
          browser.tabs.sendMessage(
            message.tabId,
            message,
            { frameId: message.translationMessage.frameId }
          ).catch(onError);
          break;
        case "displayOutboundTranslation":
            outboundRequestsByTab.set(message.tabId, message)
            // propagate "display outbound" command from top frame to other frames
            browser.tabs.sendMessage(
                message.tabId,
                message
            );
            break;
        case "recordTelemetry":
          getTelemetry(message.tabId).record(message.type, message.category, message.name, message.value);
          break;

        case "reportTranslationStats": {
          let wps = getTelemetry(message.tabId).addAndGetTranslationTimeStamp(message.numWords, message.engineTimeElapsed);
          browser.tabs.sendMessage(
            message.tabId,
            {
              command: "updateStats",
              tabId: message.tabId,
              wps
            }
          );
        }
          break;

        case "reportOutboundStats":
          getTelemetry(message.tabId).addOutboundTranslation(message.textAreaId, message.text);
          break;

        case "reportQeStats":
          getTelemetry(message.tabId).addQualityEstimation(message.wordScores, message.sentScores);
          break;

        case "reportException":
          // eslint-disable-next-line no-case-declarations
          console.warn("Reporting content script error to Sentry", message.exception);
          Sentry.captureException(deserializeError(message.exception));
          break;

        case "enablePing":
            pingByTab.add(message.tabId);
            break;

        case "translationRequested":
          translationRequestsByTab.set(message.tabId, message);
          // requested for translation received. let's inform the mediator
          browser.tabs.sendMessage(
              message.tabId,
              {
                  command: "translationRequested",
                  tabId: message.tabId,
                  from: message.from,
                  to: message.to,
                  withOutboundTranslation: message.withOutboundTranslation,
                  withQualityEstimation: message.withQualityEstimation
              }
          ).catch(error => {
            // eslint-disable-next-line no-use-before-define
            sendUpdateProgress(message.tabId, ["updateProgress", "errorLoadingWasm"]);
            getTelemetry(message.tabId).record("counter", "errors", "translation");
            console.warn("Reporting error to Sentry");
            Sentry.captureException(error);
          });
          break;
        case "downloadLanguageModels":
          try {
            // eslint-disable-next-line no-use-before-define
            let models = await getLanguageModels(message.tabId, message.languagePairs);
            // pass the downloaded language models to the mediator
            if (message.tabId > 0) {
              browser.tabs.sendMessage(
                message.tabId,
                {
                    command: "responseDownloadLanguageModels",
                    tabId: message.tabId,
                    languageModels: models
                },
                { frameId: 0 }
              );
            } else {
              // send to popup
              browser.runtime.sendMessage({
                command: "responseDownloadLanguageModels",
                tabId: message.tabId,
                languageModels: models
              });
            }
          } catch (error) {
            // eslint-disable-next-line no-use-before-define
            sendUpdateProgress(message.tabId, ["updateProgress", "errorLoadingWasm"]);
            getTelemetry(message.tabId).record("counter", "errors", "model_load");
            console.warn("Reporting error to Sentry");
            Sentry.captureException(error);
          }
          break;
        case "updateProgress":
          if (platform === "android") {
            browser.tabs.sendMessage(
              message.tabId,
              {
                command: "updateProgress",
                progressMessage: message.progressMessage
              }
            );
          } else {
            browser.experiments.translationbar.updateProgress(
              message.tabId,
              message.progressMessage
            );
          }
          break;
        case "displayStatistics":

          /*
           * inform the mediator that the user wants to see statistics
           */
          browser.tabs.sendMessage(
            message.tabId,
            {
              command: "displayStatistics",
              tabId: message.tabId
            }
          );
          break;
        case "setStorage":
          await browser.storage.local.set(message.payload)
          break;
        case "translateAsBrowse":

          /*
           * we received a request to translate as browse. so this means
           * we need to record both the tabid, the website and the pagelanguage
           * so that when there's a navigation in this tab, site and samelanguage
           * we should automatically start the translation
           */
          translateAsBrowseMap.set(message.tabId, message.translatingAsBrowse);
          break;
        case "errorCollectionConsent":
          browser.storage.local.set({ errorCollectionConsent: message.consent });
          if (message.consent) {
            if (!Sentry.getCurrentHub().getClient()) {
              initializeSentry();
            } else {
              Sentry.getCurrentHub().getClient()
              .getOptions().enabled = true;
              console.log("Sentry enabled");
            }
          } else {
            Sentry.getCurrentHub().getClient()
            .getOptions().enabled = false;
            console.log("Sentry disabled");
          }
          break;
        case "telemetryCollectionConsent":
          browser.storage.local.set({ telemetryCollectionConsent: message.consent });
          pingSender.setUploadEnabled(message.consent);
          break;
        case "showChangelog":
          browser.storage.local.set({
            showChangelog: message.consent,

            /*
             * make sure the last version is the current one,
             * because it's only set when the changelog is shown.
             * otherwise, the changelog would show at the next browser start
             */
            lastVersion: extensionVersion,
          });
          break;
        case "openChangelog":
          browser.tabs.create({ url: browser.runtime.getURL("view/static/CHANGELOG.html") });

          break;
        case "refreshPage":
          browser.tabs.reload(message.tabId);
          break;
        case "returnLocalizedLanguages":
          const mapLangs = new Map();
          for (const [langPair,] of Object.entries(modelRegistry)) {
            const firstLang = langPair.substring(0, 2);
            const secondLang = langPair.substring(2, 4);
            // eslint-disable-next-line no-await-in-loop
            mapLangs.set(firstLang, await browser.experiments.translationbar.getLocalizedLanguageName(firstLang));
            // eslint-disable-next-line no-await-in-loop
            mapLangs.set(secondLang, await browser.experiments.translationbar.getLocalizedLanguageName(secondLang));
          }
          browser.runtime.sendMessage({
            command: "responseLocalizedLanguages",
            localizedLanguages: mapLangs,
            popupPreLoadText
          });
          popupPreLoadText = "";
          break;
        case "persistPopupInput":
          popupPreLoadText = message.text;
          // erase ater one minute
          if (timeoutPopupPreLoadText) clearTimeout(timeoutPopupPreLoadText);
          timeoutPopupPreLoadText = setTimeout(() => {
            popupPreLoadText = null
          }, 60000);
          break;
        default:
          // ignore
          break;
      }
    });
}

browser.runtime.getPlatformInfo().then(info => {
  if (info.os.toLowerCase() === "android") {
    platform = "android";
    browser.experiments.translationbar = new AndroidUI();
  }
  browser.runtime.onMessage.addListener(messageListener);
  browser.experiments.translationbar.onTranslationRequest.addListener(messageListener);
  init();
  const retrieveOptionsFromStorage = browser.storage.local.get(["displayedConsent", "lastVersion", "showChangelog"]);
  const isMochitestPromise = browser.experiments.translationbar.isMochitest();
  const isBuiltInEnabledPromise = browser.experiments.translationbar.isBuiltInEnabled();

  Promise.allSettled([
                      retrieveOptionsFromStorage,
                      isMochitestPromise,
                      isBuiltInEnabledPromise,
                    ]).then(values => {
    const { displayedConsent, lastVersion: lastVersionDisplayed, showChangelog } = values[0].value || {};
    isMochitest = values[1].value;

    if (!displayedConsent && !isMochitest) {
      browser.tabs.create({ url: browser.runtime.getURL("view/static/dataConsent.html") });
      browser.storage.local.set({ displayedConsent: true });
      browser.storage.local.set({ lastVersion: extensionVersion });
    } else if (showChangelog && displayedConsent && extensionVersion !== lastVersionDisplayed) {
      browser.tabs.create({
        active: true,
        url: browser.extension.getURL("view/static/CHANGELOG.html"),
      });
      browser.storage.local.set({ lastVersion: extensionVersion });
    }

    isBuiltInEnabled = values[2].value;
    if (!isBuiltInEnabled) {
      browser.tabs.onCreated.addListener(tab => browser.pageAction.show(tab.id));

      browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
        if (changeInfo.status === "complete" && !tab.pageActionShown) {
          browser.pageAction.show(tabId);
        }
      });
    }
  });
});

// loads fasttext (language detection) wasm module and model
modelFastTextReadyPromise =
  fetch(browser
    .runtime.getURL("model/static/languageDetection/fasttext_wasm.wasm"), { mode: "no-cors" })
    .then(function(response) {
        return response.arrayBuffer();
    })
    .then(function(wasmArrayBuffer) {
      return new Promise(resolve => {
        const modelUrl = browser.runtime.getURL("model/static/languageDetection/lid.176.ftz");
        const initialModule = {
            onRuntimeInitialized() {
                const ft = new FastText(initialModule);
                resolve(ft.loadModel(modelUrl));
            },
            wasmBinary: wasmArrayBuffer,
        };
        loadFastText(initialModule);
      });
    })
    .then(model => {
      modelFastText = model;
    });

// eslint-disable-next-line max-lines-per-function
browser.pageAction.onClicked.addListener(tab => {
    // eslint-disable-next-line max-lines-per-function
    Sentry.wrap(async () => {

        /*
         * if the user clicks the pageAction, we summon the infobar, and for that we
         * need to let the infobar api know that this is on demand-request, which
         * doesn't have a language detected, so for that reason we set the language
         * parameter as 'userrequest', in order to override the preferences.
         */
          let languageDetection = new LanguageDetection();

          /*
           * if the browser's language is not supported by the extension,
           * we default it to english
           */
          if (!languageDetection.isBrowserSupported()) languageDetection.navigatorLanguage = "en";

          if (platform === "android") {
            browser.tabs.sendMessage(
              tab.id,
              {
                command: "localizedLanguages",
                localizedPageLanguage: await browser.experiments.translationbar
                  .getLocalizedLanguageName(languageDetection.pageLanguage),
                localizedNavigatorLanguage: await browser.experiments.translationbar
                  .getLocalizedLanguageName(languageDetection.navigatorLanguage,),
                platform
              }
            );
            return;
          }

          browser.experiments.translationbar.show(
              tab.id,
              "userrequest",
              languageDetection.navigatorLanguage,
              {
                displayStatisticsMessage: browser.i18n.getMessage("displayStatisticsMessage"),
                outboundTranslationsMessage: browser.i18n.getMessage("outboundTranslationsMessage"),
                qualityEstimationMessage: browser.i18n.getMessage("errorHighlightingMessage"),
                surveyMessage: browser.i18n.getMessage("surveyMessage"),
                translateAsBrowseOn: browser.i18n.getMessage("translateAsBrowseOn"),
                translateAsBrowseOff: browser.i18n.getMessage("translateAsBrowseOff"),
                thisPageIsIn: browser.i18n.getMessage("translationBarPageIsIn"),
                translateButton: browser.i18n.getMessage("translationBarTranslateButton"),
                optionsButton: browser.i18n.getMessage("translationBarOptionsButton"),
                neverThisSiteLabel: browser.i18n.getMessage("translationBarNeverThisSiteLabel"),
                neverThisSiteAccesskey: browser.i18n.getMessage("translationBarNeverThisSiteAccesskey"),
                neverForLanguageLabel: browser.i18n.getMessage("neverForLanguageLabel", ["%S"]),
                neverForLanguageAccesskey: browser.i18n.getMessage("neverForLanguageAccesskey"),
                optionsMenuLabel: browser.i18n.getMessage("optionsMenuLabel"),
                optionsMenuAccesskey: browser.i18n.getMessage("optionsMenuAccesskey"),
                closeNotificationTooltip: browser.i18n.getMessage("closeNotification"),
                neverOfferTranslation: browser.i18n.getMessage("neverOfferTranslation")
              },
              true,
              {
                outboundtranslations: await browser.storage.local.get("outboundtranslations-check"),
                qualityestimations: await browser.storage.local.get("qualityestimations-check"),
                neverOfferTranslation: await browser.storage.local.get("neverOfferTranslation-check")
              },
              translateAsBrowseMap.get(tab.id)
              ? translateAsBrowseMap.get(tab.id)
              : { translatingAsBrowse: false },
              false
          );
    });
});

// here we remove the closed tabs from translateAsBrowseMap and submit telemetry
browser.tabs.onRemoved.addListener(tabId => {
  translateAsBrowseMap.delete(tabId);
  submitPing(tabId);
});

browser.tabs.onDetached.addListener(tabId => {
  translateAsBrowseMap.delete(tabId);
  browser.experiments.translationbar.onDetached(tabId);
  browser.tabs.sendMessage(
    tabId,
    { command: "onDetached" }
  );
});

browser.webNavigation.onCommitted.addListener(details => {
  // only send pings if the top frame navigates.
  if (details.frameId === 0) submitPing(details.tabId);
});

// return language models (as blobs) for language pairs
const getLanguageModels = async (tabId, languagePairs) => {
  let start = performance.now();

  let languageModelPromises = [];
  // eslint-disable-next-line no-use-before-define
  languagePairs.forEach(languagePair => languageModelPromises.push(getLanguageModel(tabId, languagePair)));
  let languageModels = await Promise.all(languageModelPromises);
  let end = performance.now();

  console.log(`Total Download time for all language model files: ${(end - start) / 1000}s`);
  getTelemetry(tabId).record("timespan", "performance", "model_download_time_num", end-start);

  let result = [];
  languageModels.forEach((languageModel, index) => {
    let clonedLanguagePair = { ...languagePairs[index] };
    clonedLanguagePair.languageModelBlobs = languageModel;
    clonedLanguagePair.precision = modelRegistry[clonedLanguagePair.name].model.name.endsWith("intgemm8.bin")
      ? "int8shiftAll"
      : "int8shiftAlphaAll";
    result.push(clonedLanguagePair);
  });
  return result;
};

const getLanguageModel = async (tabId, languagePair) => {
  let languageModelPromise = [];
  let filesToLoad = languageModelFileTypes
      .filter(fileType => fileType !== "qualityModel" || languagePair.withQualityEstimation)
      .filter(fileType => fileType in modelRegistry[languagePair.name]);
  filesToLoad.forEach(fileType => languageModelPromise.push(downloadFile(tabId, fileType, languagePair.name))); // eslint-disable-line no-use-before-define

  let buffers = await Promise.all(languageModelPromise);

  // create Blobs from buffers and return
  let files = {};
  buffers.forEach((buffer, index) => {
    files[filesToLoad[index]] = new Blob([buffer]);
  });
  return files;
};

// download files as buffers from given urls
const downloadFile = async (tabId, fileType, languagePairName) => {
  let modelURL = isMochitest
? modelRegistryRootURLTest
: modelRegistryRootURL;
  const fileName = `${modelURL}/${languagePairName}/${modelRegistry[languagePairName][fileType].name}`;
  const fileSize = modelRegistry[languagePairName][fileType].size;
  const fileChecksum = modelRegistry[languagePairName][fileType].expectedSha256Hash;
  // eslint-disable-next-line no-use-before-define
  const buffer = await getItemFromCacheOrWeb(tabId, fileName, fileSize, fileChecksum);
  if (!buffer) {
      console.error(`Error loading models from cache or web ("${fileType}")`);
      throw new Error(`Error loading models from cache or web ("${fileType}")`);
  }
  return buffer;
};

// eslint-disable-next-line max-lines-per-function
const getItemFromCacheOrWeb = async (tabId, itemURL, fileSize, fileChecksum) => {
  let buffer = null;

  /*
   * there are two possible sources for the translation modules: the Cache
   * API or the network. We check for their existence in the
   * former, and if it's not there, we download from the network and
   * save it in the cache.
   */
  try {
      const cache = await caches.open(CACHE_NAME);
      let response = await cache.match(itemURL);
      if (!response) {

          /*
           * no match for this object was found in the cache.
           * we'll need to download it and inform the progress to the
           * sender UI so it could display it to the user
           */
          console.log(`${itemURL} not found in cache`);
          // eslint-disable-next-line no-use-before-define
          const responseFromWeb = await getItemFromWeb(tabId, itemURL, fileSize, fileChecksum);
          if (!responseFromWeb) {
              return null;
          }
          // save in cache
          await cache.put(itemURL, responseFromWeb);
          console.log(`${itemURL} saved to cache`);
          response = await cache.match(itemURL);
      }
      buffer = await response.arrayBuffer();
  } catch (error) {
      // cache api is not supported
      console.log(`cache API not supported (${error})`);
      // eslint-disable-next-line no-use-before-define
      const responseFromWeb = await getItemFromWeb(tabId, itemURL, fileSize, fileChecksum);
      if (!responseFromWeb) {
          return null;
      }
      buffer = await responseFromWeb.arrayBuffer();
  }
  return buffer;
};

const getLocalizedMessage = payload => {
  let localizedMessage;
  if (typeof payload[1] === "string") {
      localizedMessage = browser.i18n.getMessage(payload[1]);
  } else if (typeof payload[1] === "object") {
      // we have a downloading message, which contains placeholders, hence this special treatment
      localizedMessage = browser.i18n.getMessage(payload[1][0], payload[1][1]);
  }

  if (payload[1][0] === "translationProgress") {
      localizedMessage = `${browser.i18n.getMessage("translationEnabled")} ${localizedMessage}`;
  }
  return localizedMessage;
};

const sendUpdateProgress = (tabId, payload) => {

    /*
     * let's invoke the experiment api in order to update the
     * model download progress in the appropiate infobar
     */
    // first we localize the message.
    // eslint-disable-next-line no-case-declarations
    let localizedMessage = getLocalizedMessage(payload);
    if (tabId >0) {
      if (platform === "android") {
        browser.tabs.sendMessage(
          tabId,
          {
            command: "updateProgress",
            progressMessage: localizedMessage
          }
        );
      } else {
        browser.experiments.translationbar.updateProgress(
          tabId,
          localizedMessage
        );
      }
    } else {
      // request is coming from the translation popup
      browser.runtime.sendMessage({
        command: "updateProgress",
        localizedMessage
      });
    }

}

const digestSha256 = async buffer => {
  // hash the message
  if (!crypto.subtle) return null;
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  // convert buffer to byte array
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  // convert bytes to hex string
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
};

// eslint-disable-next-line max-lines-per-function
const getItemFromWeb = async (tabId, itemURL, fileSize, fileChecksum) => {
  let fetchResponse = null;
  try {
      fetchResponse = await fetch(itemURL);
  } catch (error) {
      console.log(`Error downloading ${itemURL} (error: ${error})`);
      // inform mediator
      sendUpdateProgress(tabId, ["updateProgress", "notfoundErrorsDownloadingEngine"]);
      return null;
  }

  if (!fetchResponse.ok) {
      console.log(`Error downloading ${itemURL} (response status:${fetchResponse.status})`);
      sendUpdateProgress(tabId, ["updateProgress", "notfoundErrorsDownloadingEngine"]);
      return null;
  }

  // function to download using stream of body contents with a timeout
  const streamDownloadWithTimeout = async response => {
      const MAX_DOWNLOAD_TIME = 60000;
      const reader = response.body.getReader();
      const contentLength = fileSize;
      let receivedLength = 0;
      let chunks = [];
      let doneReading = false;
      let value = null;
      const tDownloadStart = performance.now();
      let elapsedTime = 0;
      while (!doneReading) {
          if (elapsedTime > MAX_DOWNLOAD_TIME) {
              console.log(`Max time (${MAX_DOWNLOAD_TIME}ms) reached while downloading ${itemURL}`);
              sendUpdateProgress(tabId, ["updateProgress", "timeoutDownloadingEngine"]);
              return false;
          }
          // eslint-disable-next-line no-await-in-loop
          const readResponse = await reader.read();
          elapsedTime = performance.now() - tDownloadStart;
          doneReading = readResponse.done;
          value = readResponse.value;

          if (doneReading) {
              break;
          }
          if (value) {
              chunks.push(value);
              receivedLength += value.length;
              sendUpdateProgress(tabId, ["updateProgress", ["downloadProgress", [`${receivedLength}`,`${contentLength}`]]]);
          } else {
            sendUpdateProgress(tabId, ["updateProgress", "nodataDownloadingEngine"]);
            return false;
          }

          if (receivedLength === contentLength) {
              doneReading = true;
          }
      }
      console.log(`Successfully downloaded ${itemURL} (took ${elapsedTime}ms)`);
      return true;
  };

  if (!await streamDownloadWithTimeout(fetchResponse.clone())) {
      return null;
  }

  // function to validate the checksum of the downloaded buffer
  const isValidChecksum = async arrayBuffer => {
      const sha256 = await digestSha256(arrayBuffer);
      if (!sha256) {
          console.log(`Sha256 error for ${itemURL}`);
          sendUpdateProgress(tabId, ["updateProgress", "tlsIncompatibility"]);
          return false;
      }

      if (sha256 !== fileChecksum) {
          console.log(`Checksum failed for ${itemURL}`);
          sendUpdateProgress(tabId, ["updateProgress", "checksumErrorsDownloadingEngine"]);
          return false;
      }
      console.log(`Checksum passed for ${itemURL}`);
      return true;
  }

  let buffer = await fetchResponse.clone().arrayBuffer();
  if (!await isValidChecksum(buffer)) {
      return null;
  }
  return fetchResponse;
};

browser.contextMenus.create({
  id: "firefox-translations",
  title: browser.i18n.getMessage("translateWith", "Firefox Translations"),
  contexts: ["selection"],
});

browser.contextMenus.onClicked.addListener(info => {
  if (info.menuItemId === "firefox-translations") {
    popupPreLoadText = DOMPurify.sanitize(info.selectionText, { USE_PROFILES: { html: true } });
    browser.browserAction.openPopup();
  }
});