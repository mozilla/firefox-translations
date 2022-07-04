/*
 * the LanguageDetection class is responsible for holding the language detection
 * properties and methods as also the for heuristics to determine if the
 * translation bar should be displayed
 */

class LanguageDetection {
    /**
     * Extracts a bit of sample text from the page. Will only resolve once
     * there is some actual text.
     * @return {Promise<String>}
     */
    extractPageContent() {
        return new Promise((resolve, _) => {
            const extract = () => {
                // TODO: this gives a strong preference to whatever appears at
                // the top of the page. If that is English navigation or boiler-
                // plate this might not be great. Should we do something like
                // Readability.js to try to detect the meaty bit of the page?
                const sample = document.body.innerText.slice(0, 2048);
                
                // If the sample is good, resolve our promise.
                if (sample.trim() !== '') {
                    resolve(sample);
                    return true;
                } else {
                    return false;
                }
            };

            // If we got a sample right now, we're good.
            if (extract())
                return;

            // Otherwise, we wait for mutations until we get a good sample.
            // This happens a lot in PWAs that just load a blank page, and then
            // start loading a lot of Javascript.
            const observer = new MutationObserver((_, observer) => {
                if (extract())
                    observer.disconnect();
            });

            observer.observe(document.body, {subtree: true, childList: true});
        });
    }

    /**
     * Extracts hints of the page language from HTML lang attributes.
     * @return { [lang: string]: number }
     */
    extractSuggestedLanguages() {
        const suggestions = {};

        // If the root element has a lang attribute, that's a pretty solid hint
        if (document.querySelector('html[lang]'))
            suggestions[document.querySelector('html[lang]').lang] = 1.0;

        // TODO: look at individual elements with lang attributes, and how much
        // of the content they cover? E.g. some website with English navigation
        // but local content. But would they annotate the content anyway?
        return suggestions;
    }
}