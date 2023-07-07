/* eslint-disable no-unused-vars */
/* global browser, DOMPurify, AndroidUI */

class AndroidUI {

    constructor() {
        this.onTranslationRequest = {};
        this.onTranslationRequest.addListener = this._onTranslationRequest;
        this.mapLangs = this.populateMapLangs();
    }

    async show(tabId, srcLang, dstLang) {

        for (let [key, value] of this.mapLangs) {
            if (srcLang === value) this.srcLang = key;
            if (dstLang === value) this.dstLang = key;
        }
        let pageFragment = null;
        const response = await fetch(browser
            .runtime.getURL("view/static/androidButton.html"), { mode: "no-cors" });
          if (response.ok) {
            pageFragment = await response.text();
          } else {
            pageFragment = "Error loading translation code fragment";
          }

        // then we create the div that holds it
        this.uiDiv = document.createElement("div");
        this.uiDiv.className = "fxtranslations-button";
        this.uiDiv.innerHTML = pageFragment;
        this.uiDiv.id = "fxtranslations-button";
        this.uiDiv.querySelector("#logo").src = browser.runtime.getURL("/view/icons/translation-color.svg");
        this.uiDiv.querySelector("#logo").addEventListener("click", this.displayModal.bind(this));
        this.tabId = tabId;
        this.uiDivHost = document.createElement("div");
        this.shadowRoot = this.uiDivHost.attachShadow({ mode: "closed" });
        this.shadowRoot.appendChild(this.uiDiv);
        document.body.appendChild(this.uiDivHost);
    }

    async displayModal(){
        if (this.modal) {
            this.modal.style.display = "block";
            return;
        }
        let pageFragment = null;
        const response = await fetch(browser
            .runtime.getURL("view/static/androidModal.html"), { mode: "no-cors" });
          if (response.ok) {
            pageFragment = await response.text();
          } else {
            pageFragment = "Error loading outbound translation code fragment";
          }

        // then we create the div that holds it
        this.modal = document.createElement("div");
        this.modal.innerHTML = pageFragment;
        this.modal.className = "fxtranslations-modal";
        this.modal.id = "fxtranslations-modal";
        this.shadowRoot.appendChild(this.modal);
        this.modal.querySelector(".modal").style.display = "block";
        const closeBtn = this.modal.getElementsByClassName("close")[0];

        closeBtn.onclick = function() {
            this.modal.style.display = "none";
        }.bind(this);
        this.uiDiv.querySelector("#logo").src = browser.runtime.getURL("/view/icons/translation-color.svg");

        this.modal.querySelector("#translateBtn").addEventListener("click", this.translate.bind(this));
        this.modal.querySelector("#srcLang").value = this.srcLang;
        this.modal.querySelector("#dstLang").value = this.dstLang;
    }

    updateProgress(msg){
        if (this.modal) this.modal.querySelector(".modal-footer").innerText = DOMPurify.sanitize(msg, { USE_PROFILES: { html: true } });
    }

    getLocalizedLanguageName(lng){
        return this.mapLangs.get(lng);
    }

    isBuiltInEnabled() {
        return false;
    }

    isMochitest() {
        return false;
    }

    _onTranslationRequest(...params) {
        return true;
    }

    translate(){
        if ((this.modal.querySelector("#srcLang").value === this.modal.querySelector("#dstLang").value) || (
            this.modal.querySelector("#srcLang").value === "" || this.modal.querySelector("#dstLang").value === ""
        )){
            this.modal.querySelector("#srcLang").className = "control error";
            this.modal.querySelector("#dstLang").className = "control error";
            return;
        }
        this.modal.querySelector("#srcLang").className = "control";
        this.modal.querySelector("#dstLang").className = "control";
        this.modal.querySelector("#translateBtn").disabled = true;
        this.modal.querySelector("#srcLang").disabled = true;
        this.modal.querySelector("#dstLang").disabled = true;
        const message = {
            command: "translationRequested",
            from: this.modal.querySelector("#srcLang").value,
            to: this.modal.querySelector("#dstLang").value,
            withOutboundTranslation: false,
            withQualityEstimation: false,
            tabId: this.tabId
        };
        browser.runtime.sendMessage(message);
    }

    populateMapLangs(){
        const mapLangs = new Map();
        mapLangs.set("es","Spanish");
        mapLangs.set("et","Estonian");
        mapLangs.set("en","English");
        mapLangs.set("de","German");
        mapLangs.set("cs","Czech");
        mapLangs.set("bg","Bulgarian");
        mapLangs.set("pt","Portuguese");
        mapLangs.set("it","Italian");
        mapLangs.set("fr","French");
        mapLangs.set("pl","Polish");
        mapLangs.set("ru","Russian");
        mapLangs.set("fa","Persian (Farsi)");
        mapLangs.set("is","Icelandic");
        mapLangs.set("nn","Norwegian Nynorsk");
        mapLangs.set("nb","Norwegian Bokmål");
        mapLangs.set("uk","Ukrainian");
        mapLangs.set("nl","Dutch");
        return mapLangs;
    }
}