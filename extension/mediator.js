/*
 * extension's main script responsible for orchestrating the components
 * lifecyle, interactions and the rendering of the UI elements
 */

/* global LanguageDetection, OutboundTranslation, Translation , browser,
InPageTranslation, browser, modelRegistryVersion, reportErrorsWrap, uuidv4 */

/* eslint-disable max-lines */


const THIS_ORIGIN = window.origin !== "null"
  ? window.origin
  : location.origin;

class Mediator {

    constructor() {
        this.translation = null;
        this.languageDetection = new LanguageDetection();
        this.inPageTranslation = new InPageTranslation(this);
        this.outboundTranslation = null;
        this.isStarted = false;
        browser.runtime.onMessage.addListener(this.bgScriptsMessageListener.bind(this));
        this.translationBarDisplayed = false;
        this.statsMode = false;
        this.isMainFrame = window.self === window.top;
    }

    init() {
        browser.runtime.sendMessage({ command: "monitorTabLoad" });
    }

    // main entrypoint to handle the extension's load
    start(tabId) {
        this.tabId = tabId;

        if (!this.isStarted && this.isMainFrame) {
            this.isStarted = true;

            /*
             * request the background script to detect the page's language and
             *  determine if the infobar should be displayed
             */
            browser.runtime.sendMessage({
                command: "detectPageLanguage",
                languageDetection: this.languageDetection.extractPageContent(),
            })
        }
    }

    recordTelemetry(type, category, name, value) {
        browser.runtime.sendMessage({
            command: "recordTelemetry",
            tabId: this.tabId,
            type,
            category,
            name,
            value
        });
    }

    // eslint-disable-next-line max-lines-per-function
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

            const pageLang = this.languageDetection.pageLanguage;
            const navLang = this.languageDetection.navigatorLanguage;
            this.recordTelemetry("string", "metadata", "from_lang", pageLang);
            this.recordTelemetry("string", "metadata", "detected_lang", pageLang);
            this.recordTelemetry("string", "metadata", "to_lang", navLang);
            this.recordTelemetry("string", "metadata", "model_version", modelRegistryVersion);
            this.recordTelemetry("counter", "service", "lang_mismatch");
            browser.runtime.sendMessage({ command: "enablePing", tabId: this.tabId });
            if (this.languageDetection.shouldDisplayTranslation()) {
                // request the backgroundscript to display the translationbar
                browser.runtime.sendMessage({
                    command: "displayTranslationBar",
                    languageDetection: this.languageDetection
                });
                this.translationBarDisplayed = true;
                // create the translation object
                this.translation = new Translation(this);
            } else {
                this.recordTelemetry("counter", "service", "not_supported");
            }
        }
    }

    /*
     * handles all requests received from the content scripts
     * (views and controllers)
     */

    // eslint-disable-next-line max-lines-per-function
    contentScriptsMessageListener(sender, message) {
        // eslint-disable-next-line max-lines-per-function
        reportErrorsWrap(() => {
            switch (message.command) {
                case "translate":
                    message.origin = THIS_ORIGIN;
                    if (this.isMainFrame) {
                        // eslint-disable-next-line no-case-declarations
                        this.translate(message);
                    } else {
                        message.tabId = this.tabId;
                        // pass to the worker in top frame through bgScript
                        browser.runtime.sendMessage(message);
                    }

                    if (message.payload.type === "outbound") {
                        if (!sender.selectedTextArea.id) sender.selectedTextArea.id = uuidv4();
                        browser.runtime.sendMessage({
                            command: "reportOutboundStats",
                            tabId: this.tabId,
                            textAreaId: sender.selectedTextArea.id,
                            text: message.payload.text
                        });
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
                        // if this message is originated from another frame, pass it back through bgScript
                        if (this.isMainFrame && (typeof translationMessage.frameId !== "undefined")) {
                            browser.runtime.sendMessage({
                                command: "translationComplete",
                                tabId: this.tabId,
                                translationMessage
                            });
                        } else {
                            this.updateElements(translationMessage);
                        }
                    });

                    browser.runtime.sendMessage({
                        command: "reportTranslationStats",
                        tabId: this.tabId,
                        numWords: message.payload[2][0],
                        engineTimeElapsed: message.payload[2][1]
                    });
                    // console.log("translation complete rcvd:", message, "msg sender lookuptable size:", this.messagesSenderLookupTable.size);
                    break;
                case "downloadLanguageModels":

                    browser.runtime.sendMessage({
                        command: "downloadLanguageModels",
                        languagePairs: message.payload,
                        tabId: this.tabId
                    });
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

                    if (message.payload[1][0] === "translationProgress") {
                        localizedMessage = `${browser.i18n.getMessage("translationEnabled")} ${localizedMessage}`;
                    }

                    browser.runtime.sendMessage({
                        command: "updateProgress",
                        progressMessage: localizedMessage,
                        tabId: this.tabId
                    });
                    break;
                case "displayOutboundTranslation":
                    this.startOutbound();
                    // broadcast to all frames through bgScript
                    browser.runtime.sendMessage({
                        command: "displayOutboundTranslation",
                        tabId: this.tabId
                    });
                    break;
                case "reportError":
                    // payload is a metric name from metrics.yaml
                    this.recordTelemetry("counter", "errors", message.payload);
                    break;
                case "reportViewPortWordsNum":
                    this.recordTelemetry("quantity", "performance", "word_count_visible_in_viewport", message.payload);
                    break;
                case "reportPerformanceTimespan":
                    this.recordTelemetry("timespan", "performance", message.payload.metric, message.payload.timeMs);
                    break;
                case "reportFormsEvent":
                    // payload is a metric name from metrics.yaml
                    this.recordTelemetry("event", "forms", message.payload);
                    break;
                case "reportQeIsSupervised":
                    this.recordTelemetry("boolean", "quality", "is_supervised", message.payload.is_supervised);
                    break;
                case "reportQeMetrics":
                    browser.runtime.sendMessage({
                        command: "reportQeStats",
                        tabId: this.tabId,
                        wordScores: message.payload.wordScores,
                        sentScores: message.payload.sentScores
                    });
                    break;
                case "domMutation":
                    if (this.outboundTranslation) {
                        this.outboundTranslation.updateZIndex(message.payload);
                    }
                    break;
                default:
            }
        });
    }

    translate(message) {
        if (!this.translation) {
            this.translation = new Translation(this);
        }
        const translationMessage = this.translation.constructTranslationMessage(
            message.payload.text,
            message.payload.type,
            this.tabId,
            message.frameId,
            message.origin,
            this.languageDetection.navigatorLanguage,
            this.languageDetection.pageLanguage,
            message.payload.attrId,
            message.payload.withOutboundTranslation,
            message.payload.withQualityEstimation,
            message.payload.isHTML
        );
        this.translation.translate(translationMessage);
        // console.log("new translation message sent:", translationMessage, "msg sender lookuptable size:", this.messagesSenderLookupTable.size);
    }

    startOutbound() {
        if (this.outboundTranslation !== null) return;

        /* display the outboundstranslation widget */
        this.outboundTranslation = new OutboundTranslation(this);
        this.outboundTranslation.start(
            this.localizedNavigatorLanguage,
            this.localizedPageLanguage
        );
    }

    updateElements(translationMessage) {
        if (THIS_ORIGIN !== translationMessage.origin) {
            console.warn(`Message with a different origin is received. Skipping updating. 
                               Window origin: ${THIS_ORIGIN}, Message origin: ${translationMessage.origin}`)
            return;
        }

        if (translationMessage.type === "inpage") {
            this.inPageTranslation.mediatorNotification(translationMessage);
        } else if ((translationMessage.type === "outbound") || (translationMessage.type === "backTranslation")) {
            this.outboundTranslation.mediatorNotification(translationMessage);
        } else {
            throw new Error("Unexpected type: ", translationMessage.type);
        }
    }

    /*
     * handles all communication received from the background script
     * and properly delegates the calls to the responsible methods
     */

    // eslint-disable-next-line max-lines-per-function
    bgScriptsMessageListener(message) {
        // eslint-disable-next-line max-lines-per-function
        switch (message.command) {
            case "responseMonitorTabLoad":
                this.start(message.tabId);
                break;
            case "responseDetectPageLanguage":
                this.languageDetection.setPageLanguage(message.pageLanguage);
                if (this.isMainFrame) this.determineIfTranslationisRequired();
                break;
            case "responseDownloadLanguageModels":
                if (this.tabId && message.tabId === this.tabId && this.translation) {
                    this.translation.sendDownloadedLanguageModels(message.languageModels);
                }
                break;
            case "translationRequested":
                // not started yet
                if (!this.tabId) return;

                /*
                 * here we handle when the user's translation request in the infobar
                 * let's start the in-page translation widget
                 */

                // the user might have changed the page language, so we just accept it
                this.languageDetection.setPageLanguage(message.from);
                if (!this.inPageTranslation.started) {
                    this.inPageTranslation.withOutboundTranslation = message.withOutboundTranslation;
                    this.inPageTranslation.withQualityEstimation = message.withQualityEstimation;
                    if (!message.withQualityEstimation) this.inPageTranslation.addElement(document.getElementsByTagName("title")[0]);
                    this.inPageTranslation.addElement(document.body);
                    this.inPageTranslation.start(this.languageDetection.pageLanguage);
                }
                break;
            case "translate":
                this.translate(message)
                break
            case "translationComplete":
                this.updateElements(message.translationMessage);
                break;
            case "displayOutboundTranslation":
                this.startOutbound();
                break;
            case "displayStatistics":
                this.statsMode = true;
                document.querySelector("html").setAttribute("x-bergamot-debug", true);
                break;
            case "updateStats":
                if (this.statsMode) {
                    // if the user chose to see stats in the infobar, we display them
                    browser.runtime.sendMessage({
                        command: "updateProgress",
                        progressMessage: browser.i18n.getMessage("statsMessage", message.wps),
                        tabId: this.tabId
                    });
                }
                break;
            case "localizedLanguages":
                this.localizedPageLanguage = message.localizedPageLanguage;
                this.localizedNavigatorLanguage = message.localizedNavigatorLanguage;
                break;
            case "onDetached":

                /*
                 * whenever we receive an event that our tab was detached, we
                 * should call detectPageLanguage in order to
                 * have the infobar re-displayed.
                 */
               this.translationBarDisplayed = false;
               browser.runtime.sendMessage({
                    command: "detectPageLanguage",
                    languageDetection: this.languageDetection.extractPageContent(),
                });
                break;
            default:
          // ignore
        }

    }
}


let mediator = null;
reportErrorsWrap(() => {
    mediator = new Mediator();
    mediator.init();
});