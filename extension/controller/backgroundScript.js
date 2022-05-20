/* eslint-disable max-lines */
/* global LanguageDetection, browser, PingSender, BERGAMOT_VERSION_FULL,
Telemetry, loadFastText, FastText, Sentry, settings, deserializeError,
modelRegistryRootURL, modelRegistryRootURLTest, modelRegistry */

/*
 * we need the background script in order to have full access to the
 * WebExtensionAPI as also the privileged experiment APIs that we define
 * in controller/experiments. Although part of the controller,
 * this script does not have access to the page content, since it runs in the
 * extension's background process.
 */

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
    release: `firefox-translations@${browser.runtime.getManifest().version}`,
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
let platformInfo = null;

let telemetryByTab = new Map();
let pingByTab = new Set();
let translationRequestsByTab = new Map();
let outboundRequestsByTab = new Map();
const translateAsBrowseMap = new Map();
let isMochitest = false;
const languageModelFileTypes = ["model", "lex", "vocab", "qualityModel"];
const CACHE_NAME = "fxtranslations";

const init = () => {
  Sentry.wrap(async () => {
    platformInfo = await browser.runtime.getPlatformInfo();
    cachedEnvInfo = await browser.experiments.telemetryEnvironment.getFxTelemetryMetrics();
    telemetryByTab.forEach(t => t.environment(cachedEnvInfo));
  });
  browser.storage.local.get({ telemetryCollectionConsent: true }).then(item => {
    pingSender.setUploadEnabled(item.telemetryCollectionConsent);
  });
}

const getTelemetry = tabId => {
    if (!telemetryByTab.has(tabId)) {
        let telemetry = new Telemetry(pingSender);
        telemetryByTab.set(tabId, telemetry);
        telemetry.versions(browser.runtime.getManifest().version, "?", BERGAMOT_VERSION_FULL);
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
           * if we don't support this browser's language, we need to hide the
           * page action and bail right away
           */
          if (!message.languageDetection.supported) {
            browser.pageAction.hide(sender.tab.id);
            break;
          }

          /*
           * call the cld experiment to detect the language of the snippet
           * extracted from the page
           */
          let pageLanguage = modelFastText
            .predict(message.languageDetection.wordsToDetect.trim().replace(/(\r\n|\n|\r)/gm, ""), 1, 0.0)
            .get(0)[1]
            .replace("__label__", "");

          /*
           * language detector returns "no" for Norwegian Bokmål ("nb")
           * so we need to default it to "nb", since that's what FF
           * localization mechanisms has set
           */
          if (pageLanguage === "no") pageLanguage = "nb"
          browser.tabs.sendMessage(sender.tab.id, {
            command: "responseDetectPageLanguage",
            pageLanguage
          })
          break;
        }
        case "monitorTabLoad":
          if (!await isFrameLoaded(sender.tab.id, sender.frameId)) return;
            browser.tabs.sendMessage(
                    sender.tab.id,
                    { command: "responseMonitorTabLoad", tabId: sender.tab.id, platformInfo },
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

          /*
           * request the experiments API do display the infobar
           */
          await browser.experiments.translationbar.show(
            sender.tab.id,
            message.languageDetection.pageLanguage,
            message.languageDetection.navigatorLanguage,
            {
              displayStatisticsMessage: browser.i18n.getMessage("displayStatisticsMessage"),
              outboundTranslationsMessage: browser.i18n.getMessage("outboundTranslationsMessage"),
              qualityEstimationMessage: browser.i18n.getMessage("qualityEstimationMessage"),
              surveyMessage: browser.i18n.getMessage("surveyMessage"),
              translateAsBrowseOn: browser.i18n.getMessage("translateAsBrowseOn"),
              translateAsBrowseOff: browser.i18n.getMessage("translateAsBrowseOff")
            },
            false,
            {
              outboundtranslations: await browser.storage.local.get("outboundtranslations-check"),
              qualityestimations: await browser.storage.local.get("qualityestimations-check")
            },
            translateAsBrowseMap.get(sender.tab.id)?.translatingAsBrowse
          );

          // we then ask the api for the localized version of the language codes
          browser.tabs.sendMessage(
            sender.tab.id,
            {
              command: "localizedLanguages",
              localizedPageLanguage: await browser.experiments.translationbar
                .getLocalizedLanguageName(message.languageDetection.pageLanguage),
              localizedNavigatorLanguage: await browser.experiments.translationbar
                .getLocalizedLanguageName(message.languageDetection.navigatorLanguage)
            }
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
          browser.tabs.create({ url: "https://qsurvey.mozilla.com/s3/Firefox-Translations" });
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
          console.warn("Reporting content script error to Sentry");
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
            );
            break;
        case "downloadLanguageModels":
          try {
            // eslint-disable-next-line no-use-before-define
            let models = await getLanguageModels(message.tabId, message.languagePairs);
            // pass the downloaded language models to the mediator
            browser.tabs.sendMessage(
              message.tabId,
              {
                  command: "responseDownloadLanguageModels",
                  tabId: message.tabId,
                  languageModels: models
              }
            );
          } catch (error) {
            // eslint-disable-next-line no-use-before-define
            sendUpdateProgress(message.tabId, ["updateProgress", "errorLoadingWasm"]);
            getTelemetry(message.tabId).record("counter", "errors", "model_load");
            console.warn("Reporting content script error to Sentry");
            Sentry.captureException(error);
          }
          break;
        case "updateProgress":
          browser.experiments.translationbar.updateProgress(
            message.tabId,
            message.progressMessage
          );
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
          translateAsBrowseMap.set(message.tabId, {
            translatingAsBrowse: message.translatingAsBrowse
          });
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
        default:
          // ignore
          break;
      }
    });
}

browser.runtime.onMessage.addListener(messageListener);
browser.experiments.translationbar.onTranslationRequest.addListener(messageListener);
init();

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

browser.pageAction.onClicked.addListener(tab => {
    Sentry.wrap(async () => {

        /*
         * if the user clicks the pageAction, we summon the infobar, and for that we
         * need to let the infobar api know that this is on demand-request, which
         * doesn't have a language detected, so for that reason we set the language
         * parameter as 'userrequest', in order to override the preferences.
         */
          let languageDetection = new LanguageDetection();
          if (languageDetection.isBrowserSupported()) {
            browser.experiments.translationbar.show(
                tab.id,
                "userrequest",
                languageDetection.navigatorLanguage,
                {
                    displayStatisticsMessage: browser.i18n.getMessage("displayStatisticsMessage"),
                    outboundTranslationsMessage: browser.i18n.getMessage("outboundTranslationsMessage"),
                    qualityEstimationMessage: browser.i18n.getMessage("qualityEstimationMessage"),
                    surveyMessage: browser.i18n.getMessage("surveyMessage"),
                    languageDefaultOption: browser.i18n.getMessage("languageDefaultOption"),
                    translateAsBrowseOn: browser.i18n.getMessage("translateAsBrowseOn"),
                    translateAsBrowseOff: browser.i18n.getMessage("translateAsBrowseOff")
                },
                true,
                {
                  outboundtranslations: await browser.storage.local.get("outboundtranslations-check"),
                  qualityestimations: await browser.storage.local.get("qualityestimations-check")
                },
                false
            );
          } else {

            /*
             * if we don't support this browser's language, we nede to hide the
             * page action and bail right away
             */
            browser.pageAction.hide(tab.id);
          }
    });
});

// here we remove the closed tabs from translateAsBrowseMap and submit telemetry
browser.tabs.onRemoved.addListener(tabId => {
  translateAsBrowseMap.delete(tabId);
  submitPing(tabId);
});

browser.webNavigation.onCommitted.addListener(details => {
  // only send pings if the top frame navigates.
  if (details.frameId === 0) submitPing(details.tabId);
});

const displayedConsentPromise = browser.storage.local.get("displayedConsent");
const isMochitestPromise = browser.experiments.translationbar.isMochitest();

Promise.allSettled([displayedConsentPromise, isMochitestPromise]).then(values => {
  const displayedConsent = values[0].value?.displayedConsent;
  isMochitest = values[1].value;

  if (!displayedConsent && !isMochitest) {
    browser.tabs.create({ url: browser.runtime.getURL("view/static/dataConsent.html") });
    browser.storage.local.set({ displayedConsent: true });
  }
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
    clonedLanguagePair["languageModelBlobs"] = languageModel;
    result.push(clonedLanguagePair);
  });
  return result;
};

const getLanguageModel = async (tabId, languagePair) => {
  let languageModelPromise = [];
  languageModelFileTypes
      .filter(fileType => fileType !== "qualityModel" || languagePair.withQualityEstimation)
      .filter(fileType => Reflect.apply(Object.prototype.hasOwnProperty, modelRegistry[languagePair.name], [fileType]))
      .forEach(fileType => languageModelPromise.push(downloadFile(tabId, fileType, languagePair.name))); // eslint-disable-line no-use-before-define

  let buffers = await Promise.all(languageModelPromise);

  // create Blobs from buffers and return
  let files = {};
  buffers.forEach((buffer, index) => {
    files[languageModelFileTypes[index]] = new Blob([buffer]);
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
      const responseFromWeb = await getItemFromWeb(itemURL, fileSize, fileChecksum);
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
    browser.experiments.translationbar.updateProgress(
      tabId,
      localizedMessage
    );
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