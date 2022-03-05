/*
 * this class is responsible for all translations related operations, like
 * interacting with the web worker, handle the language models, and communicate with the
 * mediator
 */
/* global browser, TranslationMessage, Queue */

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
            // let's send to the background script send the message to the worker
            browser.runtime.sendMessage({
                command: "translate",
                payload: [translationMessage]
            });
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
        // timeout invoked. let's submit the messages
        const messagesToGo = [];

        // we'll process until the buffer is empty or we reach
        while (!this.translationMessageBuffer.isEmpty() && messagesToGo.length < this.MAX_TRANSLATION_MSGS) {
            const message = this.translationMessageBuffer.dequeue();
            messagesToGo.push(message);
        }

        // let's send to the background script send the message to the worker
        browser.runtime.sendMessage({
            command: "translate",
            payload: messagesToGo
        });

        // and schedule an update if required
        if (this.translationMessageBuffer.length() > 0) {
            setTimeout(this.submitMessages.bind(this), this.TRANSLATION_INTERVAL);
        }
        // inform it is complete
        this.translateSchedule = null;
    }

    // eslint-disable-next-line max-params
    constructTranslationMessage(
        sourceParagraph,
        type,
        tabId,
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
        translationMessage.type = type;
        translationMessage.attrId = attrId;
        translationMessage.withOutboundTranslation = withOutboundTranslation;
        translationMessage.withQualityEstimation = withQualityEstimation;
        return translationMessage;
    }
}