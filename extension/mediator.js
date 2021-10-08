/*
 * extension's main script responsible for orchestrating the components
 * lifecyle, interactions and the rendering of the UI elements
 */

/* global LanguageDetection, OutboundTranslation, browser */

class Mediator {

    constructor() {
        this.messagesSenderLookupTable = new Map();
        this.messageCounter = 0;
        this.translationWorker = null;
        this.languageDetection = new LanguageDetection();
        this.outboundTranslation = new OutboundTranslation(this);
        browser.runtime.onMessage.addListener(this.bgScriptsMessageListener.bind(this));
        browser.runtime.sendMessage({ command: "monitorTabLoad" });
    }

    // main entrypoint to handle the extension's load
    start(tabID) {

        this.tabID = tabID;

        // request the language detection class to extract a page's snippet
        this.languageDetection.extractPageContent();

        /*
         * request the background script to detect the page's language and
         *  determine if the infobar should be displayed
         */
        browser.runtime.sendMessage({
            command: "detectPageLanguage",
            languageDetection: this.languageDetection
        })
    }

    determineIfTranslationisRequired() {

        /*
         * here we:
         * - determine if the infobar should be displayed or not and if yes,
         *      notifies the backgroundScript in order to properly
         * - display the views responsible for the translationbar
         * - initiate the outbound translation view and start the translation
         *      webworker
         */
        if (!this.languageDetection.navigatorLanguage.includes(this.languageDetection.pageLanguage.language)) {

            // request the backgroundscript to display the translationbar
            browser.runtime.sendMessage({
                command: "displyTranslationBar",
                languageDetection: this.languageDetection.pageLanguage.language
            });

            // render the outboundtranslation view
            this.outboundTranslation.start();

            // start the translation webworker
             if (window.Worker) {
                 this.translationWorker = new Worker(browser.runtime.getURL("controller/translationWorker.js"));
                 this.translationWorker.addEventListener("message", this.translationWorkerMessageListener);
             }
        }
    }

    /*
     * handles all requests received from the content scripts
     * (views and controllers)
     */
    contentScriptsMessageListener(sender, message) {
        switch (message.command) {
            case "translate":
                /*
                 * translation request received. dispatch the content to the
                 * translation worker
                 */
                this.translationWorkerMessageSender("translate", sender, message);

                break;
            default:
        }
    }

    translationWorkerMessageSender(command, sender, message) {
        this.messageCounter += 1;
        this.messagesSenderLookupTable.set(this.messageCounter, sender);
        this.translationWorker.postMessage([
            command,
            this.messageCounter,
            message
        ]);
    }

    /*
     * handles all communicaiton received from the translation webworker
     */
    translationWorkerMessageListener(message) {
        const command = message.data[0];
        const messageId = message.data[1];
        const payLoad = message.data[2];
        // we then retrieve the sender from the lookup table using the
        console.log("translationWorkerMessageListener", message);
    }

    /*
     * handles all communication received from the background script
     * and properly delegates the calls to the responsible methods
     */
    bgScriptsMessageListener(message) {
        switch (message.command) {
            case "responseMonitorTabLoad":
                this.start(message.tabID);
                break;
            case "responseDetectPageLanguage":
                this.languageDetection = Object.assign(new LanguageDetection(), message.languageDetection);
                this.determineIfTranslationisRequired();
                break;
            default:
                // ignore
        }
    }

}

new Mediator();