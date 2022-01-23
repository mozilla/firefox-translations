/*
 * the LanguageDetection class is responsible for holding the language detection
 * properties and methods as also the for heuristics to determine if the
 * translation bar should be displayed
 */

// eslint-disable-next-line no-unused-vars
class LanguageDetection {

    constructor() {
        this.navigatorLanguage = navigator.language.substring(0,2);
        this.pageLanguage = null;
        this.wordsToDetect = null;
        this.ignoredTags = this.loadIgnoredTags();
    }

    loadIgnoredTags() {
        const ignoredSet = new Set();
        ignoredSet.add("SCRIPT");
        ignoredSet.add("NOSCRIPT");
        ignoredSet.add("IFRAME");
        return ignoredSet;
    }

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
        const elements = document.querySelectorAll("body")[0].children;
        for (let i = 0; i <= elements.length-1; i+=1) {
            if (!this.ignoredTags.has(elements[i].tagName)) {
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
        }
        this.wordsToDetect = wordsToDetect;
    }
}