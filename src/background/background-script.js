import compat from '../shared/compat.js';
import { product } from '../shared/func.js';
import TLTranslationHelper from './TLTranslationHelper.js';
import WASMTranslationHelper from './WASMTranslationHelper.js';


function isSameDomain(url1, url2) {
    return url1 && url2 && new URL(url1).host === new URL(url2).host;
}

// Just a little test to run in the web inspector for debugging
async function test(provider) {
    console.log(await Promise.all([
        provider.translate({
            from: 'de',
            to: 'en',
            text: 'Hallo Welt. Wie geht es dir?'
        }),
        provider.translate({
            from: 'de',
            to: 'en',
            text: 'Mein Name ist <a href="#">Jelmer</a>.',
            html: true
        })
    ]));
}

/**
 * Temporary fix around few models, bad classified, and similar looking languages.
 * From https://github.com/bitextor/bicleaner/blob/3df2b2e5e2044a27b4f95b83710be7c751267e5c/bicleaner/bicleaner_hardrules.py#L50
 * @type {Set<String>[]}
 */
const SimilarLanguages = [
    new Set(['es', 'ca', 'gl', 'pt']),
    new Set(['no', 'nb', 'nn', 'da']) // no == nb for bicleaner
];

/**
 * @typedef {Object} TranslationModel
 * @property {String} from
 * @property {String} to
 * @property {Boolean} local
 */

/**
 * @typedef {Object} TranslationProvider
 * @property {Promise<TranslationModel[]>} registry
 */ 

/**
 * Language detection function that also provides a sorted list of
 * from->to language pairs, based on the detected language, the preferred
 * target language, and what models are available.
 * @param {{sample:String, suggested:{[lang:String]: Number}}}
 * @param {TranslationProvider} provider
 * @return {Promise<{from:String|Undefined, to:String|Undefined, models: TranslationModel[]}>}
 */
async function detectLanguage({sample, suggested}, provider) {
    if (!sample)
        throw new Error('Empty sample');

    const [detected, models] = await Promise.all([
        compat.i18n.detectLanguage(sample),
        provider.registry
    ]);

    const modelsFromEng = models.filter(({from}) => from === 'en');
    const modelsToEng = models.filter(({to}) => to === 'en');

    // List of all available from->to translation pairs including ones that we
    // achieve by pivoting through English.
    const pairs = [
        ...models.map(model => ({from: model.from, to: model.to, pivot: null, models: [model]})),
        ...Array.from(product(modelsToEng, modelsFromEng))
            .filter(([{from}, {to}]) => from !== to)
            .map(([from, to]) => ({from: from.from, to: to.to, pivot: 'en', models: [from, to]}))
    ];

    // {[lang]: 0.0 .. 1.0} map of likeliness the page is in this language
    /** @type {{[lang:String]: Number }} **/
    let confidence = Object.fromEntries(detected.languages.map(({language, percentage}) => [language, percentage / 100]));

    // Take suggestions into account
    Object.entries(suggested || {}).forEach(([lang, score]) => {
        confidence[lang] = Math.max(score, confidence[lang] || 0.0);
    });

    // Work-around for language pairs that are close together
    Object.entries(confidence).forEach(([lang, score]) => {
        SimilarLanguages.forEach(group => {
            if (group.has(lang)) {
                group.forEach(other => {
                    if (!(other in confidence))
                        confidence[other] = score / 2; // little bit lower though
                })
            }
        })
    });

    // {[lang]: 0.0 .. 1.0} map of likeliness the user wants to translate to this language.
    /** @type {{[lang:String]: Number }} */
    const preferred = (await compat.i18n.getAcceptLanguages()).reduce((preferred, language, i, languages) => {
        // Todo: right now all our models are just two-letter codes instead of BCP-47 :(
        const code = language.substr(0, 2);
        return code in preferred ? preferred : {...preferred, [code]: 1.0 - (i / languages.length)};
    }, {});
    
    // Function to score a translation model. Higher score is better
    const score = ({from, to, pivot, models}) => {
        return (confidence[from] || 0.0)                                                  // from language is good
             + (preferred[to] || 0.0)                                                     // to language is good
             + (pivot ? 0.0 : 1.0)                                                        // preferably don't pivot
             + (1.0 / models.reduce((acc, model) => acc + model.local ? 0.0 : 1.0, 1.0))  // prefer local models
    };

    // Sort our possible models, best one first
    pairs.sort((a, b) => score(b) - score(a));

    // (Using pairs instead of confidence and preferred because we prefer a pair
    // we can actually translate to above nothing every time right now.)
    return {
        from: pairs.length ? pairs[0].from : undefined,
        to: pairs.length ? pairs[0].to : undefined,
        models: pairs
    }
}

const State = {
    PAGE_LOADING: 'page-loading',
    PAGE_LOADED: 'page-loaded',
    PAGE_ERROR: 'page-error',
    TRANSLATION_NOT_AVAILABLE: 'translation-not-available',
    TRANSLATION_AVAILABLE: 'translation-available',
    DOWNLOADING_MODELS: 'downloading-models',
    TRANSLATION_IN_PROGRESS: 'translation-in-progress',
    TRANSLATION_FINISHED: 'translation-finished',
    TRANSLATION_ERROR: 'translation-error'
};

class Tab extends EventTarget {
    /**
     * @param {Number} id tab id
     */
    constructor(id) {
        super();
        this.id = id;
        this.state = {
            state: State.PAGE_LOADING,
            from: undefined,
            to: undefined,
            models: [],
            debug: false,
            error: null,
            url: null,
            pendingTranslationRequests: 0,
            totalTranslationRequests: 0,
            modelDownloadRead: undefined,
            modelDownloadSize: undefined,
            record: false,
            recordedPagesCount: undefined,
            recordedPagesURL: undefined
        };

        /** @type {Map<Number,Port>} */
        this.frames = new Map();

        /** @type {{diff:Object,callbackId:Number}|null} */
        this._scheduledUpdateEvent = null;
    }

    /**
     * Begins translation of the tab
     */
    translate() {
        this.update(state => ({
            state: State.TRANSLATION_IN_PROGRESS
        }));
    }

    /**
     * Aborts translation of the tab
     */
    abort() {
        this.update(state => ({
            state: State.TRANSLATION_AVAILABLE
        }));

        this.frames.forEach(frame => {
            frame.postMessage({
                command: 'TranslateAbort'
            });
        });
    }

    /**
     * Resets the tab state after navigating away from a page. The disconnect
     * of the tab's content scripts will already have triggered abort()
     * @param {String} url
     */
     reset(url) {
        this.update(state => {
            if (isSameDomain(url, state.url) && state.state == State.TRANSLATION_IN_PROGRESS) {
                return {
                    url,
                    pendingTranslationRequests: 0,
                    totalTranslationRequests: 0
                };
            } else {
                return {
                    url,
                    page: undefined,
                    from: null,  // Only reset from as page could be different
                                 // language. We leave to selected as is
                    pendingTranslationRequests: 0,
                    totalTranslationRequests: 0,
                    state: State.PAGE_LOADING,
                    error: null
                };
            }
        });
    }

    /**
     * @callback StateUpdatePredicate
     * @param {Object} state
     * @return {Object} state
     */

    /**
     * @param {StateUpdatePredicate} callback
     */
    update(callback) {
        const diff = callback(this.state);
        if (diff === undefined)
            throw new Error('state update callback function did not return a value');

        Object.assign(this.state, diff);

        // Delay the update notification to accumulate multiple changes in one
        // notification.
        if (!this._scheduledUpdateEvent) {
            const callbackId = setTimeout(this._dispatchUpdateEvent.bind(this));
            this._scheduledUpdateEvent = {diff, callbackId};
        } else {
            Object.assign(this._scheduledUpdateEvent.diff, diff);
        }
    }

    _dispatchUpdateEvent() {
        const {diff} = this._scheduledUpdateEvent;
        this._scheduledUpdateEvent = null;

        const updateEvent = new Event('update');
        updateEvent.data = diff;
        this.dispatchEvent(updateEvent);
    }
}

function updateActionButton(event) {
    switch (event.target.state.state) {
        case State.TRANSLATION_AVAILABLE:
        case State.TRANSLATION_IN_PROGRESS:
            compat.browserAction.enable(event.target.id);
            break;
        case State.TRANSLATION_NOT_AVAILABLE:
            compat.browserAction.disable(event.target.id);            
            break;
        case State.TRANSLATION_NOT_AVAILABLE:
        default:
            break;
    }
}

/**
 * A record can be used to record all translation messages send to the
 * translation backend. Useful for debugging & benchmarking.
 */
class Recorder {
    #pages;

    constructor() {
        this.#pages = new Map();
    }

    record({from, text, session: {url}}) {
        // Unique per page url
        if (!this.#pages.has(url))
            this.#pages.set(url, {
                url,
                from,
                texts: [],
            });

        // TODO: we assume everything is HTML or not, `html` is ignored.
        this.#pages.get(url).texts.push(text);
    }

    get size() {
        return this.#pages.size;
    }

    clear() {
        this.#pages.clear();
    }

    exportAXML() {
        const root = document.implementation.createDocument('', '', null);
        const dataset = root.createElement('dataset');

        this.#pages.forEach(page => {
            const doc = root.createElement('doc');
            doc.setAttribute('origlang', page.from);
            doc.setAttribute('href', page.url);

            const src = root.createElement('src');
            src.setAttribute('lang', page.from);

            page.texts.forEach((text, i) => {
                const p = root.createElement('p');
                
                const seg = root.createElement('seg');
                seg.setAttribute('id', i + 1);

                seg.appendChild(root.createTextNode(text));
                p.appendChild(seg);

                src.appendChild(p);
            });

            doc.appendChild(src);
            dataset.appendChild(doc);
        });

        root.appendChild(dataset);

        const serializer = new XMLSerializer();
        const xml = serializer.serializeToString(root);
        return new Blob([xml], {type: 'application/xml'});
    }
}

// Supported translation providers
const providers = {
    'translatelocally': TLTranslationHelper,
    'wasm': WASMTranslationHelper
};

// Global state (and defaults)
const state = {
    provider: 'wasm',
    options: {
        workers: 1, // be kind to the user's pc
        cacheSize: 20000, // remember website boilerplate
        useNativeIntGemm: true // faster is better (unless it is buggy: https://github.com/browsermt/marian-dev/issues/81)
    },
    developer: false // should we show the option to record page translation requests?
};

// State per tab
const tabs = new Map();

function getTab(tabId) {
    if (!tabs.has(tabId)) {
        const tab = new Tab(tabId);
        tabs.set(tabId, tab);
        tab.addEventListener('update', updateActionButton);
    }

    return tabs.get(tabId);
}

// Instantiation of a TranslationHelper. Access it through .get().
let provider = new class {
    #provider;

    get() {
        if (this.#provider)
            return this.#provider;

        if (!(state.provider in providers)) {
            console.info(`Provider ${state.provider} not in list of supported translation providers. Falling back to 'wasm'`);
            state.provider = 'wasm';
        }
        
        this.#provider = new providers[state.provider](state.options);

        this.#provider.onerror = err => {
            console.error('Translation provider error:', err);

            tabs.forEach(tab => tab.update(() => ({
                state: State.PAGE_ERROR,
                error: `Translation provider error: ${err.message}`,
            })));

            // Try falling back to WASM is the current provider doesn't work
            // out. Might lose some translations the process but
            // InPageTranslation should be able to deal with that.
            if (state.provider !== 'wasm') {
                console.info(`Provider ${state.provider} encountered irrecoverable errors. Falling back to 'wasm'`);
                state.provider = 'wasm';
                this.reset();
            }
        };

        return this.#provider;
    }

    reset() {
        tabs.forEach(tab => tab.reset(tab.state.url));

        if (this.#provider)
            this.#provider.delete();

        this.#provider = null;
    }
};

const recorder = new Recorder();

/**
 * Connects the port of a content-script or popup with the state management
 * mechanism of the tab. This allows the content-script to make UpdateRequest
 * calls to update the state, and receive state updates through Update messages.
 */
function connectTab(tab, port) {
    const updateListener = (event) => {
        port.postMessage({
            command: 'Update',
            data: event.data
        });
    };

    // Listen for state updates locally
    tab.addEventListener('update', updateListener);

    // If the port disconnect, stop listening
    port.onDisconnect.addListener(event => {
        tab.removeEventListener('update', updateListener);
    });

    // Allow the port to update the tab state with update requests
    port.onMessage.addListener(({command, data}) => {
        if (command === 'UpdateRequest') {
            tab.update(state => data);
        }
    });

    // Send an initial update to the port
    port.postMessage({
        command: 'Update',
        data: tab.state
    });
}

function connectContentScript(contentScript) {
    const tab = getTab(contentScript.sender.tab.id);

    // Register this content script with the tab
    tab.frames.set(contentScript.sender.frameId, contentScript);

    let _abortSignal = {aborted: false};
    const abort = () => {
        // Use the signal we stored for this tab to signal all pending
        // translation promises to not resolve.
        _abortSignal.aborted = true;
        
        // Also prune any pending translation requests that have this same
        // signal from the queue. No need to put any work into it.
        provider.get().remove((request) => request._abortSignal.aborted);

        // Create a new signal in case we want to start translating again.
        _abortSignal = {aborted: false};
    };

    // Make the content-script receive state updates. Also sends the initial
    // state update.
    connectTab(tab, contentScript);

    // If the content-script stops (i.e. user navigates away)
    contentScript.onDisconnect.addListener(event => {
        // Disconnect it from this tab
        tab.frames.delete(contentScript.sender.frameId);

        // Abort all in-progress translations that belonged to this page
        abort();
    });

    // Respond to certain messages from the content script. Mainly individual
    // translation requests, and detect language requests which then change the
    // state of the tab to reflect whether translations are available or not.
    contentScript.onMessage.addListener(message => {
        switch (message.command) {
            // Send by the content-scripts inside this tab
            case "DetectLanguage":
                detectLanguage(message.data, provider.get()).then(summary => {
                    // TODO: When we support multiple frames inside a tab, we
                    // should integrate the results from each frame somehow.
                    // For now we ignore it, because 90% of the time it will be
                    // an ad that's in English and mess up our estimate.
                    if (contentScript.sender.frameId !== 0)
                        return; 

                    tab.update(state => ({
                        from: state.from || summary.from,
                        to: state.to || summary.to,
                        models: summary.models,
                        state: summary.models.length > 0 // TODO this is always true
                            ? State.TRANSLATION_AVAILABLE
                            : State.TRANSLATION_NOT_AVAILABLE
                    }));
                }).catch(error => {
                    tab.update(state => ({
                        state: State.PAGE_ERROR,
                        error
                    }));
                });
                break;

            // Send by the content-scripts inside this tab
            case "TranslateRequest":
                tab.update(state => ({
                    pendingTranslationRequests: state.pendingTranslationRequests + 1,
                    totalTranslationRequests: state.totalTranslationRequests + 1
                }));

                // If we're recording requests from this tab, add the translation
                // request. Also disabled when developer setting is false since
                // then there are no controls to turn it on/off.
                if (state.developer && tab.state.record) {
                    recorder.record(message.data);
                    tab.update(state => ({
                        recordedPagesCount: recorder.size
                    }));
                }

                provider.get().translate({...message.data, _abortSignal})
                    .then(response => {
                        if (!response.request._abortSignal.aborted) {
                            contentScript.postMessage({
                                command: "TranslateResponse",
                                data: response
                            });
                        }
                    })
                    .catch(e => {
                        // Catch error messages caused by abort()
                        if (e && e.message && e.message === 'removed by filter' && e.request && e.request._abortSignal.aborted)
                            return;
                        
                        tab.update(state => ({
                            state: State.TRANSLATION_ERROR,
                            error: e.message
                        }));
                    })
                    .finally(() => {
                        tab.update(state => ({
                            pendingTranslationRequests: state.pendingTranslationRequests - 1,
                            totalTranslationRequests: state.totalTranslationRequests + 1
                        }));
                    })
                break;

            // Send by this script's Tab.abort() but handled per content-script
            // since each content-script handler (connectContentScript) has the
            // ability to abort all of the content-script's translation
            // requests. Same code is called when content-script disconnects.
            case "TranslateAbort":
                abort();
                break;
        }
    });
}

function connectPopup(popup) {
    const tabId = parseInt(popup.name.substr('popup-'.length));

    const tab = getTab(tabId);

    // Make the popup receive state updates
    connectTab(tab, popup);

    popup.onMessage.addListener(async message => {
        switch (message.command) {
            case "DownloadModels":
                // Tell the tab we're downloading models
                tab.update(state => ({
                    state: State.DOWNLOADING_MODELS
                }));

                // Start the downloads and put them in a {[download:promise]: {read:int,size:int}}
                const downloads = new Map(message.data.models.map(model => [provider.get().downloadModel(model), {read:0.0, size:0.0}]));

                // For each download promise, add a progress listener that updates the tab state
                // with how far all our downloads have progressed so far.
                downloads.forEach((_, promise) => promise.addProgressListener(({read, size}) => {
                    // Update download we got a notification about
                    downloads.set(promise, {read, size});
                    // Update tab state about all downloads combined (i.e. model, optionally pivot)
                    tab.update(state => ({
                        modelDownloadRead: Array.from(downloads.values()).reduce((sum, {read}) => sum + read, 0),
                        modelDownloadSize: Array.from(downloads.values()).reduce((sum, {size}) => sum + size, 0)
                    }));
                }));

                // Finally, when all downloads have finished, start translating the page.
                try {
                    await Promise.all(downloads.keys());

                    tab.translate();
                } catch (e) {
                    tab.update(state => ({
                        state: State.TRANSLATION_ERROR,
                        error: e.toString()
                    }));
                }
                break;
            case "TranslateStart":
                tab.translate();
                break;
            
            case 'TranslateAbort':
                tab.abort();
                break;

            case 'ExportRecordedPages':
                popup.postMessage({
                    command: 'DownloadRecordedPages',
                    data: {
                        name: 'recorded-pages.xml',
                        url: URL.createObjectURL(recorder.exportAXML())
                    }
                });
                recorder.clear();
                tab.update(state => ({recordedPagesCount: 0}));
                break;
        }
    });
}

async function main() {
    // Init global state (which currently is just the name of the backend to use)
    Object.assign(state, await compat.storage.local.get(Array.from(Object.keys(state))));

    compat.storage.local.onChanged.addListener(changes => {
        Object.entries(changes).forEach(([key, {newValue}]) => {
            state[key] = newValue;
        });

        if ('provider' in changes)
            provider.reset();
    });

    // Receive incoming connection requests from content-script and popup
    compat.runtime.onConnect.addListener((port) => {
        if (port.name == 'content-script')
            connectContentScript(port);
        else if (port.name.startsWith('popup-'))
            connectPopup(port);
    });

    // Initialize or update the state of a tab when navigating
    compat.webNavigation.onCommitted.addListener(({tabId, frameId, url}) => {
        // Right now we're only interested in top-level navigation changes
        if (frameId !== 0)
            return;

        // Todo: treat reload and link different? Reload -> disable translation?
        getTab(tabId).reset(url);
    });

    compat.tabs.onCreated.addListener(({id: tabId}) => {
        getTab(tabId).reset();
    });

    // Remove the tab state if a tab is removed
    compat.tabs.onRemoved.addListener(({tabId}) => {
        tabs.delete(tabId);
    });

    // Add "translate selection" menu item
    chrome.contextMenus.create({
        id: 'translate-selection',
        title: 'Translate Selection',
        contexts: ['selection']
    });

    chrome.contextMenus.onClicked.addListener((info, tab) => {
        switch (info.menuItemId) {
            case 'translate-selection':
                getTab(tab.id).frames.get(info.frameId).postMessage({
                    command: 'TranslateSelection'
                });
                break;
        }
    })

    Object.assign(self, {
        tabs,
        state,
        providers,
        provider,
        test
    })
}

main();
