/* global LanguageDetection, browser, PingSender, loadFastText, FastText */

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

// as soon we load, we should turn off the legacy prefs to avoid UI conflicts
browser.experiments.translationbar.switchOnPreferences();

// eslint-disable-next-line max-lines-per-function
const messageListener = async function(message, sender) {
    let languageDetection = null;
    let listeneronUpdatedLoad = null;
    let webNavigationCompletedLoad = null;
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

            /*
             * wait until the page within the tab is loaded, and then return
             * with the tabId to the caller
             */
            listeneronUpdatedLoad = (tabId, changeInfo, tab) => {
                if ((tabId === sender.tab.id || tab.url === sender.tab.url) && changeInfo.status === "complete") {
                    browser.tabs.onUpdated.removeListener(listeneronUpdatedLoad);
                    browser.webNavigation.onCompleted.removeListener(webNavigationCompletedLoad);
                    console.log("browser.tabs.onUpdated.addListener => notifying browser to display the infobar: ", changeInfo.status, tabId, sender.tab.id, tab.url)

                    /*
                     * some specific race condition in the tab messaging API
                     * demands that we wait before sending the message, hence the
                     * setTimeout
                     */
                    setTimeout(() => {
                        browser.tabs.sendMessage(
                            tabId,
                            { command: "responseMonitorTabLoad", tabId }
                        );
                    } ,250);
                }
            };

            webNavigationCompletedLoad = details => {
                if (details.tabId === sender.tab.id) {
                    browser.webNavigation.onCompleted.removeListener(webNavigationCompletedLoad);
                    browser.tabs.onUpdated.removeListener(listeneronUpdatedLoad);
                    console.log("webNavigation.onCompleted => notifying browser to display the infobar")
                    setTimeout(() => {
                        browser.tabs.sendMessage(
                            details.tabId ,
                            { command: "responseMonitorTabLoad", tabId: details.tabId }
                        );
                    } ,250);
                }
            };

            browser.webNavigation.onCompleted.addListener(webNavigationCompletedLoad);
            browser.tabs.onUpdated.addListener(listeneronUpdatedLoad);

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
                    qualityEstimationMessage: browser.i18n.getMessage("qualityEstimationMessage")
                }
            );

            break;

        case "loadTelemetryInfo":
            if (cachedEnvInfo === null) {
                // eslint-disable-next-line require-atomic-updates
                cachedEnvInfo = await browser.experiments.telemetryEnvironment.getFxTelemetryMetrics();
            }
            browser.tabs.sendMessage(sender.tab.id, { command: "telemetryInfoLoaded", env: cachedEnvInfo })
            break;

       case "sendPing":
           pingSender.submit(message.pingName, message.data)
               .catch(e => console.error(`Telemetry: ping submission has failed: ${e}`));
           break;

       case "translationRequested":
            // requested for translation received. let's inform the mediator
            browser.tabs.sendMessage(
                message.tabId,
                { command: "translationRequested",
                  tabId: message.tabId,
                  from: message.from,
                  to: message.to,
                  withOutboundTranslation: message.withOutboundTranslation,
                  withQualityEstimation: message.withQualityEstimation }
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
        case "onInfobarEvent":

            /*
             * inform the mediator that a UI event occurred in Infobar
             */
            browser.tabs.sendMessage(
                message.tabId,
                { command: "onInfobarEvent",
                    tabId: message.tabId,
                    name: message.name }
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
        default:
            // ignore
            break;
    }
}

browser.runtime.onMessage.addListener(messageListener);
browser.experiments.translationbar.onTranslationRequest.addListener(messageListener);

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