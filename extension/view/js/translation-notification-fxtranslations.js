/* eslint-disable max-lines */
/* eslint-disable max-lines-per-function */
/*
 * this Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* global MozElements, Translation, Services */

window.MozTranslationNotification = class extends MozElements.Notification {
  static get markup() {
    return `
      <hbox anonid="details" align="center" flex="1">
        <image  anonid="logoIcon" class="messageImage"/>
        <deck anonid="translationStates" selectedIndex="0">
          <hbox class="translate-offer-box" align="center">
            <label value="&translation.thisPageIsIn.label;"/>
            <menulist class="notification-button" anonid="detectedLanguage" oncommand="this.closest('notification').fromLanguageChanged();">
              <menupopup/>
            </menulist>
            <label value="&translation.translateThisPage.label;"/>
            <button class="notification-button primary" label="&translation.translate.button;" anonid="translate" oncommand="this.closest('notification').translate();"/>
            <checkbox anonid="outboundtranslations-check" label="" style="padding-left:5px" oncommand="this.closest('notification').onOutboundClick();" />
            <checkbox anonid="qualityestimations-check" label="" style="padding-left:5px" oncommand="this.closest('notification').onQeClick();"/>
          </hbox>
          <vbox class="translating-box" pack="center">
            <hbox class="translate-offer-box" align="center">
              <label value="&translation.translatingContent.label;" style="display:none"/>
              <label anonid="progress-label" value="" style="padding-left:5px;"/>
              <button class="notification-button primary" label="" anonid="translateAsBrowse" oncommand="this.closest('notification').translateAsBrowse();"/>
            </hbox>
          </vbox>
        </deck>
        <spacer flex="1"/>
        <button class="notification-button" label="" anonid="survey" oncommand="this.closest('notification').onSurveyClick();"/>
        <button type="menu" class="notification-button" anonid="options" label="&translation.options.menu;">
          <menupopup class="translation-menupopup" onpopupshowing="this.closest('notification').optionsShowing();">
            <menuitem anonid="neverForLanguage" oncommand="this.closest('notification').neverForLanguage();"/>
            <menuitem anonid="neverForSite" oncommand="this.closest('notification').neverForSite();" label="&translation.options.neverForSite.label;" accesskey="&translation.options.neverForSite.accesskey;"/>
            <menuseparator/>
            <menuitem oncommand="openPreferences('paneGeneral');" label="&translation.options.preferences.label;" accesskey="&translation.options.preferences.accesskey;"/>
            <menuseparator/>
            <menuitem anonid="displayStatistics" oncommand="this.closest('notification').displayStatistics();" label=""/>
            </menupopup>
        </button>
      </hbox>
      <toolbarbutton anonid="closeButton" ondblclick="event.stopPropagation();"
                     class="messageCloseButton close-icon tabbable"
                     tooltiptext="&closeNotification.tooltip;"
                     oncommand="this.parentNode.closeCommand();"/>
    `;
  }

  static get entities() {
    return [
      "chrome://global/locale/notification.dtd",
      "chrome://browser/locale/translation.dtd",
    ];
  }

  updateTranslationProgress(localizedMessage) {
    this._getAnonElt("progress-label").setAttribute(
      "value",
      localizedMessage,
    );
  }

  set state(val) {
    const deck = this._getAnonElt("translationStates");

    const activeElt = document.activeElement;
    if (activeElt && deck.contains(activeElt)) {
      activeElt.blur();
    }

    let stateName;
    for (const name of ["OFFER", "TRANSLATING", "TRANSLATED", "ERROR"]) {
      if (Translation[`STATE_${name}`] === val) {
        stateName = name.toLowerCase();
        break;
      }
    }
    this.setAttribute("state", stateName);
    deck.selectedIndex = val;
  }

  get state() {
    return this._getAnonElt("translationStates").selectedIndex;
  }

  init(translationNotificationManager) {
    // set icon in the infobar. we should move this to a css file.
    this._getAnonElt("logoIcon").setAttribute("src", translationNotificationManager.logoIcon);
    this._getAnonElt("outboundtranslations-check").setAttribute("label", translationNotificationManager.localizedLabels.outboundTranslationsMessage);
    this._getAnonElt("qualityestimations-check").setAttribute("label", translationNotificationManager.localizedLabels.qualityEstimationMessage);
    this._getAnonElt("displayStatistics").setAttribute("label", translationNotificationManager.localizedLabels.displayStatisticsMessage);
    this._getAnonElt("survey").setAttribute("label", translationNotificationManager.localizedLabels.surveyMessage);
    this._getAnonElt("outboundtranslations-check").checked = translationNotificationManager.infobarSettings.outboundtranslations["outboundtranslations-check"];
    this._getAnonElt("qualityestimations-check").checked = translationNotificationManager.infobarSettings.qualityestimations["qualityestimations-check"];
    this._getAnonElt("translateAsBrowse").setAttribute("label", translationNotificationManager.localizedLabels.translateAsBrowseOn);

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

    // fill the list of supported target languages.
    const targetLanguages = sortByLocalizedName(this.translationNotificationManager.languageSet);
    for (const [code, name] of targetLanguages) {
      this.localizedLanguagesByCode[code] = name;
    }

    this.state = this.translationNotificationManager.TranslationInfoBarStates.STATE_OFFER;
    this.translationNotificationManager.reportInfobarMetric("event", "displayed");
    this.translationNotificationManager.reportInfobarMetric(
        "boolean", "outbound_enabled",
            this._getAnonElt("outboundtranslations-check").checked === true
        );
    this.translationNotificationManager.reportInfobarMetric(
        "boolean", "qe_enabled",
            this._getAnonElt("qualityestimations-check").checked === true
        );
    if (translationNotificationManager.autoTranslate) {
      this._getAnonElt("translateAsBrowse").setAttribute(
        "label",
        translationNotificationManager.localizedLabels.translateAsBrowseOff,
      );
      this.translate();
    }
  }

  _getAnonElt(anonId) {
    return this.querySelector(`[anonid=${anonId}]`);
  }

  fromLanguageChanged() {
    this.translationNotificationManager.reportInfobarMetric("event","change_lang");
    if (this._getAnonElt("detectedLanguage").value === "userrequest") {
      this._getAnonElt("translate").disabled = true;
    } else {
      this._getAnonElt("translate").disabled = false;
    }
  }

  translate() {
    this.translationNotificationManager.reportInfobarMetric("event","translate");
    const from = this._getSourceLang();
    const to = this._getTargetLang();
    this.translationNotificationManager.requestInPageTranslation(
        from,
        to,
        this._getAnonElt("outboundtranslations-check").checked,
        this._getAnonElt("qualityestimations-check").checked
    );
    this.state = this.translationNotificationManager.TranslationInfoBarStates.STATE_TRANSLATING;
    this._getAnonElt("closeButton").disabled = true;
    this._getAnonElt("options").disabled = true;
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
    this.translationNotificationManager.autoTranslate =
      !this.translationNotificationManager.autoTranslate
    this._getAnonElt("translateAsBrowse").setAttribute(
      "label",
      this.translationNotificationManager.autoTranslate
      ? this.translationNotificationManager.localizedLabels.translateAsBrowseOff
      : this.translationNotificationManager.localizedLabels.translateAsBrowseOn
    );
    this.translationNotificationManager.translateAsBrowse();
  }

  onSurveyClick() {
    this.translationNotificationManager.showSurvey();
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
    return this.translationNotificationManager.navigatorLanguage;
  }

  optionsShowing() {
    const lang = this._getSourceLang();

    // get the source language name.
    // eslint-disable-next-line no-undefined
    const langName = Services.intl.getLanguageDisplayNames(undefined, [lang,])[0];

    // set the label and accesskey on the menuitem.
    const bundle = Services.strings.createBundle("chrome://browser/locale/translation.properties",);
    let item = this._getAnonElt("neverForLanguage");
    const kStrId = "translation.options.neverForLanguage";
    item.setAttribute(
      "label",
      bundle.formatStringFromName(`${kStrId}.label`, [langName]),
    );
    item.setAttribute(
      "accesskey",
      // eslint-disable-next-line new-cap
      bundle.GetStringFromName(`${kStrId}.accesskey`),
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
    item.disabled =
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
    perms.addFromPrincipal(principal, "translate", perms.DENY_ACTION);
    this.closeCommand();
  }

  displayStatistics() {

    /*
     * let's notify the mediator that the user chose to see the statistics
     */
    this.translationNotificationManager.enableStats();
  }
};

customElements.define(
  `translation-notification-${window.now}`,
  window.MozTranslationNotification,
  {
    extends: "notification",
  },
);