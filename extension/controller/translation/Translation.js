/*
 * this class is responsible for all translations related operations, like
 * interacting with the web worker, handle the language models, and communicate with the
 * mediator
 */

class Translation {
    constructor (mediator){
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
    constructTranslationMessage(sourceParagraph, translationType, sourceLanguage, targetLanguage, tabID) {

        /*
         * translation request received. dispatch the content to the
         * translation worker
         */
        const translationMessage = new TranslationMessage();
        this.translationsCounter += 1;
        translationMessage.messageID = this.translationsCounter;
        translationMessage.sourceParagraph = sourceParagraph;
        if (translationType === "outbound") {
            translationMessage.sourceLanguage = sourceLanguage;
            translationMessage.targetLanguage = targetLanguage;
        } else if (translationType === "inpage"){
            translationMessage.sourceLanguage = targetLanguage;
            translationMessage.targetLanguage = sourceLanguage;
        }
        translationMessage.tabID = tabID;

        return translationMessage;
    }
}