/*
 * this class is responsible for all translations related operations, like
 * interacting with the web worker, handle the language models, and communicate with the
 * mediator
 */
/* global browser, TranslationMessage, Queue, reportErrorsWrap, reportExceptionSerialized */

// eslint-disable-next-line no-unused-vars
class Translation {
    constructor (mediator){
        this.translationsMessagesCounter = 0;
        this.TRANSLATION_INTERVAL = 100; // ms
        this.MAX_TRANSLATION_MSGS = 100; // max translations to process per batch we should utilize here the max throughput per cpu type
        this.translateSchedule = null; // holds a reference to the translation setTimeout
        this.translationMessageBuffer = new Queue();
        this.mediator = mediator;
        this.htmlRegex = new RegExp("<(.*)>.*?|<(.*) />", "gi");
        let engineScriptLocalPath = null;
        let engineWasmLocalPath = null;
        if (this.mediator.platformInfo.arch === "x86-32" || (this.mediator.platformInfo.arch === "x86-64")) {
            engineScriptLocalPath = browser.runtime.getURL("controller/translation/bergamot-translator-worker.js");
            engineWasmLocalPath = browser.runtime.getURL("model/static/translation/bergamot-translator-worker-with-wormhole.wasm");
        } else {
            engineScriptLocalPath = browser.runtime.getURL("controller/translation/bergamot-translator-worker-without-wormhole.js");
            engineWasmLocalPath = browser.runtime.getURL("model/static/translation/bergamot-translator-worker-without-wormhole.wasm");
        }
        const serializeErrorScript = browser.runtime.getURL("model/static/errorReporting/serializeError.js");
        const version = browser.runtime.getManifest().version;
        if (window.Worker) {
            this.translationWorker = new Worker(browser.runtime.getURL("controller/translation/translationWorker.js"));
            this.translationWorker.addEventListener(
                "message",
                this.translationWorkerMessageListener.bind(this)
            );
            this.translationWorker.postMessage([
                "configEngine",
                {
                    engineScriptLocalPath,
                    engineWasmLocalPath,
                    serializeErrorScript,
                    version,
                }
            ])
        }
    }

    /*
     * handles all communication received from the translation webworker
     */
    // eslint-disable-next-line max-lines-per-function
    translationWorkerMessageListener(translationMessage) {
        reportErrorsWrap(() => {
            switch (translationMessage.data[0]) {
                case "translationComplete":
                    this.mediator.contentScriptsMessageListener(this, {
                        command: "translationComplete",
                        payload: translationMessage.data
                    });
                    break;
                case "downloadLanguageModels":
                    this.mediator.contentScriptsMessageListener(this, {
                        command: "downloadLanguageModels",
                        payload: translationMessage.data[1]
                    });
                    break;
                case "updateProgress":
                    this.mediator.contentScriptsMessageListener(this, {
                        command: "updateProgress",
                        payload: translationMessage.data
                    });
                    break;
                case "displayOutboundTranslation":
                    this.mediator.contentScriptsMessageListener(this, {
                        command: "displayOutboundTranslation",
                        payload: null
                    });
                    break;
                case "reportError":
                    this.mediator.contentScriptsMessageListener(this, {
                        command: "reportError",
                        payload: translationMessage.data[1]
                    });
                    break;
                case "reportException":
                    reportExceptionSerialized(translationMessage.data[1]);
                    break;
                case "reportPerformanceTimespan":
                    this.mediator.contentScriptsMessageListener(this, {
                        command: "reportPerformanceTimespan",
                        payload: { metric: translationMessage.data[1], timeMs: translationMessage.data[2] }
                    });
                    break;
                case "reportQeIsSupervised":
                    this.mediator.contentScriptsMessageListener(this, {
                        command: "reportQeIsSupervised",
                        payload: { is_supervised: translationMessage.data[1] }
                    });
                    break;
                default:
            }
        });
    }

    sendDownloadedLanguageModels(downloadedLanguageModels) {
        // send language models to worker
        this.translationWorker.postMessage([
            "responseDownloadLanguageModels",
            downloadedLanguageModels
        ]);
    }

    /*
     * translation request received from the mediator. let's just send
     * the message to the worker
     */
    translate(translationMessage) {

        if (translationMessage.type === "outbound") {

            /*
             * if the message is from outbound translations, we skip queuing it and
             * send for translation immediately
             */
            if (this.translationWorker) {
                this.translationWorker.postMessage([
                    "translate",
                    [translationMessage]
                ]);
            }
        } else {
            // add this message to the queue
            this.translationMessageBuffer.enqueue(translationMessage);

            // and schedule an update if required
            if (!this.translateSchedule) {
                this.translateSchedule = setTimeout(this.submitMessages.bind(this), this.TRANSLATION_INTERVAL);
            }
        }
    }

    submitMessages() {
        reportErrorsWrap(() => {
            // timeout invoked. let's submit the messages
            const messagesToGo = [];

            // we'll process until the buffer is empty or we reach
            while (!this.translationMessageBuffer.isEmpty() && messagesToGo.length < this.MAX_TRANSLATION_MSGS) {
                const message = this.translationMessageBuffer.dequeue();
                messagesToGo.push(message);
            }
            if (this.translationWorker) {
                this.translationWorker.postMessage([
                    "translate",
                    messagesToGo
                ]);
            }

            // and schedule an update if required
            if (this.translationMessageBuffer.length() > 0) {
                setTimeout(this.submitMessages.bind(this), this.TRANSLATION_INTERVAL);
            }
            // inform it is complete
            this.translateSchedule = null;
        });
    }

    // eslint-disable-next-line max-params,max-lines-per-function
    constructTranslationMessage(
        sourceParagraph,
        type,
        tabId,
        frameId,
        origin,
        navigatorLanguage,
        pageLanguage,
        attrId,
        withOutboundTranslation,
        withQualityEstimation
    ) {

        /*
         * translation request received. dispatch the content to the
         * translation worker
         */
        const translationMessage = new TranslationMessage();
        this.translationsMessagesCounter += 1;
        translationMessage.messageID = this.translationsMessagesCounter;
        translationMessage.sourceParagraph = sourceParagraph;
        // let's revisit this later, since passing false here when there's plain text is breaking
        translationMessage.isHTML = true; // this.htmlRegex.test(sourceParagraph);
        switch (type) {
            case "outbound":
                translationMessage.sourceLanguage = navigatorLanguage;
                translationMessage.targetLanguage = pageLanguage;
                break;
            case "inpage":
                translationMessage.sourceLanguage = pageLanguage;
                translationMessage.targetLanguage = navigatorLanguage;
                break;
            case "load":
                translationMessage.sourceLanguage = pageLanguage;
                translationMessage.targetLanguage = navigatorLanguage;
                break;
            case "backTranslation":
                translationMessage.sourceLanguage = pageLanguage;
                translationMessage.targetLanguage = navigatorLanguage;
                break;
            default:
                break;
        }
        translationMessage.tabId = tabId;
        translationMessage.frameId = frameId;
        translationMessage.origin = origin;
        translationMessage.type = type;
        translationMessage.attrId = attrId;
        translationMessage.withOutboundTranslation = withOutboundTranslation;
        translationMessage.withQualityEstimation = withQualityEstimation;
        return translationMessage;
    }
}