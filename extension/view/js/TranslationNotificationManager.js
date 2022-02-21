/*
 * class responsible for handling the translationbar events, state, content
 * and all UI modifications and routing with the mediator
 */

// eslint-disable-next-line no-unused-vars
class TranslationNotificationManager {

    constructor(api, modelRegistry, detectedLanguage) {
        this.api = api;
        this.modelRegistry = modelRegistry;
        this.detectedLanguage = detectedLanguage;
        this.languageSet = new Set();
        this.loadLanguages();
    }

    set navigatorLanguage(val) {
        this._navigatorLanguage = val;
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
        for (const languagePair of Object.keys(this.modelRegistry)){
            const firstLang = languagePair.substring(0,2);
            const secondLang = languagePair.substring(2,4);
            this.languageSet.add(firstLang);
            this.languageSet.add(secondLang);
        }
    }

    reportInfobarEvent(name) {

        /*
         * propagate UI event to bgScript
         * to have the mediator notified
         */
        const message = { command: "onInfobarEvent", tabId: this.tabId, name };
        this.bgScriptListenerCallback(message);
    }

    requestInPageTranslation(from, to, withOutboundTranslation, withQualityEstimation){

        /*
         * request received. let's forward to the background script in order
         * to have the mediator notified
         */
        const message = { command: "translationRequested",
                            from,
                            to,
                            withOutboundTranslation,
                            withQualityEstimation,
                            tabId: this.tabId };
        this.bgScriptListenerCallback(message);
    }

    enableStats(){

        /*
         * notify the mediator that the user wants to see statistics
         */
        const message = { command: "displayStatistics", tabId: this.tabId };
        this.bgScriptListenerCallback(message);
    }
}