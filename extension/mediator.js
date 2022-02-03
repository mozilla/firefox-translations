/*
 * extension's main script responsible for orchestrating the components
 * lifecyle, interactions and the rendering of the UI elements
 */

/* global LanguageDetection, OutboundTranslation, Translation , browser,
InPageTranslation, browser */

class Mediator {

    constructor() {
        this.messagesSenderLookupTable = new Map();
        this.translation = null;
        this.translationsCounter = 0;
        this.languageDetection = new LanguageDetection();
        this.outboundTranslation = new OutboundTranslation(this);

        const PRIORITIES = {
            'viewportNodeMap': 1,
            'nonviewportNodeMap': 2,
            'hiddenNodeMap': 3
        };

        this.inPageTranslation = new InPageTranslation({
            contentScriptsMessageListener: (sender, {command, payload}) => {
                console.assert(command == 'translate');

                browser.runtime.sendMessage({
                    tabId: this.tabId,
                    command: "TranslateRequest",
                    data: {
                        // translation request
                        from: this.from,
                        to: this.to,
                        html: true,
                        text: payload.text,
                        
                        // data useful for the scheduling
                        priority: PRIORITIES[payload.attrId[0]],

                        // data useful for the response
                        user: {
                            type: payload.type,
                            attrId: payload.attrId
                        }
                    }
                });
            }
        });

        browser.runtime.onMessage.addListener(({command, data}) => {
            if (command == "TranslateResponse") {
                this.inPageTranslation.mediatorNotification({
                    ...data.request.user,
                    translatedParagraph: data.translation
                });
            }
        });

        browser.runtime.onMessage.addListener(this.bgScriptsMessageListener.bind(this));
        this.translationBarDisplayed = false;
        // if we are in the protected mochitest page, we flag it.
        if (window.location.href ===
            "https://example.com/browser/browser/extensions/translations/test/browser/browser_translation_test.html") {
            this.isMochitest = true;
        }
    }

    init() {
        browser.runtime.sendMessage({ command: "monitorTabLoad" });
    }

    // main entrypoint to handle the extension's load
    start(tabId) {
        this.tabId = tabId;

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

    closeSession() {
        browser.runtime.sendMessage({
            command: "TranslateAbort"
        });
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

        if (this.languageDetection.isLangMismatch()) {

            /*
             * we need to keep track if the translationbar was already displayed
             * or not, since during tests we found the browser may send the
             * onLoad event twice.
             */
            if (this.translationBarDisplayed) return;

            const pageLang = this.languageDetection.pageLanguage.language;
            const navLang = this.languageDetection.navigatorLanguage;
            window.addEventListener("beforeunload", this.closeSession.bind(this));

            if (this.languageDetection.shouldDisplayTranslation()) {
                // request the backgroundscript to display the translationbar
                browser.runtime.sendMessage({
                    command: "displayTranslationBar",
                    languageDetection: this.languageDetection
                });
                this.translationBarDisplayed = true;
                // create the translation object
                this.translation = new Translation(this);
            }
        }
    }

    /*
     * handles all requests received from the content scripts
     * (views and controllers)
     */
    // eslint-disable-next-line max-lines-per-function
    contentScriptsMessageListener(sender, message) {
        switch (message.command) {
            case "updateProgress":

                /*
                 * let's invoke the experiment api in order to update the
                 * model/engine download progress in the appropiate infobar
                 */
                browser.runtime.sendMessage({
                    command: "updateProgress",
                    progressMessage: message.payload,
                    tabId: this.tabId
                });
                break;
            case "displayOutboundTranslation":

                /* display the outboundstranslation widget */
                this.outboundTranslation.start();
                break;

            case "onError":
                break;

            case "onModelEvent":
                break;


            default:
        }
    }

    /*
     * handles all communication received from the background script
     * and properly delegates the calls to the responsible methods
     */
    // eslint-disable-next-line max-lines-per-function
    bgScriptsMessageListener(message) {
        switch (message.command) {
            case "responseMonitorTabLoad":
                this.start(message.tabId);
                break;
            case "responseDetectPageLanguage":
                this.languageDetection = Object.assign(new LanguageDetection(), message.languageDetection);
                this.determineIfTranslationisRequired();
                break;
            case "translationRequested":
                // here we handle when the user's translation request in the infobar
                // eslint-disable-next-line no-case-declarations
                // let's start the in-page translation widget
                // TODO: Temporarily hard-coded these to make testing easier
                this.from = 'es';
                this.to = 'en';
                if (!this.inPageTranslation.started){
                    this.inPageTranslation.start();
                }

                break;
            case "outboundTranslationRequested":

                /*
                 * so, now that we received the request from the infobar to
                 * start outbound translation, let's request the
                 *  worker to download the models
                 */
                this.translation.loadOutboundTranslation(message);
                break;

            case "onInfobarEvent":
                if (message.name === "closed" ||
                    message.name === "never_translate_site" ||
                    message.name === "never_translate_lang") {
                    this.closeSession();
                }
                break;

            default:
                // ignore
        }
    }
}

const mediator = new Mediator();
mediator.init();