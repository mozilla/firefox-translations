/* eslint-disable max-lines */
/* global LanguageDetection, browser, PingSender, BERGAMOT_VERSION_FULL, Telemetry, loadFastText, FastText */

/*
 * we need the background script in order to have full access to the
 * WebExtensionAPI as also the privileged experiment APIs that we define
 * in controller/experiments. Although part of the controller,
 * this script does not have access to the page content, since it runs in the
 * extension's background process.
 */

let cachedEnvInfo = null;
let pingSender = new PingSender();
let modelFastText = null;
let languageDetection = null;
let platformInfo = null;

// as soon we load, we should turn off the legacy prefs to avoid UI conflicts
browser.experiments.translationbar.switchOnPreferences();
let telemetryByTab = new Map();
let translationRequestsByTab = new Map();
let outboundRequestsByTab = new Map();

const init = async () => {
    //console.log(`BGSCRIPT::init()`);
    cachedEnvInfo = await browser.experiments.telemetryEnvironment.getFxTelemetryMetrics();
    //console.log(`BGSCRIPT::init() MIDDLE`);
    telemetryByTab.forEach(t => t.environment(cachedEnvInfo));
    //console.log(`BGSCRIPT::init() DONE`);
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

// eslint-disable-next-line max-lines-per-function,complexity
const messageListener = async function(message, sender) {
    //console.log(`BGSCRIPT:messageListener(): message:${JSON.stringify(message)}, sender.tab.id:${JSON.stringify(sender.tab.id)}`);
    switch (message.command) {
        case "detectPageLanguage":
            if (!modelFastText) break;

            /*
             * call the cld experiment to detect the language of the snippet
             * extracted from the page
             */
            languageDetection = Object.assign(new LanguageDetection(), message.languageDetection);
            languageDetection.pageLanguage = modelFastText
                .predict(languageDetection.wordsToDetect.trim().replace(/(\r\n|\n|\r)/gm, ""), 1, 0.0)
                .get(0)[1]
                .replace("__label__", "");

            /*
             * language detector returns "no" for Norwegian Bokmål ("nb")
             * so we need to default it to "nb", since that's what FF
             * localization mechanisms has set
             */
            if (languageDetection.pageLanguage === "no") languageDetection.pageLanguage = "nb"
            browser.tabs.sendMessage(sender.tab.id, { command: "responseDetectPageLanguage",
                languageDetection })
            break;
        case "monitorTabLoad":
            if (platformInfo === null) {
                platformInfo = await browser.runtime.getPlatformInfo();
            }
            // send to main frame immediately
            browser.tabs.sendMessage(
                    sender.tab.id,
                    { command: "responseMonitorTabLoad", tabId: sender.tab.id },
                    { frameId: sender.frameId }
                    );
            // loading of other frames may be delayed
            if (sender.frameId !== 0) {
              if (translationRequestsByTab.has(sender.tab.id)) {
                let requestMessage = translationRequestsByTab.get(sender.tab.id);
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
                );
              }
              if (outboundRequestsByTab.has(sender.tab.id)) {
                   browser.tabs.sendMessage(
                    sender.tab.id,
                    outboundRequestsByTab.get(sender.tab.id)
                  );
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
                    surveyMessage: browser.i18n.getMessage("surveyMessage")
                },
                false
            );

            // we then ask the api for the localized version of the language codes
            browser.tabs.sendMessage(
                sender.tab.id,
                { command: "localizedLanguages",
                   localizedPageLanguage: await browser.experiments.translationbar
                        .getLocalizedLanguageName(message.languageDetection.pageLanguage),
                    localizedNavigatorLanguage: await browser.experiments.translationbar
                        .getLocalizedLanguageName(message.languageDetection.navigatorLanguage) }
            );

            break;
        case "translate":
            // propagate translation message from iframe to top frame
            message.frameId = sender.frameId;
            browser.tabs.sendMessage(
                message.tabId,
                message,
                { frameId: 0 }
            );
            break;
        case "showSurvey":
            browser.tabs.create({ url: "https://qsurvey.mozilla.com/s3/Firefox-Translations" });
            break;
        case "translationComplete":
            // propagate translation message from top frame to the source frame
            browser.tabs.sendMessage(
                message.tabId,
                message,
                { frameId: message.translationMessage.frameId }
            );
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

            /*
             * if the event was to close the infobar, we notify the api as well
             * we don't need another redundant loop by informing the mediator,
             * to then inform this script again
             */
            if (message.name === "closed") {
                browser.experiments.translationbar.closeInfobar(message.tabId);
            }

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

        case "submitPing":
            getTelemetry(message.tabId).submit();
            telemetryByTab.delete(message.tabId);
            translationRequestsByTab.delete(message.tabId);
            outboundRequestsByTab.delete(message.tabId);
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
        case "updateProgress":
            browser.experiments.translationbar.updateProgress(
                message.tabId,
                message.progressMessage
            );
            break;
        case "outBoundtranslationRequested":

            /*
             * requested for outbound translation received.
             * since we know the direction of translation,
             * let's switch it and inform the mediator
             */
            browser.tabs.sendMessage(
                message.tabId,
                { command: "outboundTranslationRequested",
                  tabId: message.tabId,
                  from: message.to, // we switch the requests directions here
                  to: message.from }
            );
            break;
        case "displayStatistics":

            /*
             * inform the mediator that the user wants to see statistics
             */
            browser.tabs.sendMessage(
                message.tabId,
                { command: "displayStatistics",
                  tabId: message.tabId }
            );
            break;
        case "reportClosedInfobar":
            browser.experiments.translationbar.closeInfobar(message.tabId);
            break;
        default:
            // ignore
            break;
    }
}

browser.runtime.onMessage.addListener(messageListener);
browser.experiments.translationbar.onTranslationRequest.addListener(messageListener);
init().catch(error => console.error("bgScript initialization failed: ", error.message));

// loads fasttext (language detection) wasm module and model
fetch(browser
    .runtime.getURL("model/static/languageDetection/fasttext_wasm.wasm"), { mode: "no-cors" })
    .then(function(response) {
        return response.arrayBuffer();
    })
    .then(function(wasmArrayBuffer) {
        const initialModule = {
            onRuntimeInitialized() {
                const ft = new FastText(initialModule);
                ft.loadModel(browser
                    .runtime.getURL("model/static/languageDetection/lid.176.ftz"))
                    .then(model => {
                    modelFastText = model;
                });
            },
            wasmBinary: wasmArrayBuffer,
        };
    loadFastText(initialModule);
});

browser.pageAction.onClicked.addListener(tab => {

    /*
     * if the user clicks the pageAction, we summon the infobar, and for that we
     * need to let the infobar api know that this is on demand-request, which
     * doesn't have a language detected, so for that reason we set the language
     * parameter as 'userrequest', in order to override the preferences
     */
    browser.experiments.translationbar.show(
        tab.id,
        "userrequest",
        languageDetection.navigatorLanguage,
        {
            displayStatisticsMessage: browser.i18n.getMessage("displayStatisticsMessage"),
            outboundTranslationsMessage: browser.i18n.getMessage("outboundTranslationsMessage"),
            qualityEstimationMessage: browser.i18n.getMessage("qualityEstimationMessage"),
            surveyMessage: browser.i18n.getMessage("surveyMessage"),
            languageDefaultOption: browser.i18n.getMessage("languageDefaultOption")
        },
        true
    );
});