/* global browser */

function* product(as, bs) {
    for (let a of as)
        for (let b of bs)
            yield [a, b];
}

function isSameDomain(url1, url2) {
    return url1 && url2 && new URL(url1).host === new URL(url2).host;
}

// Temporary fix around few models, bad classified, and similar looking languages.
// From https://github.com/bitextor/bicleaner/blob/3df2b2e5e2044a27b4f95b83710be7c751267e5c/bicleaner/bicleaner_hardrules.py#L50
const SimilarLanguages = [
    new Set(['es', 'ca', 'gl', 'pt']),
    new Set(['no', 'nb', 'nn', 'da']) // no == nb for bicleaner
];

/**
 * Language detection function that also provides a sorted list of
 * from->to language pairs, based on the detected language, the preferred
 * target language, and what models are available.
 */
async function detectLanguage({sample, suggested}, languageHelper) {
    if (!sample)
        throw new Error('Empty sample');

    const [detected, models] = await Promise.all([
        browser.i18n.detectLanguage(sample),
        translationHelper.registry
    ]);

    const modelsFromEng = models.filter(({from}) => from === 'en');
    const modelsToEng = models.filter(({to}) => to === 'en');

    // List of all available from->to translation pairs including ones that we
    // achieve by pivoting through English.
    const pairs = [
        ...models.map(({from, to}) => ({from, to, pivot: null})),
        ...Array.from(product(modelsToEng, modelsFromEng))
            .filter(([{from}, {to}]) => from !== to)
            .map(([{from}, {to}]) => ({from, to, pivot: 'en'}))
    ];

    // {[lang]: 0.0 .. 1.0} map of likeliness the page is in this language
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
    const preferred = (await browser.i18n.getAcceptLanguages()).reduce((preferred, language, i, languages) => {
        // Todo: right now all our models are just two-letter codes instead of BCP-47 :(
        const code = language.substr(0, 2);
        return code in preferred ? preferred : {...preferred, [code]: 1.0 - (i / languages.length)};
    }, {});
    
    // Function to score a translation model. Higher score is better
    const score = ({from, to, pivot}) => ((confidence[from] || 0.0) + (preferred[to] || 0.0) + (pivot ? 0.0 : 1.0));

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
    TRANSLATION_NOT_AVAILABLE: 'translation-not-available',
    TRANSLATION_AVAILABLE: 'translation-available',
    TRANSLATION_IN_PROGRESS: 'translation-in-progress',
    TRANSLATION_FINISHED: 'translation-finished',
    TRANSLATION_ERROR: 'translation-error'
};

class Tab extends EventTarget {
    constructor(id) {
        super();
        this.id = id;
        this.state = {
            state: State.PAGE_LOADING,
            pendingTranslationRequests: 0,
            totalTranslationRequests: 0,
            debug: false,
            url: null
        };
        this.frames = new Map();

        this._scheduledUpdateEvent = null;
    }

    /**
     * Begins translation of the tab
     */
    translate({from, to}) {
        this.update(state => ({
            state: State.TRANSLATION_IN_PROGRESS,
            from,
            to
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
            postMessage({
                command: 'TranslateAbort'
            });
        });
    }

    /**
     * Resets the tab state after navigating away from a page. The disconnect
     * of the tab's content scripts will already have triggered abort()
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
                    from: null,  // Only reset from as page could be different
                                 // language. We leave to selected as is
                    pendingTranslationRequests: 0,
                    totalTranslationRequests: 0,
                    state: State.PAGE_LOADING
                };
            }
        });
    }

    update(callback) {
        const diff = callback(this.state);
        if (diff === undefined)
            throw new Error('state update callback function did not return a value');

        Object.assign(this.state, diff);

        // Delay the update notification to accumulate multiple changes in one
        // notification.
        if (!this._scheduledUpdateEvent) {
            const callbackId = requestIdleCallback(this._dispatchUpdateEvent.bind(this));
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

function showPopup(event) {
    switch (event.target.state.state) {
        case State.TRANSLATION_AVAILABLE:
        case State.TRANSLATION_IN_PROGRESS:
            browser.pageAction.show(event.target.id);
            break;
        case State.TRANSLATION_NOT_AVAILABLE:
            browser.pageAction.hide(event.target.id);
            break;
    }
}


const translationHelper = new TranslationHelper();

// State per tab
const tabs = new Map();

function getTab(tabId) {
    if (!tabs.has(tabId)) {
        const tab = new Tab(tabId);
        tabs.set(tabId, tab);
        tab.addEventListener('update', showPopup);
    }

    return tabs.get(tabId);
}

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
        translationHelper.remove((request) => request._abortSignal.aborted);

        // Create a new signal in case we want to start translating again.
        _abortSignal = {aborted: false};
    };

    // Make the content-script receive state updates
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
                detectLanguage(message.data, translationHelper).then(summary => {
                    // TODO: When we support multiple frames inside a tab, we
                    // should integrate the results from each frame somehow.
                    tab.update(state => ({
                        page: summary, // {from, to, models}
                        state: summary.models.length > 0 // TODO this is always true
                            ? State.TRANSLATION_AVAILABLE
                            : State.TRANSLATION_NOT_AVAILABLE
                    }));
                });
                break;

            // Send by the content-scripts inside this tab
            case "TranslateRequest":
                tab.update(state => ({
                    pendingTranslationRequests: state.pendingTranslationRequests + 1,
                    totalTranslationRequests: state.totalTranslationRequests + 1
                }));
                translationHelper.translate({...message.data, _abortSignal})
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
                        
                        // rethrow any other error
                        throw e;
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

    popup.onMessage.addListener(message => {
        switch (message.command) {
            case "TranslateStart":
                tab.translate({
                    from: message.data.from,
                    to: message.data.to
                });
                break;
            
            case 'TranslateAbort':
                tab.abort();
                break;
        }
    });
}

// Receive incoming connection requests from content-script and popup
browser.runtime.onConnect.addListener((port) => {
    if (port.name == 'content-script')
        connectContentScript(port);   
    else if (port.name.startsWith('popup-'))
        connectPopup(port);
});

// Initialize or update the state of a tab when navigating
browser.webNavigation.onCommitted.addListener(({tabId, frameId, url}) => {
    // Right now we're only interested in top-level navigation changes
    if (frameId !== 0)
        return;

    // Todo: treat reload and link different? Reload -> disable translation?
    getTab(tabId).reset(url);
});

// Remove the tab state if a tab is removed
browser.tabs.onRemoved.addListener(({tabId}) => {
    tabs.delete(tabId);
});