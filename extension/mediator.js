/*
 * extension's main script responsible for orchestrating the components
 * lifecyle, interactions and the rendering of the UI elements
 */

/* global LanguageDetection, OutboundTranslation, Translation , browser,
InPageTranslation, browser, Telemetry, TranslationTelemetry */

class Mediator {

    constructor() {
        this.messagesSenderLookupTable = new Map();
        this.translation = null;
        this.translationsCounter = 0;
        this.languageDetection = new LanguageDetection();
        this.outboundTranslation = new OutboundTranslation(this);
        this.inPageTranslation = new InPageTranslation(this);
        this.telemetry = new Telemetry(false);
        this.translationTelemetry = new TranslationTelemetry(this.telemetry);
        browser.runtime.onMessage.addListener(this.bgScriptsMessageListener.bind(this));
        this.translationBarDisplayed = false;
        this.statsMode = false;
    }

    init() {
        browser.runtime.sendMessage({ command: "monitorTabLoad" });
        browser.runtime.sendMessage({ command: "loadTelemetryInfo" });
    }

    // todo: subscribe to tab closing
    // the page is closed or infobar is closed manually
    closeSession() {
        this.telemetry.submit("translation");
        this.telemetry.submit("interaction");
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

    determineIfTranslationisRequired() {

        /*
         * here we:
         * - determine if the infobar should be displayed or not and if yes,
         *      notifies the backgroundScript in order to properly
         * - display the views responsible for the translationbar
         * - initiate the outbound translation view and start the translation
         *      webworker
         */
        const pageLang = this.languageDetection.pageLanguage.language;
        const navLang = this.languageDetection.navigatorLanguage;
        this.telemetry.langTo = navLang;
        this.telemetry.langFrom = pageLang;

        if (!navLang.includes(pageLang)) {

            /*
             *  todo: we need to keep track if the translationbar was already displayed
             * or not, since during tests we found the browser may send the
             * onLoad event twice.
             */
            if (this.translationBarDisplayed) return;
            // request the backgroundscript to display the translationbar
            browser.runtime.sendMessage({
                command: "displayTranslationBar",
                languageDetection: this.languageDetection
            });
            this.translationBarDisplayed = true;
            // create the translation object
            this.translation = new Translation(this);
            this.telemetry.increment( "languages", "lang_mismatch");
            // todo: send on timer
            this.telemetry.submit("stats")
        }
    }

    /*
     * handles all requests received from the content scripts
     * (views and controllers)
     */
    // eslint-disable-next-line max-lines-per-function
    contentScriptsMessageListener(sender, message) {
        switch (message.command) {
            case "translate":
                // eslint-disable-next-line no-case-declarations
                const translationMessage = this.translation.constructTranslationMessage(
                    message.payload.text,
                    message.payload.type,
                    message.tabId,
                    this.languageDetection.navigatorLanguage,
                    this.languageDetection.pageLanguage.language,
                    message.payload.attrId
                );
                this.messagesSenderLookupTable.set(translationMessage.messageID, sender);
                this.translation.translate(translationMessage);
                // console.log("new translation message sent:", translationMessage, "msg sender lookuptable size:", this.messagesSenderLookupTable.size);
                break;
            case "translationComplete":

                /*
                 * received the translation complete signal
                 * from the translation object. so we lookup the sender
                 * in order to route the response back, which can be
                 * OutbountTranslation, InPageTranslation etc....
                 */
                message.payload[1].forEach(translationMessage => {
                    this.messagesSenderLookupTable.get(translationMessage.messageID)
                    .mediatorNotification(translationMessage);
                    this.messagesSenderLookupTable.delete(translationMessage.messageID);
                });

                // eslint-disable-next-line no-case-declarations
                const wordsPerSecond = this.translationTelemetry.addAndGetTranslationTimeStamp(
                    message.payload[2][0], message.payload[2][1]);

                if (this.statsMode) {
                    // if the user chose to see stats in the infobar, we display them
                    browser.runtime.sendMessage({
                        command: "updateProgress",
                        progressMessage: [null,`Translation enabled (stats mode) Words-per-second: ${wordsPerSecond}`],
                        tabId: this.tabId
                    });
                }

                // console.log("translation complete rcvd:", message, "msg sender lookuptable size:", this.messagesSenderLookupTable.size);
                break;
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
                // payload is a metric name from metrics.yaml
                this.telemetry.increment("errors", message.payload);
                this.telemetry.submit("errors")
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
                this.start(message.tabId);
                break;
            case "telemetryInfoLoaded":
                this.telemetry.telemetryInfo = message.env;
                break;
            case "responseDetectPageLanguage":
                this.languageDetection = Object.assign(new LanguageDetection(), message.languageDetection);
                this.determineIfTranslationisRequired();
                break;
            case "translationRequested":
                // here we handle when the user's translation request in the infobar
                // eslint-disable-next-line no-case-declarations
                // let's start the in-page translation widget
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

            case "displayStatistics":
                this.statsMode = true;
                break;

            case "onInfobarEvent":
                // 'name' is a metric name from metrics.yaml
                this.telemetry.event("infobar", message.name);

                if (message.name === "closed") {
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