/* This class is responsible for all translations related operations, like
interacting with the web worker, handle the language models, and communicate with the
mediator */

class Translation {
    constructor (mediator){
        if (window.Worker) {
            this.translationWorker = new Worker(browser.runtime.getURL("controller/translation/translationWorker.js"));
            this.translationWorker.addEventListener("message", this.translationWorkerMessageListener);
            this.mediator = mediator;
        }
    }

    /*
     * handles all communicaiton received from the translation webworker
     */
    translationWorkerMessageListener(translationMessage) {
        // submit the translated message back to the mediator
        this.mediator.contentScriptsMessageListener(translationMessage);
    }

    translate(translationMessage) {
        // translation request received from the mediator. let's just send
        // the message to the worker
        if (this.translationWorker) {
            this.translationWorker.postMessage([
                "translate",
                translationMessage
            ]);
        }
    }
}
