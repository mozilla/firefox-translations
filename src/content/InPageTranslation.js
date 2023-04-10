import "./InPageTranslation.css";
import { isElementVisible, isElementInViewport } from '../shared/common.js'; 

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

/**
 * Similar to createTreeWalker's functionality, but the filter function gets
 * context when descending down a branch. This is used to dig down excluded
 * branches of the DOM when looking for included branches inside those.
 * 
 * arguments:
 *   node:    Element that is first considered.
 *   filter:  Filter function that's called with (node, context) and should 
 *            return {action:, context:} object. `action` is NodeFilter enum
 *            value and context is the new context when FILTER_SKIP is issued.
 *   context: Initial context value.
 */
function *walkTree(node, filter, context) {
    let stack = [];
    const next = node.nextElementSibling;

    while (node ? node !== next : stack.length > 0) {
        // !node -> no next sibling, move to next sibling of parent
        if (!node) {
            let prev = stack.pop();
            node = prev.node.nextElementSibling
            context = prev.context;
            continue
        }

        let response = filter(node, context);

        // "Skip" means look at children
        switch (response.action) {
            case NodeFilter.FILTER_SKIP:
                stack.push({node, context});
                context = response.context;
                node = node.firstElementChild;
                break;
            case NodeFilter.FILTER_ACCEPT:
                yield node;
                // Intentional fall-through
            case NodeFilter.FILTER_REJECT:
                node = node.nextElementSibling;
                break;
            default:
                throw Error('Filter returned invalid action')
        }
    }
}

// eslint-disable-next-line no-unused-vars
export default class InPageTranslation {

    constructor(mediator) {
        this.translationsCounter = 0;
        this.mediator = mediator;
        this.started = false;
        this.language = null;
        
        // Timeout between First Translation Received -> Update DOM With Translations.
        this.updateTimeout = null;
        this.UI_UPDATE_INTERVAL = 500;

        // Timeout between first DOM mutation and us re-evaluating these nodes.
        this.restartTimeout = null;
        this.RESTART_INTERVAL = 20;

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

        // Per Element we store a list of the original children, or per TextNode
        // we store the original text.
        this.originalContent = new WeakMap();

        // Elements that have changed since we've started translating, and are
        // waiting for updateTimeout to call restartTreeWalker again.
        this.mutatedNodes = new Set();
        
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
                        // If we're tracking the original content of this node
                        // then keep our records updated with the mutations that
                        // the page (not we!) made.
                        if (this.originalContent.has(mutation.target)) {
                            const children = this.originalContent.get(mutation.target);

                            // console.log({mutation, children: Array.from(children)});

                            mutation.removedNodes.forEach(child => {
                                // Remove child from our copy of the original
                                // parent.
                                let index = children.indexOf(child);
                                if (index === -1) return; // probably a text node or quality estimation <font/> element added by us
                                children.splice(index, 1);

                                // Restore the original content of the child, which will remove any
                                // original content we're tracking in this subtree from our maps.
                                this.restoreElement(child);
                            });

                            if (mutation.addedNodes) {
                                if (mutation.previousSibling) {
                                    let index = children.indexOf(mutation.previousSibling)
                                    console.assert(index !== -1, 'index of previous sibling', mutation.previousSibling, 'not found in', Array.from(children));
                                    children.splice(index + 1, 0, ...mutation.addedNodes);
                                }
                                else if (mutation.nextSibling) {
                                    let index = children.indexOf(mutation.nextSibling);
                                    console.assert(index !== -1, 'index of next sibling', mutation.nextSibling, 'not found in', Array.from(children));
                                    children.splice(index, 0, ...mutation.addedNodes);
                                }
                                else {
                                    console.assert(children.length === 0, 'no next/prev sibling but the original node had children', Array.from(children))
                                    children.splice(0, 0, ...mutation.addedNodes);
                                }
                            }
                        }

                        // Start translating the new nodes
                        mutation.addedNodes.forEach(this.enqueueMutatedNode.bind(this));
                        break;
                    case "characterData":
                        // If we're tracking the text content of this node,
                        // update our records.
                        if (this.originalContent.has(mutation.target))
                            this.originalContent.set(mutation.target, mutation.target.data);
                        
                        // Translate the text node.
                        this.enqueueMutatedNode(mutation.target);
                        break;
                }
            }
        });

        this.isParentQueuedCache = new Map();
    }

    /**
     * Add element to translate and keep translated when changed by the page.
     */
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
     * Mark a node for retranslation because it changed according to the
     * MutationObserver. This will cancel any pending translations for this
     * node, put it on the list to be re-evaluated, and schedule a call of
     * restartTreeWalker().
     */
    enqueueMutatedNode(node) {
        // Optimisation: don't bother with translating whitespace. React sites
        // seem trigger this a lot?
        if (node.nodeType === Node.TEXT_NODE && node.data.trim() === '')
            return;
        
        // Remove node from sent map: if it was send, we don't want it to update
        // with an old translation once the translation response comes in.
        const id = this.submittedNodes.get(node);
        if (id) {
            this.submittedNodes.delete(node);
            this.pendingTranslations.delete(id);
        }

        // Remove node from processed list: we want to reprocess it.
        this.processedNodes.delete(node);

        // Queue for next call to restartTreeWalker
        for (let parent of ancestors(node))
            if (this.mutatedNodes.has(parent))
                return;
        
        this.mutatedNodes.add(node);

        if (!this.restartTimeout)
            this.restartTimeout = setTimeout(this.restartTreeWalker.bind(this), this.RESTART_INTERVAL);
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
        // Note: [lang]:not([lang...]) is too strict as it also matches slightly
        // different language code. In that case the tree walker will drill down
        // and still accept the element in isExcludedNode. Just not as part of
        // a block.
        this.excludedNodeSelector = `[lang]:not([lang|="${this.language}"]),[translate=no],.notranslate,[contenteditable],${Array.from(this.excludedTags).join(',')}`;

        for (let node of this.targetNodes)
            this.startTreeWalker(node);

        this.startMutationObserver();
    }

    /**
     * Stops the InPageTranslation process, stopping observing and regard any
     * in-flight translation request as lost. All queued requests are still
     * in the queue though, so you can resume.
     */
    stop() {
        if (!this.started)
            return;

        this.started = false;

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

        // Remove any pending node updates for which we just received a
        // translation but haven't update the node yet.
        this.translatedNodes.clear();

        // Also make sure we don't attempt to update pending nodes anymore.
        if (this.updateTimeout) {
            clearTimeout(this.updateTimeout)
            this.updateTimeout = null;
        }

        this.mutatedNodes.clear();

        if (this.restartTimeout) {
            clearTimeout(this.restartTimeout);
            this.restartTimeout = null;
        }
    }

    restoreElement(node) {
        const original = this.originalContent.get(node);

        // We start tracking a node in enqueueTranslation. If it isn't tracked
        // the node never made it that far, and we can skip the rest of the steps.
        if (original === undefined) {
            // Look deeper, there might be children we translated
            if (node.nodeType === Node.ELEMENT_NODE) {
                Array.from(node.childNodes).forEach(child => this.restoreElement(child));
            }

            return;
        }

        // Now that it will be restored, stop tracking the node.
        this.originalContent.delete(node);

        // And from the list of nodes we want to translate
        this.queuedNodes.delete(node);

        // And from the list of nodes that we have requested a translation for
        const id = this.submittedNodes.get(node);
        if (id !== undefined) {
            this.submittedNodes.delete(node);
            this.pendingTranslations.delete(id);
        }

        // And from the list of nodes waiting for their content to be updated
        // with the received translation
        this.translatedNodes.delete(node);
    
        // And remove it from not-to-be-processed-again nodes
        this.processedNodes.delete(node);

        // Restore the original contents of the node
        switch (node.nodeType) {
            case Node.ELEMENT_NODE:
                // Remove all current children
                Array.from(node.childNodes).forEach(child => node.removeChild(child));

                // Re-insert the original children which might well be the ones
                // we just removed, but they could be in a different order or
                // contain extra text nodes added for the translation to fit.
                original.forEach(child => {
                    this.restoreElement(child);
                    node.appendChild(child)
                });

                break;

            case Node.TEXT_NODE:
                    node.data = original;
                    break;

                default:
                    // Do nothing? Just leave comments and processing instructions as is.
                    break;
        }
    }

    /**
     * Stop the process and restore the page back to its original content.
     */
    restore() {
        // Can't restore without stopping.
        this.stop();

        // Start restoring at each of the target nodes
        this.targetNodes.forEach(node => this.restoreElement(node));

        // Clear the original content map
        this.originalContent = new WeakMap();

        // All nodes are now unprocessed again
        this.processedNodes = new WeakSet(); // `new` because WeakSet has no `clear()`
        
        // Similarly, nothing is queued anymore since we need to start over
        // from the beginning.
        this.queuedNodes.clear();
    }

    /**
     * Start walking from `root` down through the DOM tree and decide which
     * elements to enqueue for translation.
     */
    startTreeWalker(root) {
        // Don't bother translating elements that are not any part of the page.
        if (!root.isConnected)
            return;

        // We're only interested in elements and maybe text. Ignore things like
        // comments and possibly weird XML instructions.
        if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.TEXT_NODE)
            return;

        // Check our context for the node. Are we inside a [translate=no] branch
        // of the tree? If so, that changes which children and grandchildren we
        // consider for translation.
        let isExcludedTree = false;

        // If the parent itself is rejected, we don't translate any children.
        // However, if this is a specifically targeted node, we don't do this
        // check. Mainly so we can exclude <head>, but include <title>.
        if (!this.targetNodes.has(root)) {
            // If this node is inside an excluded node, like <pre>, nope.
            for (let parent of ancestors(root)) {
                if (this.isExcludedNode(parent))
                    return; // Don't translate
            }

            // Check whether we're in an explicitly included or excluded
            // branch. Since we're looking from the node towards the root, our
            // first explicit *translate=yes* or *translate=no* is sufficient.
            for (let parent of ancestors(root)) {
                if (this.isIncludedTree(parent)) {
                    isExcludedTree = false;
                    break;
                } else if (this.isExcludedTree(parent)) {
                    isExcludedTree = true;
                    break;
                }
            }
        }

        if (root.nodeType === Node.TEXT_NODE) {
            this.enqueueTranslation(root);
        } else {
            const nodeIterator = walkTree(
                root,
                this.validateNodeForQueue.bind(this),
                {isExcludedTree});

            for (let currentNode of nodeIterator)
                this.enqueueTranslation(currentNode);
        }

        this.dispatchTranslations();
    }

    /**
     * Runs startTreeWalker on this.mutatedNodes and clears it.
     */
    restartTreeWalker() {
        this.restartTimeout = null;

        this.mutatedNodes.forEach(this.startTreeWalker.bind(this));

        this.mutatedNodes.clear();
    }

    /**
     * Test whether any of the parent nodes are already in the process of being
     * translated. If the parent of the node is already translating we should 
     * reject it since we already sent it to translation.
     */
    isParentQueued(node){
        // let's iterate until we find either the body or if the parent was sent
        let parent = node.parentNode;
        let retval = false;
        while (parent) {
            if (parent === document.body)
                break;

            // See if we've checked before
            if (this.isParentQueuedCache.has(parent)) {
                retval = this.isParentQueuedCache.get(parent);
                break;
            }

            // See if it is queued (the sole purpose of this function really)
            if (this.queuedNodes.has(parent)) {
                retval = true;
                break;
            }

            // Move one node up the tree
            parent = parent.parentNode;
        }

        // Mark the whole path from child to ancestor with whether they're
        // already queued or not.
        for (let n = node.parentNode; n && n !== parent; n = n.parentNode)
            this.isParentQueuedCache.set(n, retval);

        return retval;
    }

    hasContent(node) {
        // Method a (seems to be faster in general?)
        return node.textContent.trim().length !== 0;

        // Alternative method
        // return document.createTreeWalker(node, NodeFilter.SHOW_TEXT, (node) => node.data.trim() !== '').nextNode() !== null;
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

        // Number of elements of one class to have a majority
        const threshold = node.childNodes.length / 2;

        for (let child of node.childNodes) {
            switch (child.nodeType) {
                case Node.TEXT_NODE: // TextNode
                    if (child.data.trim().length > 0)
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

            if (inlineElements > threshold || blockElements > threshold)
                break;
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

        // Exclude editable elements for the same reason we don't translate the
        // contents of form input fields.
        if (node.isContentEditable)
            return true;

        return false;
    }

    /**
     * Is node a subtree that we exclude, but might contain elements that we
     * should include?
     */
    isExcludedTree(node) {
        // Exclude elements that have a lang attribute that mismatches the
        // language we're currently translating. Run it through
        // getCanonicalLocales() because pages get creative.
        try {
            if (node.lang && !Intl.getCanonicalLocales(node.lang).some(lang => this.isSameLanguage(lang, this.language)))
                return true;
        } catch (err) {
            // RangeError is expected if node.lang is not a known language
            if (err.name !== "RangeError")
                throw err;
        }

        // Exclude elements that have an translate=no attribute
        // (See https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/translate)
        if (node.translate === false || node.getAttribute('translate') === 'no')
            return true;

        // Exclude elements with the notranslate class which is also honoured
        // by Google Translate
        if (node.classList.contains('notranslate'))
            return true;

        return false;
    }

    /**
     * Is node a subtree that we should include, even though we're currently
     * in a branch that we don't want to translate?
     */
    isIncludedTree(node) {
        try {
            if (node.lang && Intl.getCanonicalLocales(node.lang).some(lang => this.isSameLanguage(lang, this.language)))
                return true;
        } catch (err) {
            // RangeError is expected if node.lang is not a known language
            if (err.name !== "RangeError")
                throw err;
        }

        // Exclude elements that have an translate=no attribute
        // (See https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/translate)
        if (node.translate === true || node.getAttribute('translate') === 'yes')
            return true;

        // Exclude elements with the notranslate class which is also honoured
        // by Google Translate
        if (node.classList.contains('translate'))
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
    validateNode(node, context) {
        const mark = (value) => {
            if (node.nodeType === Node.ELEMENT_NODE)
                node.setAttribute('x-bergamot-translated', value);
        };

        // Don't resubmit subtrees that are already in progress (unless their
        // contents have been changed
        if (this.queuedNodes.has(node) || this.isParentQueued(node)) {
            // node.setAttribute('x-bergamot-translated', 'rejected is-parent-translating');
            return {action: NodeFilter.FILTER_REJECT};
        }

        // Exclude nodes that we don't want to translate
        if (this.isExcludedNode(node)) {
            mark('rejected is-excluded-node');
            return {action: NodeFilter.FILTER_REJECT};
        }

        // If this subtree is mark as dont-translate, skip it (but keep digging)
        if (!context.isExcludedTree && this.isExcludedTree(node)) {
            mark('skipped is-excluded-tree');
            return {action: NodeFilter.FILTER_SKIP, context: {...context, isExcludedTree: true}};
        }

        // If we are inside a branch that's excluded by default, look for marks
        // that say this subtree should be included again.
        if (context.isExcludedTree) {
            // If not found, just skip
            if (!this.isIncludedTree(node)) {
                mark('skipped ~is-included-tree');
                return {action: NodeFilter.FILTER_SKIP, context};
            } else {
                // otherwise update context and continue as if we're in an
                // include-by-default subtree.
                 context = {...context, isExcludedTree: false};
            }
        }

        // Skip over subtrees that don't have text
        if (!this.hasContent(node)) {
            mark('rejected empty-text-content');
            return {action: NodeFilter.FILTER_REJECT};
        }
            
        if (!this.hasInlineContent(node)) {
            mark('skipped does-not-have-text-of-its-own');
            return {action: NodeFilter.FILTER_SKIP, context}; // otherwise dig deeper
        } 

        // Dig down deeper if we would otherwise also submit an excluded node
        // to the translator. Unless we would lose a text node that is a direct
        // child of `node` if we did that.
        if (this.containsExcludedNode(node) && !this.hasTextNodes(node)) {
            mark('skipped contains-excluded-node');
            return {action: NodeFilter.FILTER_SKIP, context}; // otherwise dig deeper  
        }
        
        // If we're in an exclude-by-default branch of the tree, SKIP.
        if (context.isExcludedTree)
            return {action: NodeFilter.FILTER_SKIP, context}

        return {action: NodeFilter.FILTER_ACCEPT}; // send whole node as a single block
    }

    /**
     * Used by TreeWalker to determine whether to ACCEPT, REJECT or SKIP a
     * subtree. Checks whether element is acceptable, and hasn't been
     * translated already.
     */
    validateNodeForQueue(node, context) {
        // Skip nodes already seen (for the partial subtree change, or restart of the
        // whole InPageTranslation process.)
        if (this.processedNodes.has(node)) {
            return {action: NodeFilter.FILTER_REJECT};
        }

        return this.validateNode(node, context);
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
        if (!isElementVisible(node))
            priority = 3;
        else if (isElementInViewport(node))
            priority = 1;

        // Record it?
        this.recordElement(node);

        // Remove all children from the isParentQueued call cache
        const nodeIterator = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
        for (let currentNode = nodeIterator.nextNode(); currentNode; currentNode = nodeIterator.nextNode())
            this.isParentQueuedCache.delete(currentNode); // TODO: or set()?

        this.queuedNodes.set(node, {
            id: this.translationsCounter,
            priority
        });
    }

    dispatchTranslations() {
        this.queuedNodes.forEach(this.submitTranslation.bind(this));
        this.queuedNodes.clear();
        this.isParentQueuedCache.clear();
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
        const parser = new DOMParser();

        const updateElement = ({id, translated}, node) => {
            // console.groupCollapsed(computePath(node));
            node.setAttribute('x-bergamot-translated', '');
            
            // Parse HTML string into dummy HTMLDocument we will then compare
            // against the current real document. HTML from `translated` will
            // never be added as-is to the live document. The translator cannot
            // "dream up" new elements. It can at most duplicate existing ones.
            const scratch = parser.parseFromString(translated, 'text/html');

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

                    return true;
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

            merge(node, scratch.body);
        };

        const updateTextNode = ({id, translated}, node) => {
            if (translated.trim().length === 0)
                console.warn('[InPlaceTranslation] text node', node, 'translated to', translated);
            else
                node.data = translated;
        };

        console.assert(this.started, 'Called updateElements while InPageTranslation.started is false');

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
            this.startMutationObserver();
        }
    }

    recordElement(node) {
        switch (node.nodeType) {
            case Node.ELEMENT_NODE:
                const children = Array.from(node.childNodes);
                children.forEach(this.recordElement.bind(this))
                this.originalContent.set(node, children);
                break;
            case Node.TEXT_NODE:
                this.originalContent.set(node, node.data);
                break;
        }
    }

    /**
     * Batches translation responses for a single big updateElements() call.
     */
    enqueueTranslationResponse({request: {user: {id}}, target, error}) {
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

        if (error) {
            console.debug('[in-page-translation] got error response to translation request', error);
            return;
        }
        
        // Queue node to be populated with translation next update.
        this.translatedNodes.set(node, {id, translated: target.text});

        // we schedule the UI update
        if (!this.updateTimeout)
            this.updateTimeout = setTimeout(this.updateElements.bind(this), this.submittedNodes.size === 0 ? 0 : this.UI_UPDATE_INTERVAL);
    }

    isSameLanguage(lang, other) {
        // Case: en === en, en-US === en-US
        if (lang === other)
            return true;

        // Case: en-US === en
        if (lang.includes("-") && !other.includes("-") && lang.split("-")[0] === other)
            return true;

        // Intentionally not testing for en === en-US to make sure very
        // specific models are not used for translating broad language codes.
        return false;
    }
}