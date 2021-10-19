/*
 * class responsible for handling the translationbar events, state, content
 * and all UI modifications and routing with the mediator
 */

class TranslationNotificationManager {

    constructor(api, modelRegistry, detectedLanguage, navigatorLanguage, tabId, bgScriptListenerCallback, notificationBox) {
        this.api = api;
        this.detectedLanguage = detectedLanguage;
        this.navigatorLanguage = navigatorLanguage;
        this.languageSet = new Set();
        this.modelRegistry = modelRegistry;
        this.bgScriptListenerCallback = bgScriptListenerCallback;
        this.tabId = tabId;
        this.notificationBox = notificationBox;
        this.loadLanguages();
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

    loadLanguages() {
        for (const languagePair of Object.keys(this.modelRegistry)){
            const firstLang = languagePair.substring(0,2);
            const secondLang = languagePair.substring(2,4);
            this.languageSet.add(firstLang);
            this.languageSet.add(secondLang);
        }
    }

    requestTranslation(from, to){

        /*
         * request received. let's forward to the background script in order
         * to have the mediator notified
         */
        console.log("requestTranslation", from, to, this.tabId);
        const message = { command: "translationRequested", from, to, tabId: this.tabId };
        this.bgScriptListenerCallback(message);
    }
}