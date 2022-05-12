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

const inPageTranslation = new InPageTranslation({
    translate(text, user) {
        console.assert(state.from !== undefined && state.to !== undefined,
            "state.from or state.to is not set");
        backgroundScript.postMessage({
            command: "TranslateRequest",
            data: {
                // translation request
                from: state.from,
                to: state.to,
                html: true,
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
});

on('TranslateResponse', data => {
    inPageTranslation.enqueueTranslationResponse(data.target.text, data.request.user);
});

// When this page shows up (either through onload or through history navigation)
window.addEventListener('pageshow', e => {
    // Connect to 
    backgroundScript = compat.runtime.connect({name: 'content-script'});

    // Connect all message listeners (the "on()" calls above)
    backgroundScript.onMessage.addListener(({command, data}) => {
        if (listeners.has(command))
            listeners.get(command).forEach(callback => callback(data));
    });

    // When the background script disconnects, also pause in-page translation
    backgroundScript.onDisconnect.addListener(() => {
        inPageTranslation.stop();
    });
});

// When this page disappears (either onunload, or through history navigation)
window.addEventListener('pagehide', e => {
    if (backgroundScript)
        backgroundScript.disconnect();
});

let lastClickedElement;

window.addEventListener('mousedown', e => {
    lastClickedElement = e.target;
});

on('TranslateClickedElement', () => {
    console.assert(lastClickedElement, 'TranslateClickedElement but no lastClickedElement');
    inPageTranslation.addElement(lastClickedElement);
    inPageTranslation.start(state.from);
});