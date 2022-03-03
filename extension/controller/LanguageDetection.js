/*
 * the LanguageDetection class is responsible for holding the language detection
 * properties and methods as also the for heuristics to determine if the
 * translation bar should be displayed
 */

// eslint-disable-next-line no-unused-vars
class LanguageDetection {
    extractPageContent() {
        return document.body.innerText.substr(0, 2048);
    }

    extractSuggestedLanguages() {
        const suggestions = {};

        // If the root element has a lang attribute, that's a pretty solid hint
        if (document.querySelector('html[lang]'))
            suggestions[document.querySelector('html[lang]').lang] = 1.0;

        // TODO: look at individual elements with lang attributes, and how much
        // of the content they cover? Or should we handle those in a special
        // way anyway! Would fix pretty much all issues of Wikipedia in one go.
        return suggestions;
    }
}