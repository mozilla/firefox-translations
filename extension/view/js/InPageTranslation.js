"use strict";

function computePath(node, root) {
    if (root === undefined)
        root = document.body;
    let path = node.parentNode && node.parentNode != root ? computePath(node.parentNode) : '';
    path += `/${node.nodeName}`
    if (node.id)
        path += `#${node.id}`;
    else if (node.className)
        path += `.${Array.from(node.classList).join('.')}`;
    return path;
}

function *ancestors(node) {
    for (let parent = node.parentNode; parent && parent != document.documentElement; parent = parent.parentNode)
        yield parent;
}

function removeTextNodes(node) {
    Array.from(node.childNodes).forEach(child => {
        switch (child.nodeType) {
            case Node.TEXT_NODE:
                node.removeChild(child);
                break;
            case Node.ELEMENT_NODE:
                removeTextNodes(child);
                break;
        }
    });
}

// eslint-disable-next-line no-unused-vars
class InPageTranslation {

    constructor(mediator) {
        this.translationsCounter = 0;
        this.mediator = mediator;
        this.started = false;
        this.language = null;
        
        // Timeout between First Translation Received -> Update DOM With Translations.
        this.updateTimeout = null;
        this.UI_UPDATE_INTERVAL = 500;

        // Table of [Element]:Object to be submitted, and some info about them.
        // Filled by enqueueTranslation(), emptied by dispatchTranslation().
        this.queuedNodes = new Map();

        // Table of [Number]:Element of nodes that have been submitted, and are
        // waiting for a translation.
        this.pendingTranslations = new Map();

        // Table of [Element]:Number, inverse of pendingTranslations for easy
        // cancelling of incoming responses when the node changed after
        // submission of the request.
        this.submittedNodes = new Map();

        // Queue with the translation text that they should
        // be filled with once updateTimeout is reached. Filled by
        // `enqueueTranslationResponse()` and emptied by `updateElements()`.
        this.translatedNodes = new Map();

        // Set of elements that have been translated and should not be submitted
        // again unless their contents changed.
        this.processedNodes = new WeakSet();

        // All elements we're actively trying to translate.
        this.targetNodes = new Set();
        
        // Reference for all tags:
        // https://developer.mozilla.org/en-US/docs/Web/HTML/Element

        // Tags that are treated as "meh inline tags just send them to the translator"
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

            // Not really but for testing, also bergamot-translator treats them as sentece-breaking anyway
            "th",
            "td",
            "li",
            "br",
        ]);

        // Tags that give no hint about the inline-ness of their contents
        // because of how they are used in modern web development.
        this.genericTags = new Set([
            "a",
            "span",
        ]);

        // Tags that we do not want to translate
        this.excludedTags = new Set([
            // Code-type elements generally don't translate well.
            'code',
            'kbd',
            'samp',
            'var',
            'dir', // DEPCREATED

            // Debatable
            'acronym',

            // Embedded media, lets not just yet. Maybe svg might be fun? Think
            // of inline diagrams that contain labels that we could translate.
            'svg',
            'math',
            'embed',
            'object',
            'applet', // DEPRECATED
            'iframe',
            
            // Elements that are treated as opaque by Firefox which causes their
            // innerHTML property to be just the raw text node behind it. So
            // no guarantee that the HTML is valid, which makes bergamot-
            // translator very unhappy.
            // (https://searchfox.org/mozilla-central/source/parser/html/nsHtml5Tokenizer.cpp#176)
            'noscript',
            'noembed',
            'noframes',
            
            // Title is already a special case, other than that I can't think of
            // anything in <head> that needs translating
            'head',
            
            // Don't attempt to translate any inline script or style
            'style', 
            'script',

            // Let's stay away from translating prefilled forms
            'textarea',

            // Don't enter templates. We'll translate them once they become
            // part of the page proper.
            'template',

            // handled in isExcludedNode
            // `*[lang]:not([lang|=${language}])`
            // `*[translate=no]`
        ])

        this.observer = new MutationObserver(mutationsList => {
            for (const mutation of mutationsList) {
                switch (mutation.type) {
                    case "childList":
                        mutation.addedNodes.forEach(this.restartTreeWalker.bind(this));
                        break;
                    case "characterData":
                        this.restartTreeWalker(mutation.target);
                        break;
                }
            }
        });
    }

    addElement(node) {
        if (!(node instanceof Element))
            return;

        if (this.targetNodes.has(node))
            return;

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

    /**
     * Starts (or resumes) the InPageTranslation process.
     */
    start(language) {
        console.assert(language, "language is not provided");

        if (this.started)
            return;

        /*
         * start the dom parser, the DOM mutation observer and request the
         * title to be translated
         */
        this.started = true;

        // Language we expect. If we find elements that do not match, nope out.
        this.language = language;

        // Pre-construct the excluded node selector. Doing it here since it
        // needs to know `language`. See `containsExcludedNode()`.
        this.excludedNodeSelector = `[lang]:not([lang|="${this.language}"]),[translate=no],${Array.from(this.excludedTags).join(',')}`;

        for (let node of this.targetNodes)
            this.startTreeWalker(node);

        this.startMutationObserver();
    }

    /**
     * Stops the InPageTranslation process, stopping observing and regard any
     * in-flight translation request as lost.
     */
    stop() {
        if (!this.started)
            return;

        // TODO: cancel translation requests? Not really necessary at this level
        // because stop() is called on disconnect from the background-script,
        // and that script on its own will cancel translation requests from
        // pages it is no longer connected to.

        this.stopMutationObserver();
        
        // Remove all elements for which we haven't received a translation yet
        // from the 'sent' list.
        this.submittedNodes.clear();

        this.pendingTranslations.forEach((node, id) => {
            this.processedNodes.delete(node);
            this.enqueueTranslation(node);
        })

        this.pendingTranslations.clear();

        this.started = false;
    }

    /**
     * Start walking from `root` down through the DOM tree and decide which
     * elements to enqueue for translation.
     */
    startTreeWalker(root) {
        // We're only interested in elements and maybe text. Ignore things like
        // comments and possibly weird XML instructions.
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.TEXT_NODE)
            return;
        
        // If the parent itself is rejected, we don't translate any children.
        // However, if this is a specifically targeted node, we don't do this
        // check. Mainly so we can exclude <head>, but include <title>.
        if (!this.targetNodes.has(root)) {
            for (let parent of ancestors(root)) {
                if (this.validateNode(parent) === NodeFilter.FILTER_REJECT)
                    return;
            }
        }

        // TODO: Bit of added complicated logic to include `root` in the set
        // of nodes that is being evaluated. Normally TreeWalker will only
        // look at the descendants.
        switch (this.validateNodeForQueue(root)) {
            // If even the root is already rejected, no need to look further
            case NodeFilter.FILTER_REJECT:
                return;
            
            // If the root itself is accepted, we don't need to drill down
            // either. But we do want to call dispatchTranslations().
            case NodeFilter.FILTER_ACCEPT:
                this.enqueueTranslation(root);
                break;
            
            // If we skip the root (because it's a block element and we want to
            // cut it into smaller chunks first) then start tree walking to
            // those smaller chunks.
            case NodeFilter.FILTER_SKIP: {
                const nodeIterator = document.createTreeWalker(
                    root,
                    NodeFilter.SHOW_ELEMENT,
                    this.validateNodeForQueue.bind(this)
                );

                let currentNode;
                while (currentNode = nodeIterator.nextNode()) {
                    this.enqueueTranslation(currentNode);
                }
            } break;
        }

        this.dispatchTranslations();
    }

    /**
     * Like startTreeWalker, but without the "oh ignore this element if it has
     * already been submitted" bit. Use this one for submitting changed elements.
     */
    restartTreeWalker(root) {
        // Remove node from sent map: if it was send, we don't want it to update
        // with an old translation once the translation response comes in.
        const id = this.submittedNodes.get(root);
        if (id) {
            this.submittedNodes.delete(root);
            this.pendingTranslations.delete(id);
        }

        // Remove node from processed list: we want to reprocess it.
        this.processedNodes.delete(root);

        // Start submitting it again
        this.startTreeWalker(root);
    }

    isElementInViewport(element) {
        if (element.nodeType === Node.TEXT_NODE)
            element = element.parentElement;

        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }

    /**
     * Test whether the element is visible.
     */
    isElementVisible(element) {
        if (element.nodeType === Node.TEXT_NODE)
            element = element.parentElement;

        // Based on jQuery (talk about battle-tested...)
        // https://github.com/jquery/jquery/blob/main/src/css/hiddenVisibleSelectors.js
        return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
    }

    /**
     * Test whether any of the parent nodes are already in the process of being
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

    /**
     * Test whether this node should be treated as a wrapper of text, e.g.
     * a `<p>`, or as a wrapper for block elements, e.g. `<div>`, based on
     * its contents. The first we submit for translation, the second we try to
     * split into smaller chunks of HTML for better latency.
     */
    hasInlineContent(node) {
        if (node.nodeType === Node.TEXT_NODE)
            return true;

        let inlineElements = 0;
        let blockElements = 0;

        for (let child of node.childNodes) {
            switch (child.nodeType) {
                case Node.TEXT_NODE: // TextNode
                    if (child.textContent.trim().length > 0)
                        inlineElements++;
                    break;

                case Node.ELEMENT_NODE: // Element
                    if (this.inlineTags.has(child.nodeName.toLowerCase()))
                        inlineElements++;
                    else if (this.genericTags.has(child.nodeName.toLowerCase()) && this.hasInlineContent(child))
                        inlineElements++;
                    else
                        blockElements++;
                    break;
            }
        }

        return inlineElements >= blockElements;
    }

    /**
     * Test whether any of the direct text nodes of this node are non-whitespace
     * text nodes.
     * 
     * For example:
     *   - `<p>test</p>`: yes
     *   - `<p> </p>`: no
     *   - `<p><b>test</b></p>`: no
     */
    hasTextNodes(node) {
        if (node.nodeType !== Node.ELEMENT_NODE)
            return false;

        // TODO There is probably a quicker way to do this
        for (let child of node.childNodes) {
            switch (child.nodeType) {
                case Node.TEXT_NODE: // TextNode
                    if (child.textContent.trim() !== "")
                        return true;
                    break;
            }
        }

        return false;
    }

    /**
     * Test whether this is an element we do not want to translate. These
     * are things like `<code>`, elements with a different `lang` attribute,
     * and elements that have a `translate=no` attribute.
     */
    isExcludedNode(node) {
        // Text nodes are never excluded
        if (node.nodeType === Node.TEXT_NODE)
            return false;

        // Exclude certain elements
        if (this.excludedTags.has(node.nodeName.toLowerCase()))
            return true;

        // Exclude elements that have a lang attribute that mismatches the
        // language we're currently translating.
        if (node.lang && node.lang.substr(0,2) !== this.language)
            return true;

        // Exclude elements that have an translate=no attribute
        // (See https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/translate)
        if (node.translate === false || node.getAttribute('translate') === 'no')
            return true;

        return false;
    }

    /**
     * Like `isExcludedNode` but looks at the full subtree. Used to see whether
     * we can submit a subtree, or whether we should split it into smaller
     * branches first to try to exclude more of the non-translatable content.
     */
    containsExcludedNode(node) {
        // TODO describe this in terms of the function above, but I assume
        // using querySelector is faster for now.
        return node.nodeType === Node.ELEMENT_NODE && node.querySelector(this.excludedNodeSelector);
    }

    /**
     * Used by TreeWalker to determine whether to ACCEPT, REJECT or SKIP a
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
        const mark = (value) => {
            if (node.nodeType === Node.ELEMENT_NODE)
                node.setAttribute('x-bergamot-translated', value);
        };

        // Don't resubmit subtrees that are already in progress (unless their
        // contents have been changed
        if (this.queuedNodes.has(node) || this.isParentQueued(node)) {
            // node.setAttribute('x-bergamot-translated', 'rejected is-parent-translating');
            return NodeFilter.FILTER_REJECT;
        }

        // Exclude nodes that we don't want to translate
        if (this.isExcludedNode(node)) {
            mark('rejected is-excluded-node');
            return NodeFilter.FILTER_REJECT;
        }

        // Skip over subtrees that don't have text
        if (node.textContent.trim().length === 0) {
            mark('rejected empty-text-content');
            return NodeFilter.FILTER_REJECT;
        }
            
        if (!this.hasInlineContent(node)) {
            mark('skipped does-not-have-text-of-its-own');
            return NodeFilter.FILTER_SKIP; // otherwise dig deeper
        } 

        if (this.containsExcludedNode(node) && !this.hasTextNodes(node)) {
            mark('skipped contains-excluded-node');
            return NodeFilter.FILTER_SKIP; // otherwise dig deeper  
        }
        
        return NodeFilter.FILTER_ACCEPT; // send whole node as 1 block
    }

    /**
     * Used by TreeWalker to determine whether to ACCEPT, REJECT or SKIP a
     * subtree. Checks whether element is acceptable, and hasn't been
     * translated already.
     */
    validateNodeForQueue(node) {
        // Skip nodes already seen (for the partial subtree change, or restart of the
        // whole InPageTranslation process.)
        if (this.processedNodes.has(node)) {
            return NodeFilter.FILTER_REJECT;
        }

        return this.validateNode(node);
    }

    /**
     * Enqueue a node for translation. Called during startTreeWalker. Queues
     * are emptied by dispatchTranslation().
     */
    enqueueTranslation(node) {
        this.translationsCounter += 1;

        // Debugging: mark the node so we can add CSS to see them
        if (node.nodeType === Node.ELEMENT_NODE)
            node.setAttribute('x-bergamot-translated', this.translationsCounter);

        let priority = 2;
        if (!this.isElementVisible(node))
            priority = 3;
        else if (this.isElementInViewport(node))
            priority = 1;

        this.queuedNodes.set(node, {
            id: this.translationsCounter,
            priority
        });
    }

    dispatchTranslations() {
        this.queuedNodes.forEach(this.submitTranslation.bind(this));
        this.queuedNodes.clear();
    }

    submitTranslation({priority, id}, node) {
        // Give each element an id that gets passed through the translation so
        // we can later on reunite it.
        if (node.nodeType === Node.ELEMENT_NODE) {
            node.querySelectorAll('*').forEach((el, i) => {
                el.dataset.xBergamotId = i;
            });
        }

        const text = node.nodeType === Node.ELEMENT_NODE ? node.innerHTML : node.textContent;
        if (text.trim().length === 0)
            return;

        this.mediator.translate(text, {
            priority,
            id,
            html: node.nodeType === Node.ELEMENT_NODE
        });

        // Keep reference to this node for once we receive a translation response.
        this.pendingTranslations.set(id, node);
        this.submittedNodes.set(node, id);

        // Also mark this node as not to be translated again unless the contents
        // are changed (which the observer will pick up on)
        this.processedNodes.add(node);
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

    updateElements() {
        const updateElement = ({id, translated}, node) => {
            // console.groupCollapsed(computePath(node));
            node.setAttribute('x-bergamot-translated', '');
            
            const scratch = document.createElement('template');
            scratch.innerHTML = translated;

            const originalHTML = node.innerHTML;

            // console.log(node);
            // console.log(`Translated: ${translated}`);
            // console.log(`Original:   ${originalHTML}`);

            const clonedNodes = new Set();

            // Merge the live tree (dst) with the translated tree (src) by
            // re-using elements from the live tree.
            const merge = (dst, src) => {
                // Remove all live nodes at this branch of the tree, but keep
                // an (indexed) reference to them since we will be adding them
                // back, but possibly in a different order.
                const dstNodes = Array.from(dst.childNodes)
                    .map(child => dst.removeChild(child));

                const dstTextNodes = dstNodes.filter(child => {
                    if (child.nodeType !== Node.TEXT_NODE)
                        return false;

                    // because of how bad bergamot-translator is with putting
                    // whitespace back in the right place, don't reuse these,
                    // they'll only cause mismatches between textual text nodes.
                    if (child.data.trim().length == 0)
                        return false;
                });

                const dstChildNodes = Object.fromEntries(dstNodes
                    .filter(child => child.nodeType === Node.ELEMENT_NODE)
                    .map(child => [child.dataset.xBergamotId, child]));

                // src (translated) dictates the order.
                Array.from(src.childNodes).forEach((child, index, siblings) => {
                    // Element nodes we try to use the already existing DOM nodes
                    if (child.nodeType === Node.ELEMENT_NODE) {
                        // Find an element in the live tree that matches the
                        // one in the translated tree.
                        let counterpart = dstChildNodes[child.dataset.xBergamotId];

                        if (!counterpart) {
                            console.warn(`[InPlaceTranslation] ${computePath(child, scratch)} Could not find counterpart for`, child.dataset.xBergamotId, dstChildNodes, child);
                            return;
                        }

                        // If it already has a parentNode, we already used it
                        // with appendChild. This can happen, bergamot-translator
                        // can duplicate HTML in the same branch.
                        if (counterpart.parentNode) {
                            counterpart = counterpart.cloneNode(true);
                            clonedNodes.add(counterpart.dataset.xBergamotId);
                            console.warn(`[InPlaceTranslation] ${computePath(child, scratch)} Cloning node`, counterpart, 'because it was already inserted earlier');
                        }
    
                        // Only attempt a recursive merge if there is anything
                        // to merge (I mean any translated text)
                        if (child.innerText?.trim())
                            merge(counterpart, child);
                        else if (counterpart.innerText?.trim()) {
                            // Oh this is bad. The original node had text, but
                            // the one that came out of translation doesn't?
                            console.warn(`[InPlaceTranslation] ${computePath(child, scratch)} Child ${child.outerHTML} has no text but counterpart ${counterpart.outerHTML} does`);
                            
                            // TODO: This scenario might be caused by one of two
                            // causes: 1) element was duplicated by translation
                            // but then not given text content. This happens on
                            // Wikipedia articles for example.
                            // Or 2) the translator messed up and could not
                            // translate the text. This happens on Youtube in the
                            // language selector. In that case, having the original
                            // text is much better than no text at all.
                            // To make sure it is this case, and not option 2
                            // we check whether this is the only occurrence.
                            if (siblings.some((sibling, i) => sibling.nodeType === Node.ELEMENT_NODE && index !== i && child.dataset.xBergamotId === sibling.dataset.xBergamotId))
                                removeTextNodes(counterpart);
                        }

                        // Put the live node back in the live branch. But now
                        // it has been synced with the translated text and order.
                        dst.appendChild(counterpart);
                    } else if (child.nodeType === Node.TEXT_NODE) {
                        // Reuse a text node
                        let counterpart = dstTextNodes.shift();

                        // If no more text nodes were available to reuse, just
                        // take the child node we'd have copied otherwise.
                        if (counterpart !== undefined)
                            counterpart.data = child.data;
                        else
                            counterpart = child;

                        dst.appendChild(counterpart);
                    } else {
                        // Maybe a comment or something, not particularly interesting
                        dst.appendChild(child);
                    }
                });

                if (dstTextNodes.length)
                    console.warn(`[InPageTranslation] ${computePath(src, scratch)} Not all text nodes re-used, left:`, dstTextNodes);

                const lost = Object.values(dstChildNodes)
                    .filter(child => !child.parentNode);

                if (lost.length)
                    console.warn(`[InPlaceTranslation] ${computePath(src, scratch)} Not all nodes unified`, {
                        lost,
                        cloned: Array.from(clonedNodes.values()),
                        originalHTML,
                        translated,
                        dst: dst.outerHTML,
                        src: src.outerHTML
                    });
            };

            merge(node, scratch.content);
        };

        const updateTextNode = ({id, translated}, node) => {
            if (translated.trim().length === 0)
                console.warn('[InPlaceTranslation] text node', node, 'translated to', translated);
            else
                node.data = translated;
        };

        // Pause observing mutations
        this.stopMutationObserver();

        try {
            this.translatedNodes.forEach((message, node) => {
                switch (node.nodeType) {
                    case Node.TEXT_NODE:
                        updateTextNode(message, node);
                        break;
                    case Node.ELEMENT_NODE:
                        updateElement(message, node);
                        break
                }
            });
            this.translatedNodes.clear();
            this.updateTimeout = null;
        } finally {
            // Tell the hijacked mutation observers from MutationObserver.js
            // to forget about all those DOM changes we just made.
            window.eval('window.$BergamotResetMutationObservers()');
            
            this.startMutationObserver();
        }
    }

    /**
     * Batches translation responses for a single big updateElements() call.
     */
    enqueueTranslationResponse(translated, {id}) {
        // Look up node by message id. This can fail 
        const node = this.pendingTranslations.get(id);
        if (node === undefined) {
            console.debug('[in-page-translation] Message',id,'is not found in pendingTranslations');
            return;
        }

        // Prune it.
        this.pendingTranslations.delete(id);

        // Node still exists! Remove node -> (pending) message mapping
        this.submittedNodes.delete(node);
        
        // Queue node to be populated with translation next update.
        this.translatedNodes.set(node, {id, translated});

        // we schedule the UI update
        if (!this.updateTimeout)
            this.updateTimeout = setTimeout(this.updateElements.bind(this), this.submittedNodes.size === 0 ? 0 : this.UI_UPDATE_INTERVAL);
    }
}