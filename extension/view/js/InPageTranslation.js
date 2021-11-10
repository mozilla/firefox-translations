
class InPageTranslation {

    constructor(mediator) {
        this.idsCounter = 0;
        this.mediator = mediator;
        this.started = false;
        this.loadTagsSet()
        this.nodeMap = new Map();
    }

    loadTagsSet() {
        // set of element types we want to translate
        this.tagsSet = new Set();
        this.tagsSet.add("div");
        this.tagsSet.add("p");
        this.tagsSet.add("span");
        this.tagsSet.add("#text");
        this.tagsSet.add("i");
        this.tagsSet.add("a");
        this.tagsSet.add("b");
        this.tagsSet.add("h3");
        this.tagsSet.add("h2");
        this.tagsSet.add("h1");
        this.tagsSet.add("h4");
        this.tagsSet.add("label");
    }

    start() {
        this.started = true;
        this.startTreeWalker();
        this.startMutationObserver();
    }

    startTreeWalker() {
        const acceptNode = node => {
            return this.validateNode(node);
        }
        const nodeIterator = document.createNodeIterator(
            document.body,
            // eslint-disable-next-line no-bitwise
            NodeFilter.SHOW_TEXT,
            acceptNode
        );


        let currentNode;
        // eslint-disable-next-line no-cond-assign
        while (currentNode = nodeIterator.nextNode()) {
            console.log("main loop", currentNode, this.isElementVisible(currentNode.parentNode), this.isElementInViewport(currentNode.parentNode), currentNode.nodeType, currentNode.tagName, currentNode.innerHTML, currentNode.wholeText);
            // let's prioritize the visible elements and the ones in the viewport
            if (this.isElementVisible(currentNode.parentNode) && this.isElementInViewport(currentNode.parentNode)) {
                this.sendToTranslation(currentNode);
            } else {

                /*
                 * add these elements to a queue to be processed after we have
                 * the visible ones completed
                 */
            }
        }
    }

    isElementInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    isElementVisible(element) {
        return element.offsetParent;
    }

    validateNode(node) {
        if (node.nodeType === 3) {
            if (this.tagsSet.has(node.parentNode.nodeName.toLowerCase()) &&
                node.textContent
                    .replaceAll("\n","")
                    .replaceAll("\t","")
                    .trim().length > 0) {
                return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
        }
        return this.tagsSet.has(node.nodeName.toLowerCase()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }

    sendToTranslation(newNode) {

        /*
         * let's store the node to keep its reference
         * and send it to the translation worker
         */
        this.idsCounter += 1;
        this.nodeMap.set(this.idsCounter, newNode);
        const text = newNode.textContent;
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
        console.log("inpage sendToTranslation sent", newNode.textContent);
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
        const idCounter = translationMessage.payload[1].attrId;
        const translatedText = translationMessage.payload[1].translatedParagraph.join("\n\n")
        // we should have only one match
        const targetNode = this.nodeMap.get(idCounter);
        targetNode.textContent = translatedText;
        console.log(translatedText);
    }
}