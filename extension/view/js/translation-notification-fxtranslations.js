/* eslint-disable max-lines */
/* eslint-disable max-lines-per-function */
/*
 * this Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* global MozElements, Services */

window.MozTranslationNotification = class extends MozElements.Notification {
  static get markup() {
    return `
    <image anonid="logoIcon" class="messageImage"/>
    <description flex="1">
      <label anonid="lblSrcLng" style="display:none; vertical-align:top; margin-top:10px; margin-left:10px"></label>
      <image anonid="logoArrowFirst" style="display:none; vertical-align:top; margin-top:13px;" class="messageImage"/>
      <label anonid="lblTgtLng" style="display:none; vertical-align:top; margin-top:10px;"></label>
      <label style="vertical-align:top; margin-top:10px; margin-right:10px" anonid="labelTranslate"></label>
      <label anoind="ddlLanguage" style="vertical-align: middle;">
        <menulist anonid="detectedLanguage" oncommand="this.closest('notification').fromLanguageChanged();">
        </menulist>
      </label>
      <image anonid="logoArrow" style="vertical-align:top; margin-top:10px;" class="messageImage"/>
      <label anoind="ddlTgtLanguage" style="vertical-align: middle;">
        <menulist anonid="targetLanguage">
      </menulist>
    </label>
      <button class="notification-button primary" anonid="translate" oncommand="this.closest('notification').onTranslate();"/>
      <label anoind="cbOutbondTranslation" style="vertical-align: middle;">
        <checkbox anonid="outboundtranslations-check" label="" style="padding-left:5px" oncommand="this.closest('notification').onOutboundClick();" />
      </label>
      <label anoind="cbQualityEstimation" style="vertical-align: middle;">
        <checkbox anonid="qualityestimations-check" label="" style="padding-left:5px" oncommand="this.closest('notification').onQeClick();"/>
      </label>
      <label style="vertical-align: middle; float:right">
        <image anonid="logoRefresh" tooltiptext="" class="messageImage" style="display:none; vertical-align:bottom; cursor: pointer; tool" onclick="this.closest('notification').onRefresh();"/>
        <button class="notification-button" label="" anonid="translateAsBrowse" style="display:none;" oncommand="this.closest('notification').translateAsBrowse();"/>
        <button type="menu" class="notification-button" anonid="options">
          <menupopup class="translation-menupopup" onpopupshowing="this.closest('notification').optionsShowing();">
            <checkbox anonid="neverOfferTranslation" oncommand="this.closest('notification').neverOfferTranslation();"/>
            <checkbox anonid="neverForSite" oncommand="this.closest('notification').neverForSite();"/>
            <menuitem anonid="neverForLanguage" oncommand="this.closest('notification').neverForLanguage();"/>
            <menuseparator/>
            <menuitem anonid="optionsMenu" oncommand="openPreferences('paneGeneral-fxtranslations');"/>
            <menuitem anonid="displayStatistics" oncommand="this.closest('notification').displayStatistics();" label=""/>
            <menuitem anonid="openChangelog" oncommand="this.closest('notification').openChangelog();" label="Changelog"/>
            </menupopup>
        </button>
      </label>
    </description>
    <toolbarbutton anonid="closeButton" ondblclick="event.stopPropagation();"
    class="messageCloseButton close-icon"
    oncommand="this.parentNode.closeCommand();"/>
    `;
  }

  updateTranslationProgress(localizedMessage) {
    this._getAnonElt("labelTranslate").setAttribute("value", localizedMessage);
  }

  init(translationNotificationManager) {
    // set icon in the infobar. we should move this to a css file.
    this._getAnonElt("logoIcon").setAttribute("src", translationNotificationManager.logoIcon);
    this._getAnonElt("logoArrow").setAttribute("src", translationNotificationManager.logoArrow);
    this._getAnonElt("logoArrowFirst").setAttribute("src", translationNotificationManager.logoArrow);
    this._getAnonElt("logoRefresh").setAttribute("src", translationNotificationManager.logoRefresh);
    this._getAnonElt("labelTranslate").setAttribute("value", translationNotificationManager.localizedLabels.thisPageIsIn);
    this._getAnonElt("translate").setAttribute("label", translationNotificationManager.localizedLabels.translateButton);
    this._getAnonElt("options").setAttribute("label", translationNotificationManager.localizedLabels.optionsButton);
    this._getAnonElt("neverForSite").setAttribute("label", translationNotificationManager.localizedLabels.neverThisSiteLabel);
    this._getAnonElt("neverForSite").setAttribute("accesskey", translationNotificationManager.localizedLabels.neverThisSiteAccesskey);
    this._getAnonElt("optionsMenu").setAttribute("label", translationNotificationManager.localizedLabels.optionsMenuLabel);
    this._getAnonElt("optionsMenu").setAttribute("accesskey", translationNotificationManager.localizedLabels.optionsMenuAccesskey);
    this._getAnonElt("closeButton").setAttribute("tooltiptext", translationNotificationManager.localizedLabels.closeNotificationTooltip);
    this._getAnonElt("qualityestimations-check").setAttribute("label", translationNotificationManager.localizedLabels.qualityEstimationMessage);
    this._getAnonElt("displayStatistics").setAttribute("label", translationNotificationManager.localizedLabels.displayStatisticsMessage);
    this._getAnonElt("qualityestimations-check").checked = translationNotificationManager.infobarSettings.qualityestimations["qualityestimations-check"];
    this._getAnonElt("neverOfferTranslation").setAttribute("label", translationNotificationManager.localizedLabels.neverOfferTranslation);
    this._getAnonElt("neverOfferTranslation").checked = translationNotificationManager.infobarSettings.neverOfferTranslation["neverOfferTranslation-check"];

    this._getAnonElt("translateAsBrowse").setAttribute("label", translationNotificationManager.localizedLabels.translateAsBrowseOn);
    if (translationNotificationManager.otSupported) {
      this._getAnonElt("outboundtranslations-check").setAttribute("label", translationNotificationManager.localizedLabels.outboundTranslationsMessage);
      this._getAnonElt("outboundtranslations-check").checked = translationNotificationManager.infobarSettings.outboundtranslations["outboundtranslations-check"];
    } else {
      this._getAnonElt("outboundtranslations-check").style.display = "none";
    }

    this.translationNotificationManager = translationNotificationManager;
    this.localizedLanguagesByCode = {};

    const sortByLocalizedName = function(setOfLanguages) {
      const arrayOfLanguages = [...setOfLanguages];
      // eslint-disable-next-line no-undefined
      let names = Services.intl.getLanguageDisplayNames(undefined, arrayOfLanguages);

      return arrayOfLanguages
        .map((code, i) => [code, names[i]])
        .sort((a, b) => a[1].localeCompare(b[1]));
    }
    // fill the lists of supported source languages.
    const detectedLanguage = this._getAnonElt("detectedLanguage");
    const languagesSupported = sortByLocalizedName(this.translationNotificationManager.languageSet);

    if (this.translationNotificationManager.detectedLanguage === "userrequest") {
      detectedLanguage.appendItem(translationNotificationManager.localizedLabels.languageDefaultOption, "userrequest");
      this._getAnonElt("translate").disabled = true;
    }

    for (let [code, name] of languagesSupported) {
      if (this.translationNotificationManager.devLanguageSet.has(code)) {
            name += " (Beta)";
      }
      detectedLanguage.appendItem(name, code);
      this.localizedLanguagesByCode[code] = name;
    }
    detectedLanguage.value = translationNotificationManager.detectedLanguage;

    // fill the target language ddl
    const targetLanguage = this._getAnonElt("targetLanguage");
    for (let [code, name] of languagesSupported) {
      if (this.translationNotificationManager.devLanguageSet.has(code)) {
            name += " (Beta)";
      }
      targetLanguage.appendItem(name, code);
      this.localizedLanguagesByCode[code] = name;
    }
    targetLanguage.value = translationNotificationManager.navigatorLanguage;


    // fill the list of supported target languages.
    const targetLanguages = sortByLocalizedName(this.translationNotificationManager.languageSet);
    for (const [code, name] of targetLanguages) {
      this.localizedLanguagesByCode[code] = name;
    }

    this.translationNotificationManager.reportInfobarMetric("event", "displayed");
    this.translationNotificationManager.reportInfobarMetric(
        "boolean", "outbound_enabled",
            this._getAnonElt("outboundtranslations-check").checked === true
        );
    this.translationNotificationManager.reportInfobarMetric(
        "boolean", "qe_enabled",
            this._getAnonElt("qualityestimations-check").checked === true
        );
    this.translationNotificationManager.reportInfobarMetric(
      "boolean", "auto_translate_enabled",
      translationNotificationManager.autoTranslate?.translatingAsBrowse === true
    );

    if (translationNotificationManager.autoTranslate?.translatingAsBrowse) {
      this._getAnonElt("translateAsBrowse").setAttribute(
        "label",
        translationNotificationManager.localizedLabels.translateAsBrowseOff,
      );
      detectedLanguage.value = translationNotificationManager.autoTranslate?.sourceLanguage;
      targetLanguage.value = translationNotificationManager.autoTranslate?.targetLanguage;

      this.translate();
    }
  }

  _getAnonElt(anonId) {
    return this.querySelector(`[anonid=${anonId}]`);
  }

  fromLanguageChanged() {
    const from = this._getSourceLang();
    this.translationNotificationManager.reportMetric("string","metadata", "from_lang", from);
    this.translationNotificationManager.reportInfobarMetric("event","change_lang");

    if (this._getAnonElt("detectedLanguage").value === "userrequest") {
      this._getAnonElt("translate").disabled = true;
    } else {
      this._getAnonElt("translate").disabled = false;
    }
  }

  onTranslate() {
    this.translationNotificationManager.reportInfobarMetric("event", "translate");
    this.translate();
  }

  translate() {
    const from = this._getSourceLang();
    const to = this._getTargetLang();
    this._getAnonElt("lblSrcLng").style.display = "";
    this._getAnonElt("lblSrcLng").setAttribute(
      "value",
      this.localizedLanguagesByCode[this._getAnonElt("detectedLanguage").value]
    );
    this._getAnonElt("lblTgtLng").style.display = "";
    this._getAnonElt("lblTgtLng").setAttribute(
      "value",
      this.localizedLanguagesByCode[this._getAnonElt("targetLanguage").value]
    );
    this.translationNotificationManager.requestInPageTranslation(
        from,
        to,
        this._getAnonElt("outboundtranslations-check").checked,
        this._getAnonElt("qualityestimations-check").checked
    );
    this._getAnonElt("closeButton").style.display = "none";
    this._getAnonElt("displayStatistics").style.display = "none";
    this._getAnonElt("detectedLanguage").style.display = "none";
    this._getAnonElt("translate").style.display = "none";
    this._getAnonElt("outboundtranslations-check").style.display = "none";
    this._getAnonElt("qualityestimations-check").style.display = "none";
    this._getAnonElt("translate").style.display = "none";
    this._getAnonElt("translateAsBrowse").style.display = "";
    this._getAnonElt("logoRefresh").style.display = "";
    this._getAnonElt("logoRefresh").setAttribute(
      "tooltiptext",
      this.localizedLanguagesByCode[this._getAnonElt("detectedLanguage").value]
    );
    this._getAnonElt("targetLanguage").style.display = "none";
    this._getAnonElt("logoArrow").style.display = "none";
    this._getAnonElt("logoArrowFirst").style.display = "";

    this.updateTranslationProgress("");
  }

  onOutboundClick() {
    this.translationNotificationManager.setStorage(
      "outboundtranslations-check",
      this._getAnonElt("outboundtranslations-check").checked
    );
    if (this._getAnonElt("outboundtranslations-check").checked) {
      this.translationNotificationManager.reportInfobarMetric("event", "outbound_checked");
      this.translationNotificationManager.reportInfobarMetric("boolean", "outbound_enabled", true);
    } else {
      this.translationNotificationManager.reportInfobarMetric("event", "outbound_unchecked");
      this.translationNotificationManager.reportInfobarMetric("boolean", "outbound_enabled", false);
    }
  }

  onQeClick() {
    this.translationNotificationManager.setStorage(
      "qualityestimations-check",
      this._getAnonElt("qualityestimations-check").checked
    );
    if (this._getAnonElt("qualityestimations-check").checked) {
      this.translationNotificationManager.reportInfobarMetric("event","qe_checked");
      this.translationNotificationManager.reportInfobarMetric("boolean", "qe_enabled", true);
    } else {
      this.translationNotificationManager.reportInfobarMetric("event","qe_unchecked");
      this.translationNotificationManager.reportInfobarMetric("boolean", "qe_enabled", false);
    }
  }

  translateAsBrowse() {
    this.translationNotificationManager.autoTranslate.translatingAsBrowse =
      !this.translationNotificationManager.autoTranslate?.translatingAsBrowse;
    this.translationNotificationManager.autoTranslate.sourceLanguage = this._getAnonElt("detectedLanguage").value;
    this.translationNotificationManager.autoTranslate.targetLanguage = this._getAnonElt("targetLanguage").value;
    this._getAnonElt("translateAsBrowse").setAttribute(
      "label",
      this.translationNotificationManager.autoTranslate?.translatingAsBrowse
      ? this.translationNotificationManager.localizedLabels.translateAsBrowseOff
      : this.translationNotificationManager.localizedLabels.translateAsBrowseOn
    );
    this.translationNotificationManager.translateAsBrowse();
    if (this.translationNotificationManager.autoTranslate?.translatingAsBrowse) {
      this.translationNotificationManager.reportInfobarMetric("event","auto_translate_on");
      this.translationNotificationManager.reportInfobarMetric("boolean", "auto_translate_enabled", true);
    } else {
      this.translationNotificationManager.reportInfobarMetric("event","auto_translate_off");
      this.translationNotificationManager.reportInfobarMetric("boolean", "auto_translate_enabled", false);
    }
  }

  onSurveyClick() {
    const from = this._getSourceLang();
    const to = this._getTargetLang();
    this.translationNotificationManager.showSurvey(from, to);
  }

  /*
   * to be called when the infobar should be closed per user's wish (e.g.
   * by clicking the notification's close button, the not now button or choosing never to translate)
   */
  closeCommand() {
    this.translationNotificationManager.reportInfobarMetric("event","closed");
    this.close();
  }

  _getSourceLang() {
    const lang = this._getAnonElt("detectedLanguage").value;
    if (!lang) {
      throw new Error("Source language is not defined");
    }
    return lang;
  }

  _getTargetLang() {
    const lang = this._getAnonElt("targetLanguage").value;
    if (!lang) {
      throw new Error("Target language is not defined");
    }
    return lang;
  }

  optionsShowing() {
    const lang = this._getSourceLang();

    // get the source language name.
    // eslint-disable-next-line no-undefined
    const langName = Services.intl.getLanguageDisplayNames(undefined, [lang,])[0];

    // set the label and accesskey on the menuitem.

    let item = this._getAnonElt("neverForLanguage");
    let label = this.translationNotificationManager.localizedLabels.neverForLanguageLabel;

    item.setAttribute(
      "label",
      label.replace("%S", langName),
    );
    item.setAttribute(
      "accesskey",
      this.translationNotificationManager.localizedLabels.neverForLanguageAccesskey,
    );

    /*
     * we may need to disable the menuitems if they have already been used.
     * Check if translation is already disabled for this language:
     */
    const neverForLangs = Services.prefs.getCharPref("browser.translation.neverForLanguages",);
    item.disabled = neverForLangs.split(",").includes(lang);

    /*
     * if the infobar was displayed becuase of a manual pageAction, we don't
     * display this item
     */
    if (this.translationNotificationManager.detectedLanguage === "userrequest") {
      item.hidden = true;
    }

    // check if translation is disabled for the domain:
    const principal = this.translationNotificationManager.browser.contentPrincipal;
    const perms = Services.perms;
    item = this._getAnonElt("neverForSite");
    item.checked =
      perms.testExactPermissionFromPrincipal(principal, "translate") ===
      perms.DENY_ACTION;
  }

  neverForLanguage() {
    this.translationNotificationManager.reportInfobarMetric("event","never_translate_lang");
    const kPrefName = "browser.translation.neverForLanguages";
    const sourceLang = this._getSourceLang();

    let val = Services.prefs.getCharPref(kPrefName);
    if (val) {
      val += ",";
    }
    val += sourceLang;

    Services.prefs.setCharPref(kPrefName, val);

    this.closeCommand();
  }

  neverForSite() {
    this.translationNotificationManager.reportInfobarMetric("event","never_translate_site");
    const principal = this.translationNotificationManager.browser.contentPrincipal;
    const perms = Services.perms;
    const sitePermNotGranted =
      perms.testExactPermissionFromPrincipal(principal, "translate") ===
      perms.DENY_ACTION
    if (!sitePermNotGranted) {
      perms.addFromPrincipal(principal, "translate", perms.DENY_ACTION);
      this.closeCommand();
    } else {
      perms.addFromPrincipal(principal, "translate", perms.ALLOW_ACTION);
    }
  }

  neverOfferTranslation() {
    this.translationNotificationManager.setStorage(
      "neverOfferTranslation-check",
      this._getAnonElt("neverOfferTranslation").checked
    );
    if (this._getAnonElt("neverOfferTranslation").checked) this.closeCommand();
  }

  displayStatistics() {

    /*
     * let's notify the mediator that the user chose to see the statistics
     */
    this.translationNotificationManager.enableStats();
  }

  openChangelog() {
    this.translationNotificationManager.openChangelog();
  }

  onRefresh() {
    if (this.translationNotificationManager.autoTranslate.translatingAsBrowse) {
      this.translationNotificationManager.autoTranslate.translatingAsBrowse = false;
      this.translationNotificationManager.translateAsBrowse();
    }
    this.translationNotificationManager.onRefresh();
  }
};

customElements.define(
  window.TRANSLATION_NOTIFICATION_ELEMENT_ID,
  window.MozTranslationNotification,
  {
    extends: "notification",
  },
);