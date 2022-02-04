/*
 * the LanguageDetection class is responsible for holding the language detection
 * properties and methods as also the for heuristics to determine if the
 * translation bar should be displayed
 */

// eslint-disable-next-line no-unused-vars
class LanguageDetection {
    /*
     * extracts the page's first 100 words in order to be used by the language
     * detection module. This heuristic should be revisited in the future, to
     * something like searching for the elements in the middle of the page
     * instead of the top
     */
    extractPageContent() {
        const MAX_ELEMENTS = 100;
        let total_words = 0;
        let wordsToDetect = "";
        const elements = document.querySelectorAll("div");
        for (let i = 0; i <= elements.length-1; i+=1) {
            const cleanInnerText = elements[i].innerText
                .replace(/\r?\n|\r/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            const elementSize = cleanInnerText.split(" ").length;
            if (total_words + elementSize <= MAX_ELEMENTS) {
                total_words += elementSize;
                wordsToDetect = wordsToDetect.concat(cleanInnerText, " ");
            } else {
                const lastElement = cleanInnerText.split(" ");
                for (let j = 0; j<= MAX_ELEMENTS - total_words -1; j+=1) {
                    wordsToDetect = wordsToDetect.concat(lastElement[j], " ");
                }
                break;
            }
        }
        return wordsToDetect;
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