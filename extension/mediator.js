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
                command: "displayTranslationBar",
                languageDetection: this.languageDetection
            });

            // TODO: render the outboundtranslation view only after the user
            // accepts it
            // this.outboundTranslation.start();

            // create the translation object
            this.translation = new Translation(this);
        }
    }

    /*
     * handles all requests received from the content scripts
     * (views and controllers)
     */
    contentScriptsMessageListener(sender, message) {
        switch (message.command) {
            case "translate":

                // eslint-disable-next-line no-case-declarations
                const translationMessage = this.translation.constructTranslationMessage(
                    message.payload.text,
                    message.payload.type,
                    message.payload.sourceLanguage,
                    message.payload.targetLanguage
                );
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
                this.messagesSenderLookupTable.get(message.payload[1].messageID)
                    .mediatorNotification(message);
                break;
            case "updateProgress":

                /*
                 * let's invoke the experiment api in order to update the
                 * model/engine download progress in the appropiate infobar
                 */
                browser.runtime.sendMessage({
                    command: "updateProgress",
                    progressMessage: message.payload,
                    tabId: this.tabID
                });
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
            case "translationRequested":

                /*
                 * translation request received from the infobar. let's start
                 * the engines
                 */

                // TODO: start reading the page even before the models load
                // eslint-disable-next-line no-case-declarations
                const translationMessage = this.translation.constructTranslationMessage(
                    null,
                    "inpage",
                    message.from,
                    message.to,
                    message.tabid
                );
                this.translation.translate(translationMessage);
                console.log("translationRequested no mediator", translationMessage);
            default:
                // ignore
        }
    }


}

new Mediator();