/*
 * this class is responsible for all translations related operations, like
 * interacting with the web worker, handle the language models, and communicate with the
 * mediator
 */
/* global browser, TranslationMessage */

// eslint-disable-next-line no-unused-vars
class Translation {
    constructor (mediator){
        this.translationsMessagesCounter = 0;
        this.mediator = mediator;
        const engineLocalPath = browser.runtime.getURL("controller/translation/bergamot-translator-worker.js");
        const engineRemoteRegistry = browser.runtime.getURL("model/engineRegistry.js");
        const modelRegistry = browser.runtime.getURL("model/modelRegistry.js");
        if (window.Worker) {
            this.translationWorker = new Worker(browser.runtime.getURL("controller/translation/translationWorker.js"));
            this.translationWorker.addEventListener(
                "message",
                this.translationWorkerMessageListener.bind(this)
            );
            this.translationWorker.postMessage([
                "configEngine",
                {
                    engineLocalPath,
                    engineRemoteRegistry,
                    modelRegistry
                }
            ])
        }
    }

    /*
     * handles all communicaiton received from the translation webworker
     */
    translationWorkerMessageListener(translationMessage) {
        switch (translationMessage.data[0]) {
            case "translationComplete":
                this.mediator.contentScriptsMessageListener(this, {
                    command: "translationComplete",
                    payload: translationMessage.data
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
            default:
        }
    }

    /*
     * translation request received from the mediator. let's just send
     * the message to the worker
     */
    translate(translationMessage) {
        if (this.translationWorker) {
            this.translationWorker.postMessage([
                "translate",
                translationMessage
            ]);
        }
    }

    // eslint-disable-next-line max-params
    constructTranslationMessage(
        sourceParagraph,
        type,
        tabId,
        navigatorLanguage,
        pageLanguage,
        attrId
    ) {

        /*
         * translation request received. dispatch the content to the
         * translation worker
         */
        const translationMessage = new TranslationMessage();
        this.translationsMessagesCounter += 1;
        translationMessage.messageID = this.translationsMessagesCounter;
        translationMessage.sourceParagraph = sourceParagraph;
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
        translationMessage.type = type;
        translationMessage.attrId = attrId;
        return translationMessage;
    }

    loadOutboundTranslation(translationMessage) {
        if (this.translationWorker) {
            this.translationWorker.postMessage([
                "loadOutboundTranslation",
                translationMessage
            ]);
        }
    }
}