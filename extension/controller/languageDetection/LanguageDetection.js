/*
 * the LanguageDetection class is responsible for holding the language detection
 * properties and methods as also the for heuristics to determine if the
 * translation bar should be displayed
 */

/* global modelRegistry*/
// eslint-disable-next-line no-unused-vars
class LanguageDetection {

    constructor() {
        [this.languagesSupportedSet, this.languagePairsSupportedSet] =
            this.constructLanguageSets();
        this.navigatorLanguage = this.getNavigatorLanguage();
        this.pageLanguage = null;
    }

    extractPageContent() {
        let supported = this.isBrowserSupported();
        // skip (expensive) page content extraction if not supported
        let wordsToDetect =
            supported
            ? document.body.innerText
            : "";
        return { supported, wordsToDetect };
    }

    /*
     * update the page language used for detection.
     */
    setPageLanguage(pageLanguage) {
        this.pageLanguage = pageLanguage;
    }

    /*
     * return if the page mets the conditiions to display
     * or not the translation bar
     */
    shouldDisplayTranslation() {
        let from = this.pageLanguage.concat("en");
        let to = "en".concat(this.navigatorLanguage.substring(0,2));
        if (from === "enen") from = to;
        if (to === "enen") to = from;
        return this.isLangMismatch() &&
            this.languagePairsSupportedSet.has(from) &&
            this.languagePairsSupportedSet.has(to);

    }

    /*
     * page language is different from user languages
     */
    isLangMismatch() {
        return !this.navigatorLanguage.includes(this.pageLanguage);
    }

    isBrowserSupported() {
        return this.languagesSupportedSet.has(this.navigatorLanguage);
    }

    /*
     * we scan all supported languages by the browser and return on that
     * matches the models we support, if none is supported, we just return the
     * default language, which is navigator.languages[0]
     */
    getNavigatorLanguage() {
        for (const langSupported of navigator.languages) {
            if (this.languagesSupportedSet.has(langSupported.substring(0,2))) {
                return langSupported.substring(0,2);
            }
        }
        return navigator.language.substring(0,2);
    }

    constructLanguageSets(){
        const languagesSupportedSet = new Set();
        const languagePairsSupportedSet = new Set();

        for (const languagePair of Object.keys(modelRegistry)) {
            const secondLang = languagePair.substring(2, 4);
            languagesSupportedSet.add(secondLang);
            languagePairsSupportedSet.add(languagePair);
        }

        return [languagesSupportedSet, languagePairsSupportedSet];
    }
}