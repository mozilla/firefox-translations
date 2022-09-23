import compat from '../shared/compat.js';
import LanguageDetection from './LanguageDetection.js';
import InPageTranslation from './InPageTranslation.js';
import SelectionTranslation from './SelectionTranslation.js';
import OutboundTranslation from './OutboundTranslation.js';
import { LatencyOptimisedTranslator } from '@browsermt/bergamot-translator';

let backgroundScript;

const listeners = new Map();

const state = {
    state: 'page-loaded'
};

// Loading indicator for html element translation
compat.storage.local.get({progressIndicator:''}).then(state => {
    document.body.setAttribute('x-bergamot-indicator', state.progressIndicator);
});

compat.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== 'local')
        return;

    if ('progressIndicator' in changes)
        document.body.setAttribute('x-bergamot-indicator', changes.progressIndicator.newValue);
});

function on(command, callback) {
    if (!listeners.has(command))
        listeners.set(command, []);

    listeners.get(command).push(callback);
}

on('Update', diff => {
    Object.assign(state, diff);
    document.body.dataset.xBergamotState = JSON.stringify(state);
});

on('Update', diff => {
    if ('state' in diff) {
        switch (diff.state) {
            // Not sure why we have the page-loading event here, like, as soon
            // as frame 0 connects we know we're in page-loaded territory.
            case 'page-loading':
                backgroundScript.postMessage({
                    command: 'UpdateRequest',
                    data: {state: 'page-loaded'}
                });
                break;
            
            case 'translation-in-progress':
                inPageTranslation.addElement(document.querySelector("head > title"));
                inPageTranslation.addElement(document.body);
                inPageTranslation.start(state.from);
                break;
            
            default:
                inPageTranslation.restore();
                break;
        }
    }
});

on('Update', async diff => {
    if ('state' in diff && diff.state === 'page-loaded') {
        // request the language detection class to extract a page's snippet
        const languageDetection = new LanguageDetection();
        const sample = await languageDetection.extractPageContent();
        const suggested = languageDetection.extractSuggestedLanguages();

        // Once we have the snippet, send it to background script for analysis
        // and possibly further action (like showing the popup)
        backgroundScript.postMessage({
            command: "DetectLanguage",
            data: {
                url: document.location.href,
                sample,
                suggested
            }
        });
    }
});

on('Update', diff => {
    if ('debug' in diff) {
        if (diff.debug)
            document.querySelector('html').setAttribute('x-bergamot-debug', JSON.stringify(state));
        else
            document.querySelector('html').removeAttribute('x-bergamot-debug');
    }
});

const sessionID = new Date().getTime();

// Used to track the last text selection translation request, so we don't show
// the response to an old request by accident.
let selectionTranslationId = null;

function translate(text, user) {
    console.assert(state.from !== undefined && state.to !== undefined, "state.from or state.to is not set");
    backgroundScript.postMessage({
        command: "TranslateRequest",
        data: {
            // translation request
            from: state.from,
            to: state.to,
            html: user.html,
            text,

            // data useful for the response
            user,
            
            // data useful for the scheduling
            priority: user.priority || 0,

            // data useful for recording
            session: {
                id: sessionID,
                url: document.location.href
            }
        }
    });
}

const inPageTranslation = new InPageTranslation({
    translate(text, user) {
        translate(text, {
            ...user,
            source: 'InPageTranslation'
        });
    }
});

const selectionTranslation = new SelectionTranslation({
    translate(text, user) {
        translate(text, {
            ...user,
            source: 'SelectionTranslation',
            priority: 3
        });
    }
});

/**
 * Matches the interface of Proxy<TranslationWorker> but wraps the actual
 * translator running in the background script that we communicate with through
 * message passing. With this we can use that instance & models with the
 * LatencyOptimisedTranslator class thinking it is a Worker running the WASM
 * code.
 */
class BackgroundScriptWorkerProxy {
    /**
     * Serial that provides a unique number for each translation request.
     * @type {Number}
     */
    #serial = 0;

    /**
     * Map of submitted requests and their promises waiting to be resolved.
     * @type {Map<Number,{
     *   accept: (translations:Object[]) => Null,
     *   reject: (error:Error) => null,
     *   request: Object
     * }>}
     */
    #pending = new Map();
    
    async hasTranslationModel({from, to}) {
        return true;
    }

    /**
     * Because `hasTranslationModel()` always returns true this function should
     * never get called.
     */
    async getTranslationModel({from, to}, options) {
        throw new Error('getTranslationModel is not expected to be called');
    }

    /**
     * @param {{
     *   models: {from:String, to:String}[],
     *   texts: {
     *     text: String,
     *     html: Boolean,
     *   }[]
     * }}
     * @returns {Promise<{request:TranslationRequest, target: {text: String}}>[]}
     */
    translate({models, texts}) {
        if (texts.length !== 1)
            throw new TypeError('Only batches of 1 are expected');

        return new Promise((accept, reject) => {
            const request = {
                // translation request
                from: models[0].from,
                to: models[0].to,
                html: texts[0].html,
                text: texts[0].text,

                // data useful for the response
                user: {
                    id: ++this.#serial,
                    source: 'OutboundTranslation'
                },
                
                // data useful for the scheduling
                priority: 3,

                // data useful for recording
                session: {
                    id: sessionID,
                    url: document.location.href
                }
            };

            this.#pending.set(request.user.id, {request, accept, reject});
            backgroundScript.postMessage({
                command: "TranslateRequest",
                data: request
            });
        })
    }

    enqueueTranslationResponse(text, user) {
        const {request, accept, reject} = this.#pending.get(user.id);
        this.#pending.delete(user.id);
        accept([{request, target: {text}}]);
    }
}

const outboundTranslationWorker = new BackgroundScriptWorkerProxy();

const outboundTranslation = new OutboundTranslation(new class {
    constructor() {
        this.translator = new LatencyOptimisedTranslator({}, {
            async loadWorker() {
                return {
                    exports: outboundTranslationWorker,
                    worker: {
                        terminate() { return; }
                    }
                };
            },
            async getModels({from, to}) {
                return [{from,to}]
            }
        });
    }

    async translate(text) {
        const response = await this.translator.translate({
            from: state.to,
            to: state.from,
            text,
            html: false
        });

        return response.target.text;
    }

    async backtranslate(text) {
        const response = await this.translator.translate({
            from: state.from,
            to: state.to,
            text,
            html: false
        });

        return response.target.text;
    }
}());

on('Update', diff => {
    if ('from' in diff)
        outboundTranslation.from = diff.from;

    if ('to' in diff)
        outboundTranslation.to = diff.to;
});

on('TranslateResponse', data => {
    switch (data.request.user?.source) {
        case 'InPageTranslation':
            inPageTranslation.enqueueTranslationResponse(data.target.text, data.request.user);
            break;
        case 'SelectionTranslation':
            selectionTranslation.enqueueTranslationResponse(data.target.text, data.request.user);
            break;
        case 'OutboundTranslation':
            outboundTranslationWorker.enqueueTranslationResponse(data.target.text, data.request.user);
            break;
    }
});

// Timeout of retrying connectToBackgroundScript()
let retryTimeout = 100;

function connectToBackgroundScript() {
    // If we're already connected (e.g. when this function was called directly
    // but then also through 'pageshow' event caused by 'onload') ignore it.
    if (backgroundScript)
        return;

    // Connect to our background script, telling it we're the content-script.
    backgroundScript = compat.runtime.connect({name: 'content-script'});

    // Connect all message listeners (the "on()" calls above)
    backgroundScript.onMessage.addListener(({command, data}) => {
        if (listeners.has(command))
            listeners.get(command).forEach(callback => callback(data));

        // (We're connected, reset the timeout)
        retryTimeout = 100;
    });

    // When the background script disconnects, also pause in-page translation
    backgroundScript.onDisconnect.addListener(() => {
        inPageTranslation.stop();

        // If we cannot connect because the backgroundScript is not (yet?) 
        // available, try again in a bit.
        if (backgroundScript.error && backgroundScript.error.toString().includes('Receiving end does not exist')) {
            // Exponential back-off sounds like a safe thing, right?
            retryTimeout *= 2;

            // Fallback fallback: if we keep retrying, stop. We're just wasting CPU at this point.
            if (retryTimeout < 5000)
                setTimeout(connectToBackgroundScript, retryTimeout);
        }

        // Mark as disconnected
        backgroundScript = null;
    });
}

connectToBackgroundScript();

// When this page shows up (either through onload or through history navigation)
window.addEventListener('pageshow', connectToBackgroundScript);

// When this page disappears (either onunload, or through history navigation)
window.addEventListener('pagehide', e => {
    if (backgroundScript) {
        backgroundScript.disconnect();
        backgroundScript = null;
    }
});

let lastClickedElement = null;

window.addEventListener('contextmenu', e => {
    lastClickedElement = e.target;
}, {capture: true});

on('TranslateSelection', () => {
    const selection = document.getSelection();
    selectionTranslation.start(selection);
});

on('ShowOutboundTranslation', () => {
    if (lastClickedElement.closest('[contenteditable]'))
        throw new Error('Outbound translation not implemented for contenteditable');
    
    outboundTranslation.target = lastClickedElement;
});
