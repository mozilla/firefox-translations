"use strict";

const backgroundScript = browser.runtime.connect({name: 'content-script'});

const state = {
    state: 'page-loading'
};

function on(command, callback) {
    backgroundScript.onMessage.addListener(message => {
        if (message.command === command)
            callback(message.data);
    });
}

on('Update', diff => {
    Object.assign(state, diff);
});

on('Update', diff => {
    if ('state' in diff && diff.state === 'translation-in-progress')
        inPageTranslation.start(diff.from);
});

on('Update', async diff => {
    if ('state' in diff && diff.state === 'page-loading') {
        // request the language detection class to extract a page's snippet
        const languageDetection = new LanguageDetection();
        const sample = await languageDetection.extractPageContent();
        const suggested = languageDetection.extractSuggestedLanguages();

        // Once we have the snippet, send it to background script for analysis
        // and possibly further action (like showing the popup)
        backgroundScript.postMessage({
            command: "DetectLanguage",
            data: {
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
});
