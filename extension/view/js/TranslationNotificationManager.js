/*
 * class responsible for handling the translationbar events, state, content
 * and all UI modifications and routing with the mediator
 */

// eslint-disable-next-line no-unused-vars
class TranslationNotificationManager {

    constructor(api, modelRegistry, detectedLanguage, navigatorLanguage) {
        this.api = api;
        this.modelRegistry = modelRegistry;
        this.detectedLanguage = detectedLanguage;
        this._navigatorLanguage = navigatorLanguage;
        this.languageSet = new Set();
        this.devLanguageSet = new Set();
        this.storage = null;
        this.autoTranslate = false;
        this.loadLanguages();
    }

    get navigatorLanguage() {
        return this._navigatorLanguage;
    }

    set tabId(val) {
        this._tabId = val;
    }

    get tabId() {
        return this._tabId;
    }

    set bgScriptListenerCallback(val) {
        this._bgScriptListenerCallback = val;
    }

    get bgScriptListenerCallback() {
        return this._bgScriptListenerCallback;
    }

    set notificationBox(val) {
        this._notificationBox = val;
    }

    get notificationBox() {
        return this._notificationBox;
    }

    get TranslationInfoBarStates() {
        return {
            STATE_OFFER: 0,
            STATE_TRANSLATING: 1,
            STATE_TRANSLATED: 2,
            STATE_ERROR: 3,
            STATE_UNAVAILABLE: 4,
        };
    }

    set localizedLabels(val) {
        this._localizedLabels = val;
    }

    get localizedLabels() {
        return this._localizedLabels;
    }

    loadLanguages() {
        const navLangCode = this.navigatorLanguage.substring(0,2);
        // all languages become 'dev' because translation is pivoted to 'dev' model en-nav_language
        const requiresPivoting = navLangCode !== "en";
        const isPivotModelDev = requiresPivoting && this.modelRegistry[`en${navLangCode}`].model.modelType === "dev";

        for (const languagePair of Object.keys(this.modelRegistry)) {
            const firstLang = languagePair.substring(0, 2);
            const secondLang = languagePair.substring(2, 4);
            if (firstLang !== navLangCode) {
                this.languageSet.add(firstLang);

                if (isPivotModelDev ||
                  ((secondLang === navLangCode || (requiresPivoting && secondLang === "en")) &&
                    this.modelRegistry[languagePair].model.modelType === "dev")) {
                    this.devLanguageSet.add(firstLang);
                }
            }
        }
    }

    reportInfobarMetric(type, name, value) {

        /*
         * propagate UI event to bgScript
         */
        const message = {
            command: "recordTelemetry",
            tabId: this.tabId,
            type,
            category: "infobar",
            name,
            value
        };
        this.bgScriptListenerCallback(message);
    }

    requestInPageTranslation(from, to, withOutboundTranslation, withQualityEstimation) {

        /*
         * request received. let's forward to the background script in order
         * to have the mediator notified
         */
        const message = {
            command: "translationRequested",
            from,
            to,
            withOutboundTranslation,
            withQualityEstimation,
            tabId: this.tabId
        };
        this.bgScriptListenerCallback(message);
    }

    showSurvey() {

        /*
         * notify the mediator that the user wants to participate in survey
         */
        const message = { command: "showSurvey", tabId: this.tabId };
        this.bgScriptListenerCallback(message);
    }

    enableStats() {

        /*
         * notify the mediator that the user wants to see statistics
         */
        const message = { command: "displayStatistics", tabId: this.tabId };
        this.bgScriptListenerCallback(message);
    }

    setStorage(key, value) {

        /*
         * informs the bgscript to persist settings on storage
         */
        const message = { command: "setStorage", payload: { [key]: value } }
        this.bgScriptListenerCallback(message);
    }

    translateAsBrowse() {
        const message = {
            command: "translateAsBrowse",
            tabId: this.tabId,
            translatingAsBrowse: this.autoTranslate
        }
        this.bgScriptListenerCallback(message);
    }
}