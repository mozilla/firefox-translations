/*
 * this class is responsible for all translations related operations, like
 * interacting with the web worker, handle the language models, and communicate with the
 * mediator
 */

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
        if (type === "outbound") {
            translationMessage.sourceLanguage = navigatorLanguage;
            translationMessage.targetLanguage = pageLanguage;
        } else if (type === "inpage" || type === "load"){
            translationMessage.sourceLanguage = pageLanguage;
            translationMessage.targetLanguage = navigatorLanguage;
        }
        translationMessage.tabId = tabId;
        translationMessage.type = type;
        translationMessage.attrId = attrId;
        return translationMessage;
    }
}