/*
 * this is the DOM Parser responsible for both walk as observe for mutations
 * in the tree and submit translations and also render them when returned
 * authors: @andrenatal, @jelmervdl
 */

/* eslint-disable max-lines-per-function */
/* eslint-disable max-lines */
// eslint-disable-next-line no-unused-vars
class InPageTranslation {

    // eslint-disable-next-line max-lines-per-function
    constructor(mediator) {
        this.translationsCounter = 0;
        this.mediator = mediator;
        this.started = false;
        this.language = null;
        this.viewportNodeMap = new Map();
        this.hiddenNodeMap = new Map();
        this.nonviewportNodeMap = new Map();
        this.updateMap = new Map();
        this.updateTimeout = null;
        this.UI_UPDATE_INTERVAL = 500;
        this.messagesSent = new Set();
        this.nodesSent = new WeakSet();
        this.initialWordsInViewportReported = false;
        this.withOutboundTranslation = null;
        this.withQualityEstimation = null;

        /*
         * reference for all tags:
         * https://developer.mozilla.org/en-US/docs/Web/HTML/Element
         */

        // tags that are treated as "meh inline tags just send them to the translator"
        this.inlineTags = new Set([
            "abbr",
            "a",
            "b",
            "em",
            "i",
            "kbd",
            "code",
            "mark",
            "math",
            "output",
            "q",
            "ruby",
            "small",
            // "span", // removed because Amazon uses it as a div. We now look at if 'display:contents'
            "strong",
            "sub",
            "sup",
            "time",
            "u",
            "var",
            "wbr",
            "ins",
            "del",

            // not really but for testing, also bergamot-translator treats them as sentece-breaking anyway
            "th",
            "td",
            "li",
            "br"
        ]);

        // tags that we do not want to translate
        this.excludedTags = new Set([
            // code-type elements generally don't translate well.
            "code",
            "kbd",
            "samp",
            "var",
            "dir", // dEPCREATED

            // debatable
            "acronym",

            /*
             * embedded media, lets not just yet. Maybe svg might be fun? Think
             * of inline diagrams that contain labels that we could translate.
             */
            "svg",
            "math",
            "embed",
            "object",
            "applet", // dEPRECATED
            "iframe",

            /*
             * elements that are treated as opaque by Firefox which causes their
             * innerHTML property to be just the raw text node behind it. So
             * no guarantee that the HTML is valid, which makes bergamot-
             * translator very unhappy.
             * (https://searchfox.org/mozilla-central/source/parser/html/nsHtml5Tokenizer.cpp#176)
             */
            "noscript",
            "noembed",
            "noframes",

            /*
             * title is already a special case, other than that I can't think of
             * anything in <head> that needs translating
             */
            "head",

            // don't attempt to translate any inline script or style
            "style",
            "script",

            // let's stay away from translating prefilled forms
            "textarea",

            /*
             * don't enter templates. We'll translate them once they become
             * part of the page proper.
             */
            "template",

            /*
             * handled in isExcludedNode
             * `*[lang]:not([lang|=${language}])`
             */
        ])
    }

    start(language) {
        if (this.started) return;

        /*
         * start the dom parser, the DOM mutation observer and request the
         * title to be translated
         */
        this.started = true;
        this.addDebugStylesheet();

        // language we expect. If we find elements that do not match, nope out.
        this.language = language;

        const pageTitle = document.getElementsByTagName("title")[0];
        if (pageTitle) {
            this.queueTranslation(pageTitle);
        }
        this.startTreeWalker(document.body);
        this.startMutationObserver();
    }

    addDebugStylesheet() {
        const element = document.createElement("style");
        document.head.appendChild(element);

        const sheet = element.sheet;
        sheet.insertRule("html[x-bergamot-debug] [x-bergamot-translated] { border: 2px solid red; }", 0);
        sheet.insertRule("html[x-bergamot-debug] [x-bergamot-translated~=\"skipped\"] { border: 2px solid purple; }", 1);
        sheet.insertRule("html[x-bergamot-debug] [x-bergamot-translated~=\"rejected\"] { border: 2px solid yellow; }", 2);
        sheet.insertRule("html[x-bergamot-debug] [x-bergamot-translated=\"\"] { border: 2px solid blue; }", 3);
        sheet.insertRule("html[x-bergamot-debug] [x-bergamot-translated=\"\"] [x-bergamot-translated~=\"is-excluded-node\"] { border: 4px dashed red; }", 4);
    }

    startTreeWalker(root) {
        const acceptNode = node => {
            return this.validateNode(node);
        }

        const nodeIterator = document.createTreeWalker(
            root,
            NodeFilter.SHOW_ELEMENT,
            acceptNode
        );

        let currentNode;
        // eslint-disable-next-line no-cond-assign
        while (currentNode = nodeIterator.nextNode()) {
            this.queueTranslation(currentNode);
        }

        this.dispatchTranslations();
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

    isElementHidden(element) {
        return element.style.display === "none" || element.style.visibility === "hidden" || element.offsetParent === null;
    }

    isParentTranslating(node){

        /*
         * if the parent of the node is already translating we should reject
         * it since we already sent it to translation
         */

        // if the immediate parent is the body we just allow it
        if (node.parentNode === document.body) {
            return false;
        }

        // let's iterate until we find either the body or if the parent was sent
        let lastNode = node;
        while (lastNode.parentNode) {
            // console.log("isParentTranslating node", node, " isParentTranslating nodeParent ", lastNode.parentNode);
            if (this.nodesSent.has(lastNode.parentNode)) {
                return true;
            }
            lastNode = lastNode.parentNode;
        }

        return false;
    }

    hasInlineContent(node) {
        let inlineElements = 0;
        let blockElements = 0;

        for (let child of node.childNodes) {
            switch (child.nodeType) {
                case 3: // textNode
                    if (child.textContent.trim().length > 0) inlineElements+=1;
                    break;

                case 1: // element
                    if (this.inlineTags.has(child.nodeName.toLowerCase()) ||
                        (child.nodeName.toLowerCase() === "span" && this.hasInlineContent(child))) inlineElements+=1;
                    else blockElements+=1;
                    break;
                default:
                    break;
            }
        }

        return inlineElements >= blockElements;
    }

    hasTextNodes(node) {
        // there is probably a quicker way to do this
        for (let child of node.childNodes) {
            switch (child.nodeType) {
                case 3: // textNode
                    if (child.textContent.trim() !== "") return true;
                    break;
                default:
                    break;
            }
        }

        return false;
    }

    isExcludedNode(node) {
        // exclude certain elements
        if (this.excludedTags.has(node.nodeName.toLowerCase())) return true;

        /*
         * exclude elements that have a lang attribute that mismatches the
         * language we're currently translating.
         */
        if (node.lang && node.lang.substr(0,2) !== this.language) return true;

        // we should explicitly exclude the outbound translations widget
        if (node.id === "OTapp") return true;

        return false;
    }

    containsExcludedNode(node) {

        /*
         * tODO describe this in terms of the function above, but I assume
         * using querySelector is faster for now.
         */
        return node.querySelector(`[lang]:not([lang|="${this.language}"]), ${Array.from(this.excludedTags).join(",")}`);
    }

    validateNode(node) {
        if (this.isExcludedNode(node)) {
            node.setAttribute("x-bergamot-translated", "rejected is-excluded-node");
            return NodeFilter.FILTER_REJECT;
        }

        if (node.textContent.trim().length === 0) {
            node.setAttribute("x-bergamot-translated", "rejected empty-text-content");
            return NodeFilter.FILTER_REJECT;
        }

        if (this.isParentTranslating(node)) {
            // node.setAttribute('x-bergamot-translated', 'rejected is-parent-translating');
            return NodeFilter.FILTER_REJECT;
        }

        if (!this.hasInlineContent(node)) {
            node.setAttribute("x-bergamot-translated", "skipped does-not-have-text-of-its-own");
            return NodeFilter.FILTER_SKIP; // otherwise dig deeper
        }

        if (this.containsExcludedNode(node) && !this.hasTextNodes(node)) {
            node.setAttribute("x-bergamot-translated", "skipped contains-excluded-node");
            return NodeFilter.FILTER_SKIP; // otherwise dig deeper
        }

        return NodeFilter.FILTER_ACCEPT; // send whole node as 1 block
    }

    queueTranslation(node) {

        /*
         * let's store the node to keep its reference
         * and send it to the translation worker
         */
        this.translationsCounter += 1;

        // debugging: mark the node so we can add CSS to see them
        node.setAttribute("x-bergamot-translated", this.translationsCounter);

        // let's categorize the elements on their respective hashmaps
        if (this.isElementHidden(node)) {
            // if the element is entirely hidden
            this.hiddenNodeMap.set(this.translationsCounter, node);
        } else if (this.isElementInViewport(node)) {
            // if the element is present in the viewport
            this.viewportNodeMap.set(this.translationsCounter, node);
        } else {
            // if the element is visible but not present in the viewport
            this.nonviewportNodeMap.set(this.translationsCounter, node);
        }
        this.nodesSent.add(node);
    }

    dispatchTranslations() {
        this.reportWordsInViewport();
        // we then submit for translation the elements in order of priority
        this.processingNodeMap = "viewportNodeMap";
        this.viewportNodeMap.forEach(this.submitTranslation, this);
        this.processingNodeMap = "nonviewportNodeMap";
        this.nonviewportNodeMap.forEach(this.submitTranslation, this);
        this.processingNodeMap = "hiddenNodeMap";
        this.hiddenNodeMap.forEach(this.submitTranslation, this);
    }

    reportWordsInViewport() {
        if (this.initialWordsInViewportReported || this.viewportNodeMap.size === 0) return;

        let viewPortWordsNum = 0;
        for (const [, value] of this.viewportNodeMap.entries()) {
            viewPortWordsNum += value.textContent.trim().split(" ").length;
        }

        this.notifyMediator("viewPortWordsNum", viewPortWordsNum);
        // report words in viewport only for initially loaded content
        this.initialWordsInViewportReported = true;
    }

    submitTranslation(node, key) {
        if (this.messagesSent.has(key)) {
            // if we already sent this message, we just skip it
            return;
        }

        /*
         * give each element an id that gets passed through the translation so
         * we can later on reunite it.
         */
        node.querySelectorAll("*").forEach((el, i) => {
            el.dataset.xBergamotId = i;
        });

        const text = node.innerHTML;
        if (text.trim().length) {

          /*
           * send the content back to mediator in order to have the translation
           * requested by it
           */
          const payload = {
            text,
            type: "inpage",
            withOutboundTranslation: this.withOutboundTranslation,
            withQualityEstimation: this.withQualityEstimation,
            attrId: [
                     this.processingNodeMap,
                     key
                    ],
          };
          this.notifyMediator("translate", payload);
          this.messagesSent.add(key);
        }
    }

    notifyMediator(command, payload) {
        this.mediator.contentScriptsMessageListener(this, { command, payload });
    }

    startMutationObserver() {
        // select the node that will be observed for mutations
        const targetNode = document;

        // options for the observer (which mutations to observe)
        const config = {
            characterData: true,
            childList: true,
            subtree: true
        };

        // create an observer instance linked to the callback function
        const observer = new MutationObserver(mutationsList => {
            for (const mutation of mutationsList) {
                switch (mutation.type) {
                    case "childList":
                        mutation.addedNodes.forEach(node => this.startTreeWalker(node));
                        break;
                    case "characterData":
                        this.startTreeWalker(mutation.target.parentNode);
                        break;
                    default:
                        break;
                }
            }
        });

        // start observing the target node for configured mutations
        observer.observe(targetNode, config);
    }

    mediatorNotification(translationMessage) {

        /*
         * notification received from the mediator with our request.
         * the only possible notification can be a translation response,
         * so let's schedule the update of the original node with its new content
         */
        this.enqueueElement(translationMessage);
    }

    updateElements() {
        const updateElement = (translatedHTML, node) => {
            // console.groupCollapsed(computePath(node));
            node.setAttribute("x-bergamot-translated", "");

            const scratch = node.cloneNode(false); // shallow clone of parent node
            scratch.innerHTML = translatedHTML;

            const originalHTML = node.innerHTML;

            /*
             * console.log(node);
             * console.log(`Translated: ${translatedHTML}`);
             * console.log(`Original:   ${originalHTML}`);
             */

            const clonedNodes = new Set();

            const removeTextNodes = node => {
                Array.from(node.childNodes).forEach(child => {
                    switch (child.nodeType) {
                        case Node.TEXT_NODE:
                            node.removeChild(child);
                            break;
                        case Node.ELEMENT_NODE:
                            removeTextNodes(child);
                            break;
                        default:
                            break;
                    }
                });
            };

            /*
             * merge the live tree (dst) with the translated tree (src) by
             * re-using elements from the live tree.
             */
            const merge = (dst, src) => {

                /*
                 * remove all live nodes at this branch of the tree, but keep
                 * an (indexed) reference to them since we will be adding them
                 * back, but possibly in a different order.
                 */
                const dstChildNodes = Object.fromEntries(Array.from(dst.childNodes)
                    .map(child => dst.removeChild(child))
                    .filter(child => child.nodeType === Node.ELEMENT_NODE)
                    .map(child => [child.dataset.xBergamotId, child]));

                // src (translated) dictates the order.
                Array.from(src.childNodes).forEach(child => {
                    // element nodes we try to use the already existing DOM nodes
                    if (child.nodeType === Node.ELEMENT_NODE) {

                        /*
                         * find an element in the live tree that matches the
                         * one in the translated tree.
                         */
                        let counterpart = dstChildNodes[child.dataset.xBergamotId];

                        if (!counterpart) {
                            console.warn(`[InPlaceTranslation] ${this.computePath(child, scratch)} Could not find counterpart for`, child.dataset.xBergamotId, dstChildNodes, child);
                            return;
                        }

                        /*
                         * if it already has a parentNode, we already used it
                         * with appendChild. This can happen, bergamot-translator
                         * can duplicate HTML in the same branch.
                         */
                        if (counterpart.parentNode) {
                            counterpart = counterpart.cloneNode(true);
                            clonedNodes.add(counterpart.dataset.xBergamotId);
                            console.warn(`[InPlaceTranslation] ${this.computePath(child, scratch)} Cloning node`, counterpart, "because it was already inserted earlier");
                        }

                        /*
                         * only attempt a recursive merge if there is anything
                         * to merge (I mean any translated text)
                         */
                        if (child.innerText?.trim()) merge(counterpart, child);
                        else if (counterpart.innerText?.trim()) {

                            /*
                             * oh this is bad. The original node had text, but
                             * the one that came out of translation doesn't?
                             */
                            console.warn(`[InPlaceTranslation] ${this.computePath(child, scratch)} Child ${child.outerHTML} has no text but counterpart ${counterpart.outerHTML} does`);
                            removeTextNodes(counterpart); // this should not be necessary
                        }

                        /*
                         * put the live node back in the live branch. But now
                         * it has been synced with the translated text and order.
                         */
                        dst.appendChild(counterpart);
                    } else {
                        // all other node types we just copy in directly
                        dst.appendChild(child);
                    }
                });

                const lost = Object.values(dstChildNodes)
                    .filter(child => !child.parentNode);

                if (lost.length) console.warn(`[InPlaceTranslation] ${this.computePath(src, scratch)} Not all nodes unified`, {
                        lost,
                        cloned: Array.from(clonedNodes.values()),
                        originalHTML,
                        translatedHTML,
                        dst: dst.outerHTML,
                        src: src.outerHTML
                    });
            };

            merge(node, scratch);

            /*
             * is this a good idea?
             * this.nodesSent.delete(node);
             * console.groupEnd(computePath(node));
             */
        };

        this.updateMap.forEach(updateElement);
        this.updateMap.clear();
        this.updateTimeout = null;
    }

    enqueueElement(translationMessage) {
        const [
               hashMapName,
               idCounter
              ] = translationMessage.attrId;
        const translatedText = translationMessage.translatedParagraph;
        // console.log("no enqueue", translatedText);
        let targetNode = null;
        switch (hashMapName) {
            case "hiddenNodeMap":
                targetNode = this.hiddenNodeMap.get(idCounter);
                this.hiddenNodeMap.delete(idCounter);
                break;
            case "viewportNodeMap":
                targetNode = this.viewportNodeMap.get(idCounter);
                this.viewportNodeMap.delete(idCounter);
                break;
            case "nonviewportNodeMap":
                targetNode = this.nonviewportNodeMap.get(idCounter);
                this.nonviewportNodeMap.delete(idCounter);
                break;
            default:
                break;
        }
        this.messagesSent.delete(idCounter);
        this.updateMap.set(targetNode, translatedText);
        // we finally schedule the UI update
        if (!this.updateTimeout) {
            this.updateTimeout = setTimeout(this.updateElements.bind(this),this.UI_UPDATE_INTERVAL);
        }
    }

    computePath(node, root) {
        // eslint-disable-next-line no-param-reassign
        if (root === null) root = document.body;
        let path = node.parentNode && node.parentNode !== root
            ? this.computePath(node.parentNode)
            : "";
        path += `/${node.nodeName}`
        if (node.id) path += `#${node.id}`;
        else if (node.className) path += `.${Array.from(node.classList).join(".")}`;
        return path;
    }
}