/*
 * this is the DOM Parser responsible for both walk as observe for mutations
 * in the tree and submit translations and also render them when returned
 * authors: @andrenatal, @jelmervdl
 */

/* global reportErrorsWrap */

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

        /* timeout between First Translation Received -> Update DOM With Translations. */
        this.updateTimeout = null;
        this.UI_UPDATE_INTERVAL = 500;

        /*
         * table of [Element]:Object to be submitted, and some info about them.
         * Filled by queueTranslation(), emptied by dispatchTranslation().
         */
        this.queuedNodes = new Map();

        /*
         * table of [Number]:Element of nodes that have been submitted, and are
         * waiting for a translation.
         */
        this.pendingTranslations = new Map();

        /*
         * table of [Element]:Number, inverse of pendingTranslations for easy
         * cancelling of incoming responses when the node changed after
         * submission of the request.
         */
        this.submittedNodes = new Map();

        /*
         * queue with the translation text that they should
         * be filled with once updateTimeout is reached. Filled by
         * `queueTranslationResponse()` and emptied by `updateElements()`.
         */
        this.translatedNodes = new Map();

        /*
         * set of elements that have been translated and should not be submitted
         * again unless their contents changed.
         */
        this.processedNodes = new WeakSet();

        // all elements we're actively trying to translate.
        this.targetNodes = new Set();

        this.initialWordsInViewportReported = false;
        this.withOutboundTranslation = null;
        this.withQualityEstimation = null;
        this.QE_THRESHOLD = Math.log(0.5);
        this.qeAttributes = new Set([
            "x-bergamot-sentence-index", "x-bergamot-sentence-score",
            "x-bergamot-word-index", "x-bergamot-word-score",
        ]);

        /*
         * reference for all tags:
         * https://developer.mozilla.org/en-US/docs/Web/HTML/Element
         */

        // tags that are treated as "meh inline tags just send them to the translator"
        this.inlineTags = new Set([
            "abbr",
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
            "br",
        ]);

        /*
         * tags that give no hint about the inline-ness of their contents
         * because of how they are used in modern web development.
         */
        this.genericTags = new Set([
            "a",
            "span",
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
             * `*[translate=no]`
             */
        ])

        this.observer = new MutationObserver(mutationsList => {
            reportErrorsWrap(() => {
                for (const mutation of mutationsList) {
                    switch (mutation.type) {
                        case "childList":
                            mutation.addedNodes.forEach(this.restartTreeWalker.bind(this));
                            break;
                        case "characterData":
                            this.restartTreeWalker(mutation.target);
                            break;
                        default:
                            break;
                    }
                }
            });
        });
    }

    addElement(node) {
        // exclude non elements
        if (!(node instanceof Element)) return;

        // exclude nodes we're already tracking
        if (this.targetNodes.has(node)) return;

        this.targetNodes.add(node);

        if (this.started) {
            this.startTreeWalker(node);
            this.observer.observe(node, {
                characterData: true,
                childList: true,
                subtree: true
            });
        }
    }

    start(language) {
        if (this.started) return;

        /*
         * start the dom parser, the DOM mutation observer and request the
         * title to be translated
         */
        this.started = true;

        if (this.mediator.statsMode) this.addDebugStylesheet();
        if (this.withQualityEstimation) this.addQEStylesheet();

        // language we expect. If we find elements that do not match, nope out.
        this.language = language;

        /*
         * pre-construct the excluded node selector. Doing it here since it
         * needs to know `language`. See `containsExcludedNode()`.
         */
        this.excludedNodeSelector = `[lang]:not([lang|="${this.language}"]),[translate=no],.notranslate,[contenteditable],${Array.from(this.excludedTags).join(",")},#OTapp`;

        for (let node of this.targetNodes) this.startTreeWalker(node);

        this.startMutationObserver();
    }

    /*
     * stops the InPageTranslation process, stopping observing and regard any
     * in-flight translation request as lost.
     */
    stop() {
        if (!this.started) return;

        /*
         * todo: cancel translation requests? Not really necessary at this level
         * because stop() is called on disconnect from the background-script,
         * and that script on its own will cancel translation requests from
         * pages it is no longer connected to.
         */

        this.stopMutationObserver();

        /*
         * remove all elements for which we haven't received a translation yet
         * from the 'sent' list.
         */
        this.submittedNodes.clear();

        this.pendingTranslations.forEach(node => {
            this.processedNodes.delete(node);
            this.queueTranslation(node);
        })

        this.pendingTranslations.clear();

        this.started = false;
    }

    addDebugStylesheet() {
        const element = document.createElement("style");
        element.textContent = "";
        document.head.appendChild(element);
        if (!element.sheet) return;
        const sheet = element.sheet;
        sheet.insertRule("html[x-bergamot-debug] [x-bergamot-translated] { border: 2px solid red; }", 0);
        sheet.insertRule("html[x-bergamot-debug] [x-bergamot-translated~=\"skipped\"] { border: 2px solid purple; }", 1);
        sheet.insertRule("html[x-bergamot-debug] [x-bergamot-translated~=\"rejected\"] { border: 2px solid yellow; }", 2);
        sheet.insertRule("html[x-bergamot-debug] [x-bergamot-translated=\"\"] { border: 2px solid blue; }", 3);
        sheet.insertRule("html[x-bergamot-debug] [x-bergamot-translated=\"\"] [x-bergamot-translated~=\"is-excluded-node\"] { border: 4px dashed red; }", 4);
    }

    addQEStylesheet() {
        const element = document.createElement("style");
        element.textContent = "";
        document.head.appendChild(element);
        if (!element.sheet) return;
        const sheet = element.sheet;
        sheet.insertRule(`
        [x-bergamot-word-score].x-fxtranslations-bad { background-image:
            linear-gradient(45deg, transparent 65%, red 80%, transparent 90%),
            linear-gradient(135deg, transparent 5%, red 15%, transparent 25%),
            linear-gradient(135deg, transparent 45%, red 55%, transparent 65%),
            linear-gradient(45deg, transparent 25%, red 35%, transparent 50%);
          background-repeat:repeat-x;
          background-size: 8px 2px;
          background-position:0 95%;
        }`, 0);
        sheet.insertRule(`
        [x-bergamot-sentence-score].x-fxtranslations-bad {
            background: rgba(255, 128, 128, 0.8);
          }`, 1);
        sheet.insertRule(`
        [x-bergamot-sentence-index].highlight-sentence {
            background: rgba(255, 255, 128, 0.8);
          }
        `,2);
    }

    addQualityClasses () {
        document.querySelectorAll("[x-bergamot-sentence-score]").forEach(el => {
            const sentenceScore = parseFloat(el.getAttribute("x-bergamot-sentence-score"));
            if (sentenceScore < this.QE_THRESHOLD) {
                el.classList.toggle("x-fxtranslations-bad", true);
            }
        });

        document.querySelectorAll("[x-bergamot-word-score]").forEach(el => {
            const wordScore = parseFloat(el.getAttribute("x-bergamot-word-score"));
            if (wordScore < this.QE_THRESHOLD) {
                el.classList.toggle("x-fxtranslations-bad",true);
            }
        });
    }

    /*
     * start walking from `root` down through the DOM tree and decide which
     * elements to enqueue for translation.
     */
    startTreeWalker(root) {

        /*
         * if the parent itself is rejected, we don't translate any children.
         * However, if this is a specifically targeted node, we don't do this
         * check. Mainly so we can exclude <head>, but include <title>.
         */
        if (!this.targetNodes.has(root)) {
            for (let parent of this.ancestors(root)) {
                if (this.validateNode(parent) === NodeFilter.FILTER_REJECT) return;
            }
        }

        /*
         * bit of added complicated logic to include `root` in the set
         * of nodes that is being evaluated. Normally TreeWalker will only
         * look at the descendants.
         */
        switch (this.validateNodeForQueue(root)) {
            // if even the root is already rejected, no need to look further
            case NodeFilter.FILTER_REJECT:
                return;

            /*
             * if the root itself is accepted, we don't need to drill down
             * either. But we do want to call dispatchTranslations().
             */
            case NodeFilter.FILTER_ACCEPT:
                this.queueTranslation(root);
                break;

            /*
             * if we skip the root (because it's a block element and we want to
             * cut it into smaller chunks first) then start tree walking to
             * those smaller chunks.
             */
            case NodeFilter.FILTER_SKIP: {
                const nodeIterator = document.createTreeWalker(
                    root,
                    NodeFilter.SHOW_ELEMENT,
                    this.validateNodeForQueue.bind(this)
                );

                let currentNode;

                // eslint-disable-next-line no-cond-assign
                while (currentNode = nodeIterator.nextNode()) {
                    this.queueTranslation(currentNode);
                }
            } break;

            default:
                // here because of linter, this point is never reached.
                break;
        }

        this.dispatchTranslations();
    }

    /*
     * like startTreeWalker, but without the "oh ignore this element if it has
     * already been submitted" bit. Use this one for submitting changed elements.
     */
    restartTreeWalker(root) {

        /*
         * remove node from sent map: if it was send, we don't want it to update
         * with an old translation once the translation response comes in.
         */
        const id = this.submittedNodes.get(root);
        if (id) {
            this.submittedNodes.delete(root);
            this.pendingTranslations.delete(id);
        }

        // remove node from processed list: we want to reprocess it.
        this.processedNodes.delete(root);

        // start submitting it again
        this.startTreeWalker(root);
    }

    isElementInViewport(element) {
        // eslint-disable-next-line no-param-reassign
        if (element.nodeType === Node.TEXT_NODE) element = element.parentElement;

        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    isElementHidden(element) {
        // eslint-disable-next-line no-param-reassign
        if (element.nodeType === Node.TEXT_NODE) element = element.parentElement;

        const computedStyle = window.getComputedStyle(element);
        return computedStyle.display === "none" ||
                computedStyle.visibility === "hidden" ||
                element.offsetParent === null;
    }

    /*
     * test whether any of the parent nodes are already in the process of being
     * translated. If the parent of the node is already translating we should
     * reject it since we already sent it to translation.
     */
    isParentQueued(node){
        // if the immediate parent is the body we just allow it
        if (node.parentNode === document.body) {
            return false;
        }

        // let's iterate until we find either the body or if the parent was sent
        let lastNode = node;
        while (lastNode.parentNode) {
            if (this.queuedNodes.has(lastNode.parentNode)) {
                return lastNode.parentNode;
            }
            lastNode = lastNode.parentNode;
        }

        return false;
    }

    /*
     * test whether this node should be treated as a wrapper of text, e.g.
     * a `<p>`, or as a wrapper for block elements, e.g. `<div>`, based on
     * its contents. The first we submit for translation, the second we try to
     * split into smaller chunks of HTML for better latency.
     */
    hasInlineContent(node) {
        if (node.nodeType === Node.TEXT_NODE) return true;

        let inlineElements = 0;
        let blockElements = 0;

        for (let child of node.childNodes) {
            switch (child.nodeType) {
                case Node.TEXT_NODE:
                    if (child.textContent.trim().length > 0) inlineElements += 1;
                    break;
                case Node.ELEMENT_NODE: // element
                    if (this.inlineTags.has(child.nodeName.toLowerCase())) inlineElements += 1;
                    else if (this.genericTags.has(child.nodeName.toLowerCase()) && this.hasInlineContent(child)) inlineElements += 1;
                    else blockElements += 1;
                    break;
                default:
                    break;
            }
        }

        return inlineElements >= blockElements;
    }

    /*
     * test whether any of the direct text nodes of this node are non-whitespace
     * text nodes.
     *
     * For example:
     *   - `<p>test</p>`: yes
     *   - `<p> </p>`: no
     *   - `<p><b>test</b></p>`: no
     */
    hasTextNodes(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        // there is probably a quicker way to do this
        for (let child of node.childNodes) {
            switch (child.nodeType) {
                case Node.TEXT_NODE: // textNode
                    if (child.textContent.trim() !== "") return true;
                    break;
                default:
                    break;
            }
        }

        return false;
    }

    /*
     * test whether this is an element we do not want to translate. These
     * are things like `<code>`, elements with a different `lang` attribute,
     * and elements that have a `translate=no` attribute.
     */
    isExcludedNode(node) {
        // text nodes are never excluded
        if (node.nodeType === Node.TEXT_NODE) return false;

        // exclude certain elements
        if (this.excludedTags.has(node.nodeName.toLowerCase())) return true;

        /*
         * exclude elements that have a lang attribute that mismatches the
         * language we're currently translating.
         */
        if (node.lang && node.lang.substr(0,2) !== this.language) return true;

        /*
         * exclude elements that have an translate=no attribute
         * (See https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/translate)
         */
        if (node.translate === false || node.getAttribute("translate") === "no") return true;

        // we should explicitly exclude the outbound translations widget
        if (node.id === "OTapp") return true;

        /*
         * exclude elements with the notranslate class which is also honoured
         * by Google Translate
         */
        if (node.classList.contains("notranslate")) return true;

        /*
         * exclude editable elements for the same reason we don't translate the
         * contents of form input fields.
         */
        if (node.contenteditable) return true;

        return false;
    }

    /*
     * like `isExcludedNode` but looks at the full subtree. Used to see whether
     * we can submit a subtree, or whether we should split it into smaller
     * branches first to try to exclude more of the non-translatable content.
     */
    containsExcludedNode(node) {
        return node.nodeType === Node.ELEMENT_NODE && node.querySelector(this.excludedNodeSelector);
    }

    /*
     * used by TreeWalker to determine whether to ACCEPT, REJECT or SKIP a
     * subtree. Only checks if the element is acceptable. It does not check
     * whether the element has been translated already, which makes it usable
     * on parent nodes to validate whether a child node is in a translatable
     * context.
     *
     * Returns:
     *   - FILTER_ACCEPT: this subtree should be a translation request.
     *   - FILTER_SKIP  : this node itself should not be a translation request
     *                    but subtrees beneath it could be!
     *   - FILTER_REJECT: skip this node and everything beneath it.
     */
    validateNode(node) {
        // little helper to add markings to elements for debugging
        const mark = value => {
            if (node.nodeType === Node.ELEMENT_NODE) node.setAttribute("x-bergamot-translated", value);
        };

        /*
         * don't resubmit subtrees that are already in progress (unless their
         * contents have been changed
         */
        if (this.queuedNodes.has(node) || this.isParentQueued(node)) {
            // node.setAttribute("x-bergamot-translated", "rejected is-parent-translating");
            return NodeFilter.FILTER_REJECT;
        }

        // exclude nodes that we don't want to translate
        if (this.isExcludedNode(node)) {
            mark("rejected is-excluded-node");
            return NodeFilter.FILTER_REJECT;
        }

        // skip over subtrees that don"t have text
        if (node.textContent.trim().length === 0) {
            mark("rejected empty-text-content");
            return NodeFilter.FILTER_REJECT;
        }

        if (!this.hasInlineContent(node)) {
            mark("skipped does-not-have-text-of-its-own");
            return NodeFilter.FILTER_SKIP; // otherwise dig deeper
        }

        if (this.containsExcludedNode(node) && !this.hasTextNodes(node)) {
            mark("skipped contains-excluded-node");
            return NodeFilter.FILTER_SKIP; // otherwise dig deeper
        }

        return NodeFilter.FILTER_ACCEPT; // send whole node as 1 block
    }

    /*
     * used by TreeWalker to determine whether to ACCEPT, REJECT or SKIP a
     * subtree. Checks whether element is acceptable, and hasn't been
     * translated already.
     */
    validateNodeForQueue(node) {
        // skip nodes already seen (for the partial subtree change, or restart of the whole InPageTranslation process.)
        if (this.processedNodes.has(node)) return NodeFilter.FILTER_REJECT;

        return this.validateNode(node);
    }

    /*
     * enqueue a node for translation. Called during startTreeWalker. Queues
     * are emptied by dispatchTranslation().
     */
    queueTranslation(node) {
        this.translationsCounter += 1;

        // debugging: mark the node so we can add CSS to see them
        if (node.nodeType === Node.ELEMENT_NODE) node.setAttribute("x-bergamot-translated", this.translationsCounter);

        let priority = 2;
        if (this.isElementHidden(node)) priority = 3;
        else if (this.isElementInViewport(node)) priority = 1;

        this.queuedNodes.set(node, {
            id: this.translationsCounter,
            priority
        });
    }

    dispatchTranslations() {
        this.reportWordsInViewport();

        const queuesPerPriority = [null, [], [], []] // priorities 1 to 3
        this.queuedNodes.forEach((message, node) => {
            queuesPerPriority[message.priority].push({ message, node });
        });

        for (let priority = 1; priority <= 3; priority += 1) {
            queuesPerPriority[priority].forEach(({ message, node }) => {
                this.submitTranslation(message, node);
            });
        }

        this.queuedNodes.clear();
    }

    reportWordsInViewport() {
        if (this.initialWordsInViewportReported || this.queuedNodes.size === 0) return;

        let viewPortWordsNum = 0;
        for (const [message, value] of this.queuedNodes.entries()) {
            if (message.priority === 3) {
                viewPortWordsNum += value.textContent.trim().split(/\s+/).length;
            }
        }

        this.notifyMediator("reportViewPortWordsNum", viewPortWordsNum);
        // report words in viewport only for initially loaded content
        this.initialWordsInViewportReported = true;
    }

    submitTranslation({ id }, node) {
        // give each element an id that gets passed through the translation so we can later on reunite it.
        if (node.nodeType === Node.ELEMENT_NODE) {
            node.querySelectorAll("*").forEach((el, i) => {
                el.dataset.xBergamotId = i;
            });
        }

        const text = node.nodeType === Node.ELEMENT_NODE
? node.innerHTML
: node.textContent;
        if (text.trim().length === 0) return;

        this.notifyMediator("translate", {
            text,
            isHTML: node.nodeType === Node.ELEMENT_NODE,
            type: "inpage",
            withOutboundTranslation: this.withOutboundTranslation,
            withQualityEstimation: this.withQualityEstimation,
            attrId: [id],
        });

        // keep reference to this node for once we receive a translation response.
        this.pendingTranslations.set(id, node);
        this.submittedNodes.set(node, id);

        // also mark this node as not to be translated again unless the contents are changed (which the observer will pick up on)
        this.processedNodes.add(node);
    }

    notifyMediator(command, payload) {
        this.mediator.contentScriptsMessageListener(this, { command, payload });
    }

    startMutationObserver() {
        for (let node of this.targetNodes) {
            this.observer.observe(node, {
                characterData: true,
                childList: true,
                subtree: true
            });
        }
    }

    stopMutationObserver() {
        this.observer.disconnect();
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
        const updateElement = ({ translatedHTML }, node) => {
            // console.groupCollapsed(computePath(node));
            node.setAttribute("x-bergamot-translated", "");

            /*
             * create a scratch (a DocumentFragment) from translated html that will be
             * used to populate the live tree with the translated content
             */
            const nonLiveDomContainer = document.createElement("template");
            nonLiveDomContainer.innerHTML = translatedHTML;
            const scratch = nonLiveDomContainer.content;

            const originalHTML = node.innerHTML;

            /*
             * console.log(node);
             * console.log(`Translated: ${translatedHTML}`);
             * console.log(`Original:   ${originalHTML}`);
             */

            const clonedNodes = new Set();

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
                const nodes = Array.from(dst.childNodes).map(child => dst.removeChild(child));

                const dstChildNodes = Object.fromEntries(nodes
                    .filter(child => child.nodeType === Node.ELEMENT_NODE)
                    .map(child => [child.dataset.xBergamotId, child]));

                const dstTextNodes = nodes.filter(child => child.nodeType === Node.TEXT_NODE);

                // src (translated) dictates the order.
                Array.from(src.childNodes).forEach((child, index, siblings) => {
                    // element nodes we try to use the already existing DOM nodes
                    if (child.nodeType === Node.ELEMENT_NODE) {

                        /*
                         * find an element in the live tree that matches the
                         * one in the translated tree.
                         */
                        let counterpart = dstChildNodes[child.dataset.xBergamotId];

                        if (!counterpart) {

                            /*
                             * if translated element child doesn't have data-x-bergamot-id attribute and
                             * has only quality score specific attributes (that are set by translation engine
                             * when QE is on) then just add the translated element child to the live
                             * element node.
                             */
                            if (!child.hasAttribute("data-x-bergamot-id") && this.hasOnlyQEAttributes(child)) {
                                dst.appendChild(child);
                            } else {
                                console.warn(`[InPlaceTranslation] ${this.computePath(child, scratch)} Could not find counterpart for`, child.dataset.xBergamotId, dstChildNodes, child);
                            }
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

                            /*
                             * todo: This scenario might be caused by one of two
                             * causes: 1) element was duplicated by translation
                             * but then not given text content. This happens on
                             * Wikipedia articles for example.
                             * Or 2) the translator messed up and could not
                             * translate the text. This happens on Youtube in the
                             * language selector. In that case, having the original
                             * text is much better than no text at all.
                             * To make sure it is this case, and not option 2
                             * we check whether this is the only occurrence.
                             */
                            if (siblings.some((sibling, i) => sibling.nodeType === Node.ELEMENT_NODE && index !== i && child.dataset.xBergamotId === sibling.dataset.xBergamotId)) this.removeTextNodes(counterpart);
                        }

                        /*
                         * put the live node back in the live branch. But now
                         * it has been synced with the translated text and order.
                         */
                        dst.appendChild(counterpart);
                    } else if (child.nodeType === Node.TEXT_NODE) {
                        let counterpart = dstTextNodes.shift();

                        if (typeof counterpart !== "undefined") counterpart.data = child.data;
                        else counterpart = child;

                        dst.appendChild(counterpart);
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

            return node;
        };

        const updateTextNode = ({ translatedHTML }, node) => {

            /*
             * regardless of withQualityEstimation, if translatedHTML is empty
             * we have an empty string as output. Which is useless.
             */
            if (translatedHTML.trim().length === 0) {
                console.warn("[InPlaceTranslation] text node", node, "translated to <empty string>");
                return node;
            }

            /*
             * when we're getting quality estimations back, translatedHTML is
             * indeed actual HTML with font tags containing that info.
             */
            if (this.withQualityEstimation) {
                const nonLiveDomContainer = document.createElement("template");
                nonLiveDomContainer.innerHTML = translatedHTML;

                const fragment = document.createDocumentFragment();
                for (let child of nonLiveDomContainer.content.childNodes) {
                    if (this.hasOnlyQEAttributes(child)) {
                        fragment.appendChild(child);
                    }
                }
                node.parentNode.replaceChild(fragment, node);
                return fragment;
            }
                node.textContent = translatedHTML;
                return node;

        };

        // pause observing mutations
        this.stopMutationObserver();

        try {
            const touchedNodes = Array.from(this.translatedNodes, ([node, message]) => {
                switch (node.nodeType) {
                    case Node.TEXT_NODE:
                        return updateTextNode(message, node);
                    case Node.ELEMENT_NODE:
                        return updateElement(message, node);
                    default:
                        return node; // never happens
                }
            });
            if (this.withQualityEstimation) this.reportQualityEstimation(touchedNodes);
            this.translatedNodes.clear();
            this.updateTimeout = null;
            if (this.withQualityEstimation) this.addQualityClasses();
        } finally {
            this.startMutationObserver();
        }
    }

    reportQualityEstimation(nodes) {
        let wordScores = new Map();
        let sentScores = new Map();
        for (let node of nodes) {
            const nodeIterator = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
            let currentNode = nodeIterator.currentNode;
            while (currentNode) {
                if (currentNode.hasAttribute("x-bergamot-word-score")) {
                    wordScores.set(currentNode, parseFloat(currentNode.getAttribute("x-bergamot-word-score")));
                }
                if (currentNode.hasAttribute("x-bergamot-sentence-score")) {
                    sentScores.set(currentNode, parseFloat(currentNode.getAttribute("x-bergamot-sentence-score")));
                }
                currentNode = nodeIterator.nextNode();
            }
        }
        if ((sentScores.size > 0) || (wordScores.size > 0)) {
            this.notifyMediator("reportQeMetrics", {
                wordScores: Array.from(wordScores.values()),
                sentScores: Array.from(sentScores.values())
            });
        }
    }

    enqueueElement(translationMessage) {
        const [id] = translationMessage.attrId;
        const translatedHTML = translationMessage.translatedParagraph;

        // look up node by message id. This can fail
        const node = this.pendingTranslations.get(id);
        if (typeof node === "undefined") {
            console.debug("[in-page-translation] Message",id,"is not found in pendingTranslations");
            return;
        }

        // prune it.
        this.pendingTranslations.delete(id);

        // node still exists! Remove node -> (pending) message mapping
        this.submittedNodes.delete(node);

        // queue node to be populated with translation next update.
        this.translatedNodes.set(node, { id, translatedHTML });

        // we schedule the UI update
        if (!this.updateTimeout) this.updateTimeout = setTimeout(this.updateElements.bind(this), this.submittedNodes.size === 0
? 0
: this.UI_UPDATE_INTERVAL);
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

    *ancestors(node) {
        for (let parent = node.parentNode; parent && parent !== document.documentElement; parent = parent.parentNode) yield parent;
    }

    /*
     * check (recursively) if a given node and all its children have only QE specific attributes
     */
    hasOnlyQEAttributes(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.nodeName.toUpperCase() !== "FONT") return false;

            if (!node.getAttributeNames().every(attribute => this.qeAttributes.has(attribute))) return false;

            for (let child of node.children) if (!this.hasOnlyQEAttributes(child)) return false;
        }
        return true;
    }

    removeTextNodes(node) {
        Array.from(node.childNodes).forEach(child => {
            switch (child.nodeType) {
                case Node.TEXT_NODE:
                    node.removeChild(child);
                    break;
                case Node.ELEMENT_NODE:
                    this.removeTextNodes(child);
                    break;
                default:
                    break;
            }
        });
    }
}