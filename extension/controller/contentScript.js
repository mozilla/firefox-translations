"use strict";

let backgroundScript;

const listeners = new Map();

const state = {
    state: 'page-loaded'
};

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
                inPageTranslation.stop();
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
            user: {
                ...user,
                
            },
            
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

on('TranslateResponse', data => {
    switch (data.request.user?.source) {
        case 'InPageTranslation':
            inPageTranslation.enqueueTranslationResponse(data.target.text, data.request.user);
            break;
        case 'SelectionTranslation':
            selectionTranslation.enqueueTranslationResponse(data.target.text, data.request.user);
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

// Track last clicked element for TranslateClickedElement
let lastClickedElement;

window.addEventListener('mousedown', e => {
    lastClickedElement = e.target;
});

on('TranslateClickedElement', () => {
    console.assert(lastClickedElement, 'TranslateClickedElement but no lastClickedElement');
    inPageTranslation.addElement(lastClickedElement);
    inPageTranslation.start(state.from);
});

on('TranslateSelection', () => {
    const selection = document.getSelection();
    selectionTranslation.start(selection);
});