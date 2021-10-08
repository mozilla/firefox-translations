/*
 * the LanguageDetection class is responsible for holding the language detection
 * properties and methods as also the for heuristics to determine if the
 * translation bar should be displayed
 */

class LanguageDetection {

    constructor() {
        this.navigatorLanguage = navigator.language;
        this.pageLanguage = null;
        this.wordsToDetect = null;
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
        this.wordsToDetect = wordsToDetect;
    }
}