import compat from '../shared/compat.js';
import { product } from '../shared/func.js';
import Recorder from './Recorder.js';
import preferences from '../shared/preferences.js';


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
 * @property {(request:Object) => Promise<Object>} translate
 */ 

/**
 * Language detection function that also provides a sorted list of
 * from->to language pairs, based on the detected language, the preferred
 * target language, and what models are available.
 * @param {{sample:String, suggested:{[lang:String]: Number}}}
 * @param {TranslationProvider} provider
 * @return {Promise<{from:String|Undefined, to:String|Undefined, models: TranslationModel[]}>}
 */
async function detectLanguage({sample, suggested}, provider, options) {
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
        lang = lang.substr(0, 2); // TODO: not strip everything down to two letters
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

    // Fetch the languages that the browser says the user accepts (i.e Accept header)
    /** @type {String[]} **/
    let accepted = await compat.i18n.getAcceptLanguages();

    // TODO: right now all our models are just two-letter codes instead of BCP-47 :(
    accepted = accepted.map(language => language.substr(0, 2))

    // If the user has a preference, put that up front
    if (options?.preferred)
        accepted.unshift(options.preferred);

    // Remove duplicates
    accepted = accepted.filter((val, index, values) => values.indexOf(val, index + 1) === -1)

    // {[lang]: 0.0 .. 1.0} map of likeliness the user wants to translate to this language.
    /** @type {{[lang:String]: Number }} */
    const preferred = accepted.reduce((preferred, language, i, languages) => {
        return language in preferred
            ? preferred
            : {...preferred, [language]: 1.0 - (i / languages.length)};
    }, {});

    // Function to score a translation model. Higher score is better
    const score = ({from, to, pivot, models}) => {
        return 1.0 * (confidence[from] || 0.0)                                                  // from language is good
             + 0.5 * (preferred[to] || 0.0)                                                     // to language is good
             + 0.2 * (pivot ? 0.0 : 1.0)                                                        // preferably don't pivot
             + 0.1 * (1.0 / models.reduce((acc, model) => acc + model.local ? 0.0 : 1.0, 1.0))  // prefer local models
    };

    // Sort our possible models, best one first
    pairs.sort((a, b) => score(b) - score(a));
    
    // console.log({
    //     accepted,
    //     preferred,
    //     confidence,
    //     pairs: pairs.map(pair => ({...pair, score: score(pair)}))
    // });

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
    TRANSLATION_ABORTED: 'translation-aborted',
    TRANSLATION_ERROR: 'translation-error'
};

// States in which the user has the translation enabled. Used to keep
// translating pages in the same domain.
const activeTranslationStates = [
    State.DOWNLOADING_MODELS, 
    State.TRANSLATION_IN_PROGRESS,
    State.TRANSLATION_FINISHED,
    State.TRANSLATION_ABORTED,
];

class Tab extends EventTarget {
    /**
     * @param {Number} id tab id
     */
    constructor(id) {
        super();
        this.id = id;
        this.state = {
            state: State.PAGE_LOADING,
            active: false,
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
            state: State.TRANSLATION_ABORTED
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
            if (isSameDomain(url, state.url) && activeTranslationStates.includes(state.state)) {
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
        case State.TRANSLATION_ABORTED:
            compat.action.enable(event.target.id);
            break;
        case State.TRANSLATION_NOT_AVAILABLE:
            compat.action.disable(event.target.id);         
            break;
        default:
            break;
    }
}

function updateMenuItems({data, target: {state}}) {
    // Only let the active tab make decisions about the current menu items
    if (!state.active)
        return;

    // Only if one of the relevant properties changed update menu items
    const keys = ['state', 'models', 'from', 'to', 'active'];
    if (!keys.some(key => key in data))
        return;

    // Enable translate if the page has translation models available
    compat.contextMenus.update('translate-selection', {
        visible: state.models?.length > 0
    });

    // Enable the outbound translation option only if translation and
    // backtranslation models are available.
    compat.contextMenus.update('show-outbound-translation', {
        visible: state.models?.some(({from, to}) => from === state.from && to === state.to)
              && state.models?.some(({from, to}) => from === state.to && to === state.from)
    });
}

// Supported translation providers
/**
 * @type{[name:String]:Promise<Type<TranslationHelper>>}
 */
const providers = {};

// WASM (shipped) wither in this thread or in an offscreen page
if (globalThis?.Worker) {
    providers['wasm'] = async () => (await import('./WASMTranslationHelper.js')).default;
} else if (chrome?.offscreen) {
    providers['wasm'] = async () => (await import('./WASMOffscreenTranslationHelper.js')).default;
}

// Locally installed
if (compat.runtime.connectNative) {
    providers['translatelocally'] = async () => (await import('./TLTranslationHelper.js')).default;
}

// State per tab
const tabs = new Map();

function getTab(tabId) {
    if (!tabs.has(tabId)) {
        const tab = new Tab(tabId);
        tabs.set(tabId, tab);
        
        // Update action button 
        tab.addEventListener('update', updateActionButton);
        
        // Update context menu items for this tab
        tab.addEventListener('update', updateMenuItems)
    }

    return tabs.get(tabId);
}

// Instantiation of a TranslationHelper. Access it through .get().
let provider = new class {
    /**
     * @type {Promise<TranslationHelper>}
     */
    #provider;

    constructor() {
        // Reset provider instance if the selected provider is changed by the user.
        preferences.listen('provider', this.reset.bind(this));
    }

    /**
     * Get (and if necessary instantiates) a translation helper.
     * @returns {Promise<TranslationHelper>}
     */
    get() {
        if (this.#provider)
            return this.#provider;

        return this.#provider = new Promise(async (accept) => {
            let preferred = await preferences.get('provider', 'wasm')

            if (!(preferred in providers)) {
                console.info(`Provider ${preferred} not in list of supported translation providers. Falling back to 'wasm'`);
                preferred = 'wasm';
                preferences.set('provider', preferred, {silent: true});
            }
            
            let options = await preferences.get('options', {
                workers: 1, // be kind to the user's pc
                cacheSize: 20000, // remember website boilerplate
                useNativeIntGemm: true // faster is better (unless it is buggy: https://github.com/browsermt/marian-dev/issues/81)
            });

            const implementation = await providers[preferred]();

            const provider = new implementation(options);

            provider.onerror = err => {
                console.error('Translation provider error:', err);

                tabs.forEach(tab => tab.update(() => ({
                    state: State.PAGE_ERROR,
                    error: `Translation provider error: ${err.message}`,
                })));

                // Try falling back to WASM is the current provider doesn't work
                // out. Might lose some translations the process but
                // InPageTranslation should be able to deal with that.
                if (preferred !== 'wasm') {
                    console.info(`Provider ${preferred} encountered irrecoverable errors. Falling back to 'wasm'`);
                    preferences.delete('provider', preferred);
                    this.reset();
                }
            };

            accept(provider);
        });
    }

    /**
     * Useful to get access to the provider but only if it was instantiated.
     * @returns {Promise<TranslationHelper>|Null}
     */
    has() {
        return this.#provider
    }

    /**
     * Releases the current translation provider.
     */
    reset() {
        // TODO: Why are we doing this again?
        tabs.forEach(tab => tab.reset(tab.state.url));

        this.has()?.then(provider => provider.delete());

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
        provider.has()?.then(provider => {
            if (provider)
                provider.remove((request) => request._abortSignal.aborted);
        })

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

    // Automatically start translating preferred domains.
    tab.addEventListener('update', async ({target, data: {state}}) => {
        if (state === State.TRANSLATION_AVAILABLE) {
            const domains = await preferences.get('alwaysTranslateDomains', []);
            if (target.state.from && target.state.to && target.state.url
                && domains.includes(new URL(target.state.url).host))
                tab.translate();
        }
    });

    // Respond to certain messages from the content script. Mainly individual
    // translation requests, and detect language requests which then change the
    // state of the tab to reflect whether translations are available or not.
    contentScript.onMessage.addListener(async (message) => {
        switch (message.command) {
            // Send by the content-scripts inside this tab
            case "DetectLanguage":
                // TODO: When we support multiple frames inside a tab, we
                // should integrate the results from each frame somehow.
                // For now we ignore it, because 90% of the time it will be
                // an ad that's in English and mess up our estimate.
                if (contentScript.sender.frameId !== 0)
                    return;

                try {
                    const preferred = await preferences.get('preferredLanguageForPage')

                    const summary = await detectLanguage(message.data, await provider.get(), {preferred})
                    
                    tab.update(state => ({
                        from: state.from || summary.from, // default to keeping chosen from/to languages
                        to: state.to || summary.to,
                        models: summary.models,
                        state: summary.models.length > 0 // TODO this is always true (?)
                            ? State.TRANSLATION_AVAILABLE
                            : State.TRANSLATION_NOT_AVAILABLE
                    }));
                } catch (error) {
                    tab.update(state => ({
                        state: State.PAGE_ERROR,
                        error
                    }));
                }
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
                preferences.get('developer').then(developer => {
                    if (developer && tab.state.record) {
                        recorder.record(message.data);
                        tab.update(state => ({
                            recordedPagesCount: recorder.size
                        }));
                    }
                });

                try {
                    const translator = await provider.get();
                    const response = await translator.translate({...message.data, _abortSignal});
                    if (!response.request._abortSignal.aborted) {
                        contentScript.postMessage({
                            command: "TranslateResponse",
                            data: response
                        });
                    }
                } catch(e) {
                    // Catch error messages caused by abort()
                    if (e?.message === 'removed by filter' && e?.request?._abortSignal?.aborted)
                        return;

                    // Tell the requester that their request failed.
                    contentScript.postMessage({
                        command: "TranslateResponse",
                        data: {
                            request: message.data,
                            error: e.message
                        }
                    });
                    
                    // TODO: Do we want the popup to shout on every error?
                    // Because this can also be triggered by failing Outbound
                    // Translation!
                    tab.update(state => ({
                        state: State.TRANSLATION_ERROR,
                        error: e.message
                    }));
                } finally {
                    tab.update(state => ({
                        // TODO what if we just navigated away and all the
                        // cancelled translations from the previous page come
                        // in and decrement the pending count of the current
                        // page?
                        pendingTranslationRequests: state.pendingTranslationRequests - 1
                    }));
                }
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

                const translator = await provider.get();

                // Start the downloads and put them in a {[download:promise]: {read:int,size:int}}
                const downloads = new Map(message.data.models.map(model => [translator.downloadModel(model), {read:0.0, size:0.0}]));

                // For each download promise, add a progress listener that updates the tab state
                // with how far all our downloads have progressed so far.
                downloads.forEach((_, promise) => {
                    // (not supported by the Chrome offscreen proxy implementation right now)
                    if (promise.addProgressListener) {
                        promise.addProgressListener(({read, size}) => {
                            // Update download we got a notification about
                            downloads.set(promise, {read, size});
                            // Update tab state about all downloads combined (i.e. model, optionally pivot)
                            tab.update(state => ({
                                modelDownloadRead: Array.from(downloads.values()).reduce((sum, {read}) => sum + read, 0),
                                modelDownloadSize: Array.from(downloads.values()).reduce((sum, {size}) => sum + size, 0)
                            }));
                        });
                    }

                    promise.then(() => {
                        // Trigger update of state.models because the `local`
                        // property this model has changed. We don't support
                        // any nested key updates so let's just push the whole
                        // damn thing.
                        tab.update(state => ({
                            models: state.models
                        }));
                    })
                });

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

// Receive incoming connection requests from content-script and popup
compat.runtime.onConnect.addListener((port) => {
    if (port.name == 'content-script')
        connectContentScript(port);
    else if (port.name.startsWith('popup-'))
        connectPopup(port);
});

// Initialize or update the state of a tab when navigating
compat.tabs.onUpdated.addListener((tabId, diff) => {
    if (diff.url)
        getTab(tabId).reset(diff.url);
    // Todo: treat reload and link different? Reload -> disable translation?
});

// When a new tab is created start, track its active state
compat.tabs.onCreated.addListener(({id: tabId, active, openerTabId}) => {
    let inheritedState = {};

    // If the tab was opened from another tab that was already translating,
    // this tab will inherit that state and also automatically continue
    // translating.
    if (openerTabId) {
        const {state, url, from, to, models} = getTab(openerTabId).state;
        inheritedState = {state, url, from, to, models};
    }

    getTab(tabId).update(() => ({...inheritedState, active}));
});

// Remove the tab state if a tab is removed
compat.tabs.onRemoved.addListener(({tabId}) => {
    tabs.delete(tabId);
});

// Let each tab know whether its the active one. We use this state change
// event to keep the menu items in sync.
compat.tabs.onActivated.addListener(({tabId}) => {
    for (let [id, tab] of tabs) {
        // If the tab's active state doesn't match the activated tab, fix that.
        if (tab.active != (tab.id === tabId))
            tab.update(() => ({active: Boolean(tab.id === tabId)}));
    }
});

// On start-up init all (important) tabs we missed onCreated for
compat.tabs.query({active:true}).then(allTabs => {
    for (const tab of allTabs)
        getTab(tab.id).reset(tab.url);
})

compat.runtime.onInstalled.addListener(() => {
    // Add "translate selection" menu item to selections
    compat.contextMenus.create({
        id: 'translate-selection',
        title: 'Translate Selection',
        contexts: ['selection']
    });

    // Add "type to translate" menu item to textareas
    compat.contextMenus.create({
        id: 'show-outbound-translation',
        title: 'Type to translate…',
        contexts: ['editable']
    });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
    // First sanity check whether we know from and to languages
    // (and it isn't the same by accident)
    const {from, to} = getTab(tab.id).state;
    if (from === undefined || to === undefined || from === to) {
        compat.action.openPopup();
        return;
    }

    // Send the appropriate message down to the content script of the
    // tab we just clicked inside of.
    switch (info.menuItemId) {
        case 'translate-selection':
            getTab(tab.id).frames.get(info.frameId).postMessage({
                command: 'TranslateSelection'
            });
            break;
        case 'show-outbound-translation':
            getTab(tab.id).frames.get(info.frameId).postMessage({
                command: 'ShowOutboundTranslation'
            });
            break;
    }
})

// Makes debugging easier
Object.assign(self, {
    tabs,
    providers,
    provider,
    preferences,
    test
})
