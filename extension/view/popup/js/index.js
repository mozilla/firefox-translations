/* eslint-disable no-undef */
const $ = selector => document.querySelector(selector);
const langFrom = $("#lang-from");
const langTo = $("#lang-to");
let supportedFromCodes = {};
let supportedToCodes = {};
let mediator = null;
let langs = null;


class Mediator {

    constructor() {
        this.translation = new Translation(this);
    }

    translate(message) {
        const translationMessage = this.translation.constructTranslationMessage(
            message.text,
            message.type,
            null,
            null,
            null,
            message.toLanguage,
            message.fromLanguage,
            null,
            false,
            false,
            false
        );
        this.translation.translate(translationMessage);
    }

    contentScriptsMessageListener(sender, message) {
        switch (message.command) {
            case "downloadLanguageModels":
                browser.runtime.sendMessage({
                    command: "downloadLanguageModels",
                    languagePairs: message.payload,
                    tabId: 0
                });
                break;
            case "updateProgress":
                // first we localize the message.
                // eslint-disable-next-line no-case-declarations
                let localizedMessage;
                if (typeof message.payload[1] === "string") {
                    localizedMessage = browser.i18n.getMessage(message.payload[1]);
                } else if (message.payload[1][0] === "translationProgress") {
                    localizedMessage = `${browser.i18n.getMessage("translationEnabled")}`;
                }

                document.getElementById("status").innerText = localizedMessage;
                break;
            case "translationComplete":
                message.payload[1].forEach(translationMessage => {
                    document.querySelector("#output").value = translationMessage.translatedParagraph;
                });
                if ($(".swap").disabled){
                    $(".swap").disabled = false;
                    $(".swap").style.cursor = "pointer";
                }
                break;
            default:
        }
    }

    bgListener(message) {
        switch (message.command) {
            case "responseDownloadLanguageModels":
                if (this.translation) this.translation.sendDownloadedLanguageModels(message.languageModels);
                break;
            case "updateProgress":
                document.getElementById("status").innerText = message.localizedMessage;
                break;
            case "responseDetectPageLanguage":
                if (langs.get(message.pageLanguage) && message.pageLanguage !== langFrom.value) {
                    this.languageDetected = message.pageLanguage;
                    document.getElementById("suggestion").style.display = "block";
                    document.getElementById("translatefrom").innerText = browser.i18n.getMessage("translationBarTranslateButton");
                    document.getElementById("translatelanguage").innerText = langs.get(message.pageLanguage);
                } else if (message.pageLanguage === langFrom.value) {
                    document.getElementById("suggestion").style.display = "none";
                }
                break;
            default:
        }
    }
}

const setLangs = (selector, langsToSet, value, exclude) => {
    selector.textContent = "";
    selector.add(new Option(browser.i18n.getMessage("languageDefaultOption"), "0"));
    for (const [code, type] of Object.entries(langsToSet)) {
        if (code !== exclude) {
            let name = langs.get(code);
            if (type === "dev") name += " (Beta)";
            selector.add(new Option(name, code));
        }
    }
    selector.value = value;
}
const translateCall = () => {
    const text = `${document.querySelector("#input").value} `;

    if (text.trim().length) {
        browser.runtime.sendMessage({
            command: "detectPageLanguage",
            languageDetection: {
                supported: true,
                wordsToDetect: text.substring(0, 4096),
                htmlElementLanguage: ""
            }
        })
    }

    if (langFrom.value === "0" || langTo.value === "0") return;
    if (!text.trim().length) {
        $("#output").value = "";
        document.getElementById("suggestion").style.display = "none";
        if ($(".swap").disabled){
            $(".swap").disabled = false;
            $(".swap").style.cursor = "pointer";
        }
        return;
    }
    const paragraphs = text.replace("\n", " ");
    $("#output").setAttribute("disabled", true);
    if (!mediator) {
        mediator = new Mediator();
        browser.runtime.onMessage.addListener(mediator.bgListener.bind(mediator));
    }
    mediator.translate({
        text: paragraphs,
        type: "inpage",
        fromLanguage: langFrom.value,
        toLanguage: langTo.value
    })
};

(function init() {

    const listener = message => {
        if (message.command === "responseLocalizedLanguages") {
            browser.runtime.onMessage.removeListener(listener);
            langs = message.localizedLanguages;
            // parse supported languages and model types (prod or dev)
            supportedFromCodes.en = "prod";
            supportedToCodes.en = "prod";
            for (const [langPair, value] of Object.entries(modelRegistry)) {
                const firstLang = langPair.substring(0, 2);
                const secondLang = langPair.substring(2, 4);
                if (firstLang !== "en") supportedFromCodes[firstLang] = value.model.modelType;
                if (secondLang !== "en") supportedToCodes[secondLang] = value.model.modelType;
            }

            browser.storage.local.get(["langFrom", "langTo"]).then(value => {
                if (Object.keys(value).length === 0) {
                    setLangs(langFrom, supportedFromCodes, "0", null);
                    setLangs(langTo, supportedToCodes, "0", "0");
                } else {
                    setLangs(langFrom, supportedFromCodes, value.langFrom, null);
                    setLangs(langTo, supportedToCodes, value.langTo, null);
                }
            });

            document.querySelector("#input").value = message.popupPreLoadText;
            if (message.popupPreLoadText) {
                setTimeout(() => {
                    translateCall();
                }, 100);
            }
        }
    }
    browser.runtime.onMessage.addListener(listener);
    browser.runtime.sendMessage({
        command: "returnLocalizedLanguages"
    });
})();

document.querySelector("#input").addEventListener("keyup", function () {
    translateCall();
});

document.querySelector("#input").addEventListener("paste", function () {
    setTimeout(() => {
        translateCall();
    }, 100);
});

const storeLangs = () => {
    browser.storage.local.set({ langFrom: langFrom.value, langTo: langTo.value });
}

$(".swap").addEventListener("click", () => {
    if (mediator){
        $(".swap").disabled = true;
        $(".swap").style.cursor = "wait";
        browser.runtime.onMessage.removeListener(mediator.bgListener);
        mediator.translation = null;
        mediator = null;
    }
    const prevLangFrom = langFrom.value
    langFrom.value = langTo.value;
    const oldInput = $("#input").value;
    $("#input").value = $("#output").value;
    $("#output").value = oldInput;

    if (prevLangFrom in supportedToCodes) {
        setLangs(langTo, supportedToCodes, prevLangFrom, langFrom.value);
        translateCall();
    } else {
        langTo.value = "0";
        $("#output").value = "";
    }
    storeLangs();
});

langFrom.addEventListener("change", () => {
    if (mediator) {
        browser.runtime.onMessage.removeListener(mediator.bgListener);
        mediator.translation = null;
        mediator = null;
    }
    translateCall();
    storeLangs();
});

langTo.addEventListener("change", () => {
    if (mediator) {
        browser.runtime.onMessage.removeListener(mediator.bgListener);
        mediator.translation = null;
        mediator = null;
    }
    translateCall();
    storeLangs();
});

document.querySelector("#suggestion").addEventListener("click", function () {
    langFrom.value = mediator.languageDetected;
    langFrom.dispatchEvent(new Event("change"));
    translateCall();
});