/*
 * the LanguageDetection class is responsible for holding the language detection
 * properties and methods as also the for heuristics to determine if the
 * translation bar should be displayed
 */

/* global modelRegistry*/
// eslint-disable-next-line no-unused-vars
class LanguageDetection {

    constructor() {
        this.navigatorLanguage = navigator.language.substring(0,2);
        this.pageLanguage = null;
        this.wordsToDetect = null;
    }

    extractPageContent() {
        this.wordsToDetect = document.body.innerText;
    }

    /*
     * return if the page mets the conditiions to display
     * or not the translation bar
     */
    shouldDisplayTranslation() {
        const languageSet = new Set()
        if (modelRegistry) {
            for (const languagePair of Object.keys(modelRegistry)){
                languageSet.add(languagePair);
            }
        }
        let from = this.pageLanguage.concat("en");
        let to = "en".concat(this.navigatorLanguage.substring(0,2));
        if (from === "enen") from = to;
        if (to === "enen") to = from;
        return this.isLangMismatch() &&
            languageSet.has(from) &&
            languageSet.has(to);

    }

    /*
     * page language is different from user languages
     */
    isLangMismatch() {
        return !this.navigatorLanguage.includes(this.pageLanguage);
    }
}