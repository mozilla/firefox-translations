
class InPageTranslation {

    constructor(mediator) {
        this.idsCounter = 0;
        this.mediator = mediator;
        this.started = false;
        this.loadTagsSet()
    }

    loadTagsSet() {
        // set of element types we want to translate
        this.tagsSet = new Set();
        this.tagsSet.add("div");
        this.tagsSet.add("p");
        this.tagsSet.add("span");

    }

    start() {
        this.started = true;
        this.startTreeWalker();
        this.startMutationObserver();
    }

    startTreeWalker() {
        const acceptNode = (node) => {
            return this.tagsSet.has(node.nodeName.toLowerCase()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
        const nodeIterator = document.createNodeIterator(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            acceptNode
        );
        let currentNode;
        // eslint-disable-next-line no-cond-assign
        while (currentNode = nodeIterator.nextNode()) {
            console.log("mark and send to translation", currentNode.innerHTML);
            this.sendToTranslation(currentNode);
        }
    }

    sendToTranslation(newNode) {

        /*
         * let's set the translations attribute with the internal id in order
         * to track it when it returns and properly replace the text
         */
        this.idsCounter += 1;
        newNode.setAttribute("fxtrnsId", this.idsCounter);
        const text = newNode.innerText;
        if (text.trim().length) {

          /*
           * send the content back to mediator in order to have the translation
           * requested by it
           */
          const payload = {
            text: text.split("\n"),
            type: "inpage",
            attrId: this.idsCounter
          };
          this.notifyMediator("translate", payload);
        }
        console.log("inpage sendToTranslation sent", newNode);
    }

    notifyMediator(command, payload) {
        this.mediator.contentScriptsMessageListener(this, { command, payload });
      }

    startMutationObserver() {
        // select the node that will be observed for mutations
        const targetNode = document;

        // options for the observer (which mutations to observe)
        const config = { attributes: true, childList: true, subtree: true };
        // callback function to execute when mutations are observed
        const callback = function(mutationsList, observer) {
            for (const mutation of mutationsList) {
                if (mutation.type === "childList") {
                    console.log(mutation);
                    mutation.addedNodes.forEach(node => this.sendToTranslation(node));
                }
            }
        }.bind(this);

        // create an observer instance linked to the callback function
        const observer = new MutationObserver(callback);

        // start observing the target node for configured mutations
        observer.observe(targetNode, config);

    }

    mediatorNotification(translationMessage) {

        /*
         * notification received from the mediator with our request. let's update
         * the original targeted textarea
         */
        this.updateElement(translationMessage);
      }

    updateElement(translationMessage) {
        const attrId = translationMessage.payload[1].attrId;
        const translatedText = translationMessage.payload[1].translatedParagraph.join("\n\n")
        // we should have only one match
        const match = document.querySelectorAll(`[fxtrnsId="${attrId}"]`);
        match[0].innerText = translatedText;
        console.log("result no inpage:",translationMessage);
    }
}