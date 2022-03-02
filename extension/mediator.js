/*
 * extension's main script responsible for orchestrating the components
 * lifecyle, interactions and the rendering of the UI elements
 */

/* global LanguageDetection, OutboundTranslation, Translation , browser,
InPageTranslation, browser, Telemetry, BERGAMOT_VERSION_FULL */

class Mediator {

    constructor() {
        this.messagesSenderLookupTable = new Map();
        this.translation = null;
        this.translationsCounter = 0;
        this.languageDetection = new LanguageDetection();
        this.inPageTranslation = new InPageTranslation(this);
        this.telemetry = new Telemetry();
        this.telemetry.versions(browser.runtime.getManifest().version, "?", BERGAMOT_VERSION_FULL);
        browser.runtime.onMessage.addListener(this.bgScriptsMessageListener.bind(this));
        this.translationBarDisplayed = false;
        this.statsMode = false;
        // if we are in the protected mochitest page, we flag it.
        if (window.location.href ===
            "https://example.com/browser/browser/extensions/translations/test/browser/browser_translation_test.html") {
            this.isMochitest = true;
        }
    }

    init() {
        browser.runtime.sendMessage({ command: "monitorTabLoad" });
        browser.runtime.sendMessage({ command: "loadTelemetryUploadPref" });
        browser.runtime.sendMessage({ command: "loadTelemetryInfo" });
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

        if (this.languageDetection.isLangMismatch()) {

            /*
             * we need to keep track if the translationbar was already displayed
             * or not, since during tests we found the browser may send the
             * onLoad event twice.
             */
            if (this.translationBarDisplayed) return;

            const pageLang = this.languageDetection.pageLanguage.language;
            const navLang = this.languageDetection.navigatorLanguage;
            this.telemetry.langPair(pageLang, navLang);
            this.telemetry.langMismatch();
            window.onbeforeunload = () => this.telemetry.pageClosed();

            if (this.languageDetection.shouldDisplayTranslation()) {
                // request the backgroundscript to display the translationbar
                browser.runtime.sendMessage({
                    command: "displayTranslationBar",
                    languageDetection: this.languageDetection,
                    localizedLabels: {
                        displayStatisticsMessage: browser.i18n.getMessage("displayStatisticsMessage"),
                        outboundTranslationsMessage: browser.i18n.getMessage("outboundTranslationsMessage"),
                        qualityEstimationMessage: browser.i18n.getMessage("qualityEstimationMessage")
                    }
                });
                this.translationBarDisplayed = true;
                // create the translation object
                this.translation = new Translation(this);
            } else {
                this.telemetry.langNotSupported();
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
            case "translate":
                // eslint-disable-next-line no-case-declarations
                const translationMessage = this.translation.constructTranslationMessage(
                    message.payload.text,
                    message.payload.type,
                    message.tabId,
                    this.languageDetection.navigatorLanguage,
                    this.languageDetection.pageLanguage.language,
                    message.payload.attrId,
                    message.payload.withOutboundTranslation,
                    message.payload.withQualityEstimation
                );
                this.messagesSenderLookupTable.set(translationMessage.messageID, sender);
                this.translation.translate(translationMessage);
                // console.log("new translation message sent:", translationMessage, "msg sender lookuptable size:", this.messagesSenderLookupTable.size);

                this.telemetry.infobarState("outbound_enabled", message.payload.withOutboundTranslation === true);

                if (message.payload.type === "outbound") {
                    this.telemetry.addOutboundTranslation(sender.selectedTextArea, message.payload.text);
                }
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
                const wordsPerSecond = this.telemetry
                    .addAndGetTranslationTimeStamp(message.payload[2][0], message.payload[2][1]);

                if (this.statsMode) {
                    // if the user chose to see stats in the infobar, we display them
                    browser.runtime.sendMessage({
                        command: "updateProgress",
                        progressMessage: browser.i18n.getMessage("statsMessage", wordsPerSecond),
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
                // first we localize the message.
                // eslint-disable-next-line no-case-declarations
                let localizedMessage;
                if (typeof message.payload[1] === "string") {
                    localizedMessage = browser.i18n.getMessage(message.payload[1]);
                } else if (typeof message.payload[1] === "object") {
                    // we have a downloading message, which contains placeholders, hence this special treatment
                    localizedMessage = browser.i18n.getMessage(message.payload[1][0], message.payload[1][1]);
                }

                browser.runtime.sendMessage({
                    command: "updateProgress",
                    progressMessage: localizedMessage,
                    tabId: this.tabId
                });
                break;
            case "displayOutboundTranslation":

                /* display the outboundstranslation widget */
                this.outboundTranslation = new OutboundTranslation(this);
                this.outboundTranslation.start(
                    this.languageDetection.navigatorLanguage,
                    this.languageDetection.pageLanguage.language
                );
                break;
            case "onError":
                // payload is a metric name from metrics.yaml
                this.telemetry.error(message.payload);
                break;
            case "viewPortWordsNum":
                this.telemetry.wordsInViewport(message.payload);
                break;
            case "onModelEvent":
                // eslint-disable-next-line no-case-declarations
                let metric = null;
                if (message.payload.type === "downloaded") {
                    metric = "model_download_time_num";
                } else if (message.payload.type === "loaded") {
                    metric = "model_load_time_num";
                    // start timer when the model is fully loaded
                    this.telemetry.translationStarted();
                } else {
                    throw new Error(`Unexpected event type: ${message.payload.type}`)
                }
                this.telemetry.performanceTime(metric, message.payload.timeMs);
                break;
            case "onFormsEvent":
                this.telemetry.formsEvent(message.payload);
                break;
            case "domMutation":

                if (this.outboundTranslation) {
                    this.outboundTranslation.updateZIndex(message.payload);
                }
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
            case "telemetryInfoLoaded":
                this.telemetry.environment(message.env);
                break;
            case "telemetryUploadPrefLoaded":
                this.telemetry.onUploadPrefChanged(message.uploadEnabled);
                break;
            case "responseDetectPageLanguage":
                this.languageDetection = Object.assign(new LanguageDetection(), message.languageDetection);
                this.determineIfTranslationisRequired();
                break;
            case "translationRequested":

                /*
                 * here we handle when the user's translation request in the infobar
                 * let's start the in-page translation widget
                 */

                // the user might have changed the page language, so we just accept it
                this.languageDetection.pageLanguage.language = message.from;
                if (!this.inPageTranslation.started){
                    this.inPageTranslation.withOutboundTranslation = message.withOutboundTranslation;
                    this.inPageTranslation.withQualityEstimation = message.withQualityEstimation;
                    this.inPageTranslation.start(this.languageDetection.pageLanguage.language);
                }
                break;
            case "displayStatistics":
                this.statsMode = true;
                document.querySelector("html").setAttribute("x-bergamot-debug", true);
                break;
            case "onInfobarEvent":
                // 'name' is a metric name from metrics.yaml
                this.telemetry.infobarEvent(message.name);
                break;
            default:
                // ignore
        }
    }
}

const mediator = new Mediator();
mediator.init();