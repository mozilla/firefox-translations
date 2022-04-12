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
            case 'translation-in-progress':
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

const inPageTranslation = new InPageTranslation({
    translate(text, user) {
        console.assert(state.from !== undefined && state.to !== undefined);
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
                priority: user.priority || 0
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
    backgroundScript = browser.runtime.connect({name: 'content-script'});

    // Connect all message listeners (the "on()" calls above)
    backgroundScript.onMessage.addListener(({command, data}) => {
        if (listeners.has(command))
            listeners.get(command).forEach(callback => callback(data));
    });

    // When the background script disconnects, also pause in-page translation
    backgroundScript.onDisconnect.addListener(() => {
        inPageTranslation.stop();
    });

    // Request a state update. If the state is 'translation-in-progress' then
    // the on() listener will also re-activate the inPageTranslation.
    backgroundScript.postMessage({
        command: "UpdateRequest",
        data: state
    });
});

// When this page disappears (either onunload, or through history navigation)
window.addEventListener('pagehide', e => {
    backgroundScript.disconnect();
});
