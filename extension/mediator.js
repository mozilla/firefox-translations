/*
 * extension's main script responsible for orchestrating the components
 * lifecyle, interactions and the rendering of the UI elements
 */

/* global LanguageDetection, OutboundTranslation, TranslationMessage,
 * Translation , browser
 */

class Mediator {

    constructor() {
        this.messagesSenderLookupTable = new Map();
        this.translationsCounter = 0;
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

            // crete the translation object
            this.translation = new Translation(this);
        }
    }

    /*
     * handles all requests received from the content scripts
     * (views and controllers)
     */
    contentScriptsMessageListener(sender, message) {
        let translationMessage = null;

        switch (message.command) {
            case "translate":

                /*
                 * translation request received. dispatch the content to the
                 * translation worker
                 */
                translationMessage = new TranslationMessage();
                this.translationsCounter += 1;
                translationMessage.messageID = this.translationsCounter;
                translationMessage.sourceParagraph = message.payload.text;
                translationMessage.sourceLanguage = "es"; //this.languageDetection.pageLanguage.language;
                translationMessage.targetLanguage = "en"; //this.languageDetection.navigatorLanguage.substring(0,2);
                this.messagesSenderLookupTable.set(translationMessage.messageID, sender);
                this.translation.translate(translationMessage);
                break;
            case "translationComplete":

                /*
                 * received the translation complete signal
                 * from the translation object. so we lookup the sender
                 * in order to route the response back. in this this, it can be
                 * OutbountTranslation, InPageTranslation etc....
                 */
                translationMessage = message.payload[1];
                this.messagesSenderLookupTable.get(translationMessage.messageID)
                    .mediatorNotification(translationMessage);
                break;
            default:
        }
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