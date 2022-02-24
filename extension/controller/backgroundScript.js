/* global LanguageDetection, browser, settings, GleanClient */

/*
 * we need the background script in order to have full access to the
 * WebExtensionAPI as also the privileged experiment APIs that we define
 * in controller/experiments. Although part of the controller,
 * this script does not have access to the page content, since it runs in the
 * extension's background process.
 */

let cachedEnvInfo = null;
let dataDeletionRequestSent = false;

// eslint-disable-next-line max-lines-per-function
const messageListener = async function(message, sender) {
    let languageDetection = null;
    let listeneronUpdatedLoad = null;
    let webNavigationCompletedLoad = null;
    switch (message.command) {
        case "detectPageLanguage":

            /*
             * call the cld experiment to detect the language of the snippet
             * extracted from the page
             */
            languageDetection = Object.assign(new LanguageDetection(), message.languageDetection);
            languageDetection.pageLanguage = await
                browser.experiments.languageDetector.detect(languageDetection.wordsToDetect);
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
                message.languageDetection.pageLanguage.language,
                message.languageDetection.navigatorLanguage,
                message.localizedLabels
            );

            break;

        case "loadTelemetryInfo":
            if (cachedEnvInfo === null) {
                const platformInfo = await browser.runtime.getPlatformInfo();
                const env = await browser.experiments.telemetryEnvironment.getFxTelemetryMetrics();
                env.os = platformInfo.os;
                env.arch = platformInfo.arch;
                // eslint-disable-next-line require-atomic-updates
                cachedEnvInfo = env;
            }
            browser.tabs.sendMessage(sender.tab.id, { command: "telemetryInfoLoaded", env: cachedEnvInfo })
            break;

       case "loadTelemetryUploadPref": {
           let uploadEnabled = await browser.experiments.telemetryPreferences.getUploadEnabledPref();
           browser.tabs.sendMessage(sender.tab.id, { command: "telemetryUploadPrefLoaded", uploadEnabled })
           if (uploadEnabled) {
               dataDeletionRequestSent = false;
           } else if (!dataDeletionRequestSent) {
               // wait until environment info is loaded and send deletion request
               let waitAndSend = () => {
                   if (cachedEnvInfo === null) {
                       setTimeout(waitAndSend,30);
                       return;
                   }
                   if (dataDeletionRequestSent) return;
                   let glean = new GleanClient(settings.uploadTelemetry, settings.sendDebugPing, settings.logTelemetry);
                   glean.setBrowserEnv(cachedEnvInfo)
                   glean.sendDeletionRequest();
                   dataDeletionRequestSent = true;
               };
               waitAndSend();
           }
           break;
       }

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
browser.experiments.telemetryPreferences.onUploadEnabledPrefChange
    .addListener(async () => {
        const tabs = await browser.tabs.query({});
        for (let tab of tabs) {
            if (tab.title !== "Settings") {
                messageListener({ command: "loadTelemetryUploadPref" }, { tab })
            }
        }
    });