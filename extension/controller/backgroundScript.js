/* global browser */

function* product(as, bs) {
    for (let a of as)
        for (let b of bs)
            yield [a, b];
}

const translationHelper = new TranslationHelper();

/**
 * Language detection function that also provides a sorted list of
 * from->to language pairs, based on the detected language, the preferred
 * target language, and what models are available.
 */
async function detectLanguage(sample) {
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
    const confidence = Object.fromEntries(detected.languages.map(({language, percentage}) => [language, percentage / 100]));

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

    return {
        from: detected.languages[0].language,
        to: Object.entries(preferred).reduce((best, pair) => pair[1] > best[1] ? pair : best)[0],
        models: pairs
    }
}

const State = {
    PAGE_LOADING: 'page-loading',
    PAGE_LOADED: 'page-loaded',
    // LANGUAGE_DETECTED: 'language-detected',
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
        this.state = State.PAGE_LOADING;
        this.frames = new Map();
    }

    translate({from, to}) {
        this.update({
            state: State.TRANSLATION_IN_PROGRESS,
            from,
            to
        });

        this.frames.forEach(frame => {
            frame.postMessage({
                command: 'TranslateStart',
                data: {from, to}
            });
        });
    }

    abort() {
        this.update({
            state: State.TRANSLATION_AVAILABLE
        });

        this.frames.forEach(frame => {
            postMessage({
                command: 'TranslateAbort'
            });
        });
    }

    update(update) {
        const state = this.state;
        Object.assign(this, update);

        const updateEvent = new Event('update');
        updateEvent.data = update;
        this.dispatchEvent(updateEvent);

        if (this.state !== state) {
            this.dispatchEvent(new Event('statechange'));
        }
    }
}

function showPopup(event) {
    if (event.target.state === State.TRANSLATION_AVAILABLE) {
        browser.pageAction.show(event.target.id);
    }
}

// State per tab
const tabs = new Map();

function getTab(tabId) {
    if (!tabs.has(tabId)) {
        const tab = new Tab(tabId);
        tabs.set(tabId, tab);
        tab.addEventListener('statechange', showPopup);
    }

    return tabs.get(tabId);
}

function connectContentScript(contentScript) {
    const tab = getTab(contentScript.sender.tab.id);
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

    contentScript.onDisconnect.addListener(event => {
        tab.frames.delete(contentScript.sender.frameId);
        abort();

        if (contentScript.sender.frameId === 0)
            tabs.delete(tab.id);
    });

    contentScript.onMessage.addListener(message => {
        console.log('contentScript.onMessage', message);

        switch (message.command) {
            case "DetectLanguage":
                detectLanguage(message.data.sample).then(summary => {
                    tab.update({
                        ...summary, // {from, to, models}
                        state: summary.models.length > 0
                            ? State.TRANSLATION_AVAILABLE
                            : State.TRANSLATION_NOT_AVAILABLE
                    });
                });
                break;

            case "TranslateRequest":
                translationHelper.translate({...message.data, _abortSignal}).then(response => {
                    if (!response.request._abortSignal.aborted) {
                        contentScript.postMessage({
                            command: "TranslateResponse",
                            data: response
                        });
                    }
                });
                break;

            case "TranslateAbort":
                abort();
                break;
        }
    });
}

function connectPopup(popup) {
    console.log('connectPopup', popup);

    const tabId = parseInt(popup.name.substr('popup-'.length));

    const tab = getTab(tabId);

    const updateListener = (event) => {
        popup.postMessage({
            command: 'Update',
            data: event.data
        });
    };

    tab.addEventListener('update', updateListener);

    popup.onDisconnect.addListener(event => {
        tab.removeEventListener('update', updateListener);
    })

    popup.onMessage.addListener(message => {
        console.log('popup.onMessage', message);

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

    popup.postMessage({
        command: 'Update',
        data: {
            state: tab.state,
            from: tab.from,
            to: tab.to,
            models: tab.models
        }
    });
}

// State per frame
browser.runtime.onConnect.addListener((port) => {
    if (port.name == 'content-script')
        connectContentScript(port);   
    else if (port.name.startsWith('popup-'))
        connectPopup(port);
});
