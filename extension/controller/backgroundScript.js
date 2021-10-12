/* eslint-disable max-lines-per-function */
/* eslint-disable no-case-declarations */
/* global LanguageDetection */

/*
 * we need the background script in order to have full access to the
 * WebExtensionAPI as also the privileged experiment APIs that we define
 * in controller/experiments. Although part of the controller,
 * this script does not have access to the page content, since it runs in the
 * extension's background process.
 */


const messageListener = async function(message, sender) {

    switch (message.command) {
        case "detectPageLanguage":

            /*
             * call the cld experiment to detect the language of the snippet
             * extracted from the page
             */
            const languageDetection = Object.assign(new LanguageDetection(), message.languageDetection);
            languageDetection.pageLanguage = await
                browser.experiments.languageDetector.detect(languageDetection.wordsToDetect);
            browser.tabs.sendMessage(sender.tab.id, { command: "responseDetectPageLanguage",
                languageDetection })
            break;
        case "monitorTabLoad":

            /*
             * wait until the page within the tab is loaded, and then return
             * with the tabid to the caller
             */
            const listenerCompleteLoad = details => {
                if (details.tabId === sender.tab.id && details.frameId === 0) {
                    browser.webNavigation.onCompleted.removeListener(listenerCompleteLoad);
                    console.log("webNavigation.onCompleted => notifying browser to display the infobar")
                    browser.tabs.sendMessage(
                        sender.tab.id,
                        { command: "responseMonitorTabLoad", tabID: sender.tab.id }
                    )
                }
            };
            browser.webNavigation.onCompleted.addListener(listenerCompleteLoad);
            break;
        case "displyTranslationBar":

            const promise_ld = browser.experiments.translationbar.show(
                sender.tab.id,
                message.languageDetection
            );
            promise_ld
            .then(result => { console.log("success no browser.experiments.translationbar", result)})
            .catch(error => { console.log("error no browser.experiments.translationbar", error)});

            break;
        default:
          // ignore
    }
}

browser.runtime.onMessage.addListener(messageListener);