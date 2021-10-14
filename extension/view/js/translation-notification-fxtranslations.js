/* eslint-disable max-lines-per-function */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global MozElements */

"use strict";

window.MozTranslationNotification = class extends MozElements.Notification {
  static get markup() {
    return `
      <hbox anonid="details" align="center" flex="1">
        <image class="messageImage"/>
        <panel anonid="welcomePanel" class="translation-welcome-panel" type="arrow" align="start">
          <image class="translation-welcome-logo"/>
          <vbox flex="1" class="translation-welcome-content">
            <description class="translation-welcome-headline" anonid="welcomeHeadline"/>
            <description class="translation-welcome-body" anonid="welcomeBody"/>
            <hbox align="center">
              <label anonid="learnMore" class="plain" onclick="openTrustedLinkIn('https://support.mozilla.org/kb/automatic-translation', 'tab'); this.parentNode.parentNode.parentNode.hidePopup();" is="text-link"/>
              <spacer flex="1"/>
              <button anonid="thanksButton" onclick="this.parentNode.parentNode.parentNode.hidePopup();"/>
            </hbox>
          </vbox>
        </panel>
        <deck anonid="translationStates" selectedIndex="0">
          <hbox class="translate-offer-box" align="center">
            <label value="&translation.thisPageIsIn.label;"/>
            <menulist class="notification-button" anonid="detectedLanguage">
              <menupopup/>
            </menulist>
            <label value="&translation.translateThisPage.label;"/>
            <button class="notification-button primary" label="&translation.translate.button;" anonid="translate" oncommand="this.closest('notification').translate();"/>
            <button class="notification-button" label="&translation.notNow.button;" anonid="notNow" oncommand="this.closest('notification').notNow();"/>
          </hbox>
          <vbox class="translating-box" pack="center">
            <hbox><label value="&translation.translatingContent.label;"/><label anonid="progress-label" value=""/></hbox>
          </vbox>
          <hbox class="translated-box" align="center">
            <label value="&translation.translatedFrom.label;" style="margin-inline-end: 4px;"/>
            <label anonid="fromLanguage" style="margin-inline:0;font-weight: bold;"/>
            <label value="&translation.translatedTo.label;" style="margin-inline:3px;"/>
            <label anonid="toLanguage" style="margin-inline:0;font-weight: bold;"/>
            <label value="&translation.translatedToSuffix.label;"/>
            <button anonid="showOriginal" class="notification-button" label="&translation.showOriginal.button;" oncommand="this.closest('notification').showOriginal();"/>
            <button anonid="showTranslation" class="notification-button" label="&translation.showTranslation.button;" oncommand="this.closest('notification').showTranslation();"/>
          </hbox>
          <hbox class="translation-error" align="center">
            <label value="&translation.errorTranslating.label;"/>
            <button class="notification-button" label="&translation.tryAgain.button;" anonid="tryAgain" oncommand="this.closest('notification').translate();"/>
          </hbox>
          <vbox class="translation-unavailable" pack="center">
            <label value="&translation.serviceUnavailable.label;"/>
          </vbox>
        </deck>
        <spacer flex="1"/>
        <button type="menu" class="notification-button" anonid="options" label="&translation.options.menu;">
          <menupopup class="translation-menupopup" onpopupshowing="this.closest('notification').optionsShowing();">
            <menuitem anonid="neverForLanguage" oncommand="this.closest('notification').neverForLanguage();"/>
            <menuitem anonid="neverForSite" oncommand="this.closest('notification').neverForSite();" label="&translation.options.neverForSite.label;" accesskey="&translation.options.neverForSite.accesskey;"/>
            <menuseparator/>
            <menuitem oncommand="openPreferences('paneGeneral');" label="&translation.options.preferences.label;" accesskey="&translation.options.preferences.accesskey;"/>
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

  connectedCallback() {
    this.appendChild(this.constructor.fragment);

    for (const [propertyName, selector] of [
      ["details", "[anonid=details]"],
      ["messageImage", ".messageImage"],
      ["spacer", "[anonid=spacer]"],
    ]) {
      this[propertyName] = this.querySelector(selector);
    }
  }

  async updateTranslationProgress(
    shouldShowTranslationProgress,
    localizedTranslationProgressText,
  ) {
    const progressLabelValue = shouldShowTranslationProgress
      ? localizedTranslationProgressText
      : "";
    this._getAnonElt("progress-label").setAttribute(
      "value",
      progressLabelValue,
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
      if (Translation["STATE_" + name] === val) {
        stateName = name.toLowerCase();
        break;
      }
    }
    this.setAttribute("state", stateName);


    if (val === this.translationNotificationManager.TranslationInfoBarStates.STATE_TRANSLATED) {
      this._handleButtonHiding();
    }

    deck.selectedIndex = val;
  }

  get state() {
    return this._getAnonElt("translationStates").selectedIndex;
  }

  init(translationNotificationManager) {
    this.translationNotificationManager = translationNotificationManager;
    this.localizedLanguagesByCode = {};

    const sortByLocalizedName = function(setOfLanguages) {
      const arrayOfLanguages = [...setOfLanguages];
      const names = Services.intl.getLanguageDisplayNames(undefined, arrayOfLanguages);
      return arrayOfLanguages
        .map((code, i) => [code, names[i]])
        .sort((a, b) => a[1].localeCompare(b[1]));
    }
    // fill the lists of supported source languages.
    const detectedLanguage = this._getAnonElt("detectedLanguage");
    const languagesSupported = sortByLocalizedName(this.translationNotificationManager.languageSet);

    for (const [code, name] of languagesSupported) {
      detectedLanguage.appendItem(name, code);
      this.localizedLanguagesByCode[code] = name;
    }
    detectedLanguage.value = translationNotificationManager.detectedLanguage;

    // Fill the list of supported target languages.
    const toLanguage = this._getAnonElt("toLanguage");
    const targetLanguages = sortByLocalizedName(this.translationNotificationManager.languageSet);
    for (const [code, name] of targetLanguages) {
      this.localizedLanguagesByCode[code] = name;
    }

    this.state = this.translationNotificationManager.TranslationInfoBarStates.STATE_OFFER;
  }

  _getAnonElt(anonId) {
    return this.querySelector("[anonid=" + anonId + "]");
  }

  fromLanguageChanged() {
    this.translation.fromLanguageChanged(
      this._getSourceLang(),
      this._getTargetLang(),
    );
    this.translate();
  }

  toLanguageChanged() {
    this.translation.toLanguageChanged(
      this._getSourceLang(),
      this._getTargetLang(),
    );
    this.translate();
  }

  translate() {
    const from = this._getSourceLang();
    const to = this._getTargetLang();
    this.translationNotificationManager.requestTranslation(from, to);
    this.state = this.translationNotificationManager.TranslationInfoBarStates.STATE_TRANSLATING;

    /*


    // Initiate translation
    this.translation.translate(from, to);

    // Store the values used in the translation in the from and to inputs
    if (
      this.translation.uiState.infobarState ===
      this.translation.TranslationInfoBarStates.STATE_OFFER
    ) {
      this._getAnonElt("fromLanguage").setAttribute(
        "value",
        this.localizedLanguagesByCode[from],
      );
      this._getAnonElt("toLanguage").setAttribute(
        "value",
        this.localizedLanguagesByCode[to],
      );
    } */
  }

  /**
   * To be called when the infobar should be closed per user's wish (e.g.
   * by clicking the notification's close button, the not now button or choosing never to translate)
   */
  closeCommand() {
    const from = this._getSourceLang();
    const to = this._getTargetLang();
    this.close();
    this.translation.infobarClosed(from, to);
  }

  /**
   * To be called when the infobar should be closed per user's wish
   * by clicking the Not now button
   */
  notNow() {
    this.closeCommand();
  }

  _handleButtonHiding() {
    const originalShown = this.translation.uiState.originalShown;
    this._getAnonElt("showOriginal").hidden = originalShown;
    this._getAnonElt("showTranslation").hidden = !originalShown;
  }

  showOriginal() {
    this.translation.showOriginalContent(
      this._getSourceLang(),
      this._getTargetLang(),
    );
    this._handleButtonHiding();
  }

  showTranslation() {
    this.translation.showTranslatedContent(
      this._getSourceLang(),
      this._getTargetLang(),
    );
    this._handleButtonHiding();
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

    // Get the source language name.
    const langName = Services.intl.getLanguageDisplayNames(undefined, [
      lang,
    ])[0];

    // Set the label and accesskey on the menuitem.
    const bundle = Services.strings.createBundle(
      "chrome://browser/locale/translation.properties",
    );
    let item = this._getAnonElt("neverForLanguage");
    const kStrId = "translation.options.neverForLanguage";
    item.setAttribute(
      "label",
      bundle.formatStringFromName(kStrId + ".label", [langName]),
    );
    item.setAttribute(
      "accesskey",
      bundle.GetStringFromName(kStrId + ".accesskey"),
    );

    // We may need to disable the menuitems if they have already been used.
    // Check if translation is already disabled for this language:
    const neverForLangs = Services.prefs.getCharPref(
      "browser.translation.neverForLanguages",
    );
    item.disabled = neverForLangs.split(",").includes(lang);

    // Check if translation is disabled for the domain:
    const principal = this.translation.browser.contentPrincipal;
    const perms = Services.perms;
    item = this._getAnonElt("neverForSite");
    item.disabled =
      perms.testExactPermissionFromPrincipal(principal, "translate") ===
      perms.DENY_ACTION;
  }

  neverForLanguage() {
    const kPrefName = "browser.translation.neverForLanguages";
    const sourceLang = this._getSourceLang();

    let val = Services.prefs.getCharPref(kPrefName);
    if (val) {
      val += ",";
    }
    val += sourceLang;

    Services.prefs.setCharPref(kPrefName, val);

    this.translation.neverForLanguage(
      this._getSourceLang(),
      this._getTargetLang(),
    );
    this.closeCommand();
  }

  neverForSite() {
    const principal = this.translation.browser.contentPrincipal;
    const perms = Services.perms;
    perms.addFromPrincipal(principal, "translate", perms.DENY_ACTION);

    this.translation.neverForSite(this._getSourceLang(), this._getTargetLang());
    this.closeCommand();
  }
};

customElements.define(
  `translation-notification-${window.now}`,
  window.MozTranslationNotification,
  {
    extends: "notification",
  },
);
