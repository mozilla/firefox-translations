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
            <hbox>
              <label value="&translation.translatingContent.label;" style="display:none"/>
              <label anonid="progress-label" value="" style="padding-left:5px"/>
              <label anonid="outboundtranslations-label" value="Enable translations of forms?" style="padding-left:5px"/>
              <button class="notification-button" label="Yes" anonid="outboundTranslation" style="padding-left:5px" oncommand="this.closest('notification').outboundTranslationAccept()"/>
            </hbox>
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
            <menuseparator/>
            <menuitem oncommand="this.closest('notification').displayStatistics();" label="Display Statistics"/>
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

  updateTranslationProgress(
    shouldShowTranslationProgress,
    localizedTranslationProgressText
  ) {
    if (localizedTranslationProgressText !== "outboundTranslationLoaded") {
      const progressLabelValue = shouldShowTranslationProgress
      ? localizedTranslationProgressText
      : "";
      this._getAnonElt("progress-label").setAttribute(
        "value",
        progressLabelValue,
      );
    }
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


    if (val === this.translationNotificationManager.TranslationInfoBarStates.STATE_TRANSLATED) {
      this._handleButtonHiding();
    }

    deck.selectedIndex = val;
  }

  get state() {
    return this._getAnonElt("translationStates").selectedIndex;
  }

  init(translationNotificationManager) {

    // set icon in the infobar. we should move this to a css file.
    this._getAnonElt("logoIcon").setAttribute("src", translationNotificationManager.logoIcon);

    this.translationNotificationManager = translationNotificationManager;
    this.localizedLanguagesByCode = {};

    const sortByLocalizedName = function(setOfLanguages) {
      const arrayOfLanguages = [...setOfLanguages];
      // eslint-disable-next-line no-undefined
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

    // fill the list of supported target languages.
    const targetLanguages = sortByLocalizedName(this.translationNotificationManager.languageSet);
    for (const [code, name] of targetLanguages) {
      this.localizedLanguagesByCode[code] = name;
    }

    this.state = this.translationNotificationManager.TranslationInfoBarStates.STATE_OFFER;
    this.translationNotificationManager.reportInfobarEvent("displayed");
  }

  _getAnonElt(anonId) {
    return this.querySelector(`[anonid=${anonId}]`);
  }

  fromLanguageChanged() {
    this.translationNotificationManager.reportInfobarEvent("change_lang");
    this.translation.fromLanguageChanged(
      this._getSourceLang(),
      this._getTargetLang(),
    );
    this.translate();
  }

  toLanguageChanged() {
    this.translationNotificationManager.reportInfobarEvent("change_lang");
    this.translation.toLanguageChanged(
      this._getSourceLang(),
      this._getTargetLang(),
    );
    this.translate();
  }

  translate() {
    this.translationNotificationManager.reportInfobarEvent("translate");
    const from = this._getSourceLang();
    const to = this._getTargetLang();
    this.translationNotificationManager.requestInPageTranslation(from, to);
    this.state = this.translationNotificationManager.TranslationInfoBarStates.STATE_TRANSLATING;

    /*
     * initiate translation
     * this.translation.translate(from, to);
     *
     * // Store the values used in the translation in the from and to inputs
     * if (
     * this.translation.uiState.infobarState ===
     * this.translation.TranslationInfoBarStates.STATE_OFFER
     * ) {
     * this._getAnonElt("fromLanguage").setAttribute(
     *  "value",
     *  this.localizedLanguagesByCode[from],
     * );
     * this._getAnonElt("toLanguage").setAttribute(
     *  "value",
     *  this.localizedLanguagesByCode[to],
     * );
     * }
     */
  }

  _close() {
    const from = this._getSourceLang();
    const to = this._getTargetLang();
    this.close();
    // todo: undefined
    // this.translation.infobarClosed(from, to);
  }

  /*
   * to be called when the infobar should be closed per user's wish (e.g.
   * by clicking the notification's close button, the not now button or choosing never to translate)
   */
  closeCommand() {
    this.translationNotificationManager.reportInfobarEvent("closed");
    this._close();
  }

  /*
   * to be called when the infobar should be closed per user's wish
   * by clicking the Not now button
   */
  notNow() {
    this.translationNotificationManager.reportInfobarEvent("not_now");
    this._close();
  }

  outboundTranslationAccept() {
    this.translationNotificationManager.reportInfobarEvent("accept_outbound");
    const from = this._getSourceLang();
    const to = this._getTargetLang();
    this.translationNotificationManager.requestOutboundTranslation(from, to);
    this._getAnonElt("outboundTranslation").setAttribute(
      "hidden",
      true,
    );
    this._getAnonElt("outboundtranslations-label").setAttribute(
      "hidden",
      true,
    );
    this.updateTranslationProgress(true, "Loading form translation");
  }

  _handleButtonHiding() {
    const originalShown = this.translation.uiState.originalShown;
    this._getAnonElt("showOriginal").hidden = originalShown;
    this._getAnonElt("showTranslation").hidden = !originalShown;
  }

  showOriginal() {
    this.translationNotificationManager.reportInfobarEvent("accept_outbound");
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

    // check if translation is disabled for the domain:
    const principal = this.translation.browser.contentPrincipal;
    const perms = Services.perms;
    item = this._getAnonElt("neverForSite");
    item.disabled =
      perms.testExactPermissionFromPrincipal(principal, "translate") ===
      perms.DENY_ACTION;
  }

  neverForLanguage() {
    this.translationNotificationManager.reportInfobarEvent("never_translate_lang");
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
    this.translationNotificationManager.reportInfobarEvent("never_translate_site");
    const principal = this.translation.browser.contentPrincipal;
    const perms = Services.perms;
    perms.addFromPrincipal(principal, "translate", perms.DENY_ACTION);

    this.translation.neverForSite(this._getSourceLang(), this._getTargetLang());
    this.closeCommand();
  }

  displayStatistics() {

    /*
     * let's notify the mediator that the user chose to see the statistics
     * console.log({ data: `here ${0} - ${1}` });
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