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
        // submit the translated message back to the mediator
        const message = {
            command: "translationComplete",
            payload: translationMessage.data
        };
        this.mediator.contentScriptsMessageListener(this, message);
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
}