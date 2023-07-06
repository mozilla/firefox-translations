/* eslint-disable max-lines-per-function */
/*
 * this Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* global ExtensionCommon, ExtensionAPI, ChromeUtils, Services, modelRegistry, TranslationNotificationManager  */

/*
 * custom elements can only be registered, and not unregistered.
 * To make sure that the extension is able to register the custom element
 * even after an extension update/reload, use a generated unique name.
 */
const TRANSLATION_NOTIFICATION_ELEMENT_ID = `translation-notification-${Date.now()}`;
const windowsWithCustomElement = new WeakSet();

// original value of prefs to restore on normal shutdown (won't work if the browser crashes).
const prefsToRestore = new Map();

// map responsible holding the TranslationNotificationManager per tabid
const translationNotificationManagers = new Map();

 // eslint-disable-next-line no-invalid-this
 this.experiments_translationbar = class extends ExtensionAPI {
    onStartup() {
      // as soon we load, we should turn off the legacy prefs to avoid UI conflicts

      // sets a bool pref whose original value is restored on shutdown.
      const setBoolPref = (prefName, value) => {
        let oldValue;
        let prefType = Services.prefs.getPrefType(prefName);
        if (prefType === Services.prefs.PREF_BOOL) {
          oldValue = Services.prefs.getBoolPref(prefName);
        } else if (prefType !== Services.prefs.PREF_INVALID) {
          // the PREF_INT and PREF_STRING types are not expected, so let's ignore them.
          console.error(`Ignoring unexpected pref type for ${prefName} (${prefType})`);
        }
        prefsToRestore.set(prefName, oldValue);
        Services.prefs.setBoolPref(prefName, value);
      };
      setBoolPref("browser.translation.ui.show", false);
      setBoolPref("extensions.translations.disabled", false);
      setBoolPref("browser.translation.detectLanguage", false);
    }

    onShutdown(isAppShutdown) {
      for (let [prefName, oldValue] of prefsToRestore) {
        if (typeof oldValue === "boolean") {
          Services.prefs.setBoolPref(prefName, oldValue);
        } else {
          Services.prefs.clearUserPref(prefName);
        }
      }
      if (isAppShutdown) {
        // don't bother with cleaning up the UI if the browser is shutting down.
        return;
      }

      // the bars aren't automatically removed upon extension shutdown, do that here.
      for (let translationNotificationManager of translationNotificationManagers.values()) {
        translationNotificationManager.notificationBox.close();
      }
    }

    getAPI(context) {

      const { extension } = context;
      // ignore the cached scripts if either updateReason is defined or startupReason is set to upgrade or downgrade.
      const ignoreCache = Boolean(extension.updateReason) ||
        ["ADDON_UPGRADE", "ADDON_DOWNGRADE"].includes(extension.startupReadon)

      const { ExtensionUtils } = ChromeUtils.import("resource://gre/modules/ExtensionUtils.jsm");
      const { ExtensionError } = ExtensionUtils;
      Services.scriptloader.loadSubScriptWithOptions(
        `${context.extension.getURL("/view/js/TranslationNotificationManager.js",)}`,
        { ignoreCache }
      );
      Services.scriptloader.loadSubScriptWithOptions(
        `${context.extension.getURL("/model/modelRegistry.js",)}`,
        { ignoreCache }
      );

      /*
       * variable responsible for holding a reference to the backgroundscript
       * event listener
       */
      let bgScriptListenerCallback = null;

      return {
        experiments: {
          translationbar: {
            isBuiltInEnabled: function isBuiltInEnabled() {
              return Services.prefs.getBoolPref("browser.translations.enable", false);
            },
            show: function show(tabId, detectedLanguage, navigatorLanguage, localizedLabels, pageActionRequest, infobarSettings, autoTranslate, otSupported) {
              try {

                const { tabManager } = context.extension;
                const tab = tabManager.get(tabId);
                const chromeWin = tab.browser.ownerGlobal;

                // if an infobar is already being displayed, we ignore the request
                if (pageActionRequest && translationNotificationManagers.has(tabId)) {
                  return;
                } else if (!pageActionRequest) {

                /*
                 * let's test if either this language or this page should not
                 * display the infobar, but only if the user hasn't manually
                 * summoned the infobar
                 */
                  const neverForLangs = Services.prefs.getCharPref("browser.translation.neverForLanguages",);
                  const principal = tab.browser.contentPrincipal;
                  if (neverForLangs.split(",").includes(detectedLanguage) ||
                      Services.perms.testExactPermissionFromPrincipal(principal, "translate") ===
                      Services.perms.DENY_ACTION) {
                        return;
                  }
                }

                if (translationNotificationManagers.has(tabId)) {
                  return;
                }

                if (!windowsWithCustomElement.has(chromeWin)) {
                  windowsWithCustomElement.add(chromeWin);
                  chromeWin.TRANSLATION_NOTIFICATION_ELEMENT_ID = TRANSLATION_NOTIFICATION_ELEMENT_ID;
                  Services.scriptloader.loadSubScriptWithOptions(
                    context.extension.getURL("view/js/translation-notification-fxtranslations.js"),
                    {
                      target: chromeWin,
                      ignoreCache
                    }
                  );
                }

                const notificationBox = tab.browser.ownerGlobal.gBrowser.getNotificationBox(tab.browser);
                let notif = null;

                /*
                 * we need to check if the notificationBox.appendNotification
                 * requires 7 positional arguments and instantiate it differently
                 * in order to keep it compatible with older Fx versions
                 * see: https://github.com/mozilla/firefox-translations/issues/363#issuecomment-1151022189
                 */
                const notificationId = "fxtranslation-notification";
                const priority = notificationBox.PRIORITY_INFO_HIGH;
                const eventCallback = () => {
                  // removed / dismissed / disconnected in any way.
                  translationNotificationManagers.delete(tabId);
                  // ^ may also happen when the tab is navigated.
                 };
                const notificationIs = TRANSLATION_NOTIFICATION_ELEMENT_ID;

                if (notificationBox.appendNotification.length === 7) {
                  // firefox 93 and earlier
                  notif = notificationBox.appendNotification(
                    null,
                    notificationId,
                    null,
                    priority,
                    null,
                    eventCallback,
                    notificationIs
                  );
                } else {
                  // firefox 94 and later
                  notif = notificationBox.appendNotification(notificationId, {
                    priority,
                    eventCallback,
                    notificationIs,
                  });
                }

                let translationNotificationManager = new TranslationNotificationManager(
                  this,
                  modelRegistry,
                  detectedLanguage,
                  navigatorLanguage
                );
                translationNotificationManager.tabId = tabId;
                translationNotificationManager.bgScriptListenerCallback = bgScriptListenerCallback;
                translationNotificationManager.notificationBox = notif;
                translationNotificationManager.browser = tab.browser;
                translationNotificationManager.logoIcon = context.extension.getURL("/view/icons/translation-color.svg",)
                translationNotificationManager.logoArrow = context.extension.getURL("/view/icons/arrow.svg",)
                translationNotificationManager.localizedLabels = localizedLabels;
                translationNotificationManager.infobarSettings = infobarSettings;
                translationNotificationManager.autoTranslate = autoTranslate;
                translationNotificationManager.otSupported = otSupported;
                translationNotificationManager.logoRefresh = context.extension.getURL("/view/icons/refresh.svg",)

                notif.init(translationNotificationManager);
                translationNotificationManagers.set(tabId, translationNotificationManager);
              } catch (error) {
                // surface otherwise silent or obscurely reported errors
                console.error(error.message, error.stack);
                throw new ExtensionError(error.message);
              }
            },
            updateProgress: function updateProgress(tabId, progressMessage) {
              const translatonNotificationManager = translationNotificationManagers.get(tabId);
              translatonNotificationManager.notificationBox.updateTranslationProgress(progressMessage);
            },
            getLocalizedLanguageName: function getLocalizedLanguageName(languageCode){
              // eslint-disable-next-line no-undefined
              return Services.intl.getLanguageDisplayNames(undefined, [languageCode,])[0];
            },
            isMochitest: function isMochitest() {
              const isMochitest = Services.prefs.getBoolPref("fxtranslations.running.mochitest", false);
              return isMochitest;
            },
            onDetached: function onDetached(tabId) {
              translationNotificationManagers.delete(tabId);
            },
           onTranslationRequest: new ExtensionCommon.EventManager({
              context,
              name: "experiments.translationbar.onTranslationRequest",
              register: fire => {
                const callback = value => {
                  fire.async(value);
                };
                bgScriptListenerCallback = callback;
                return () => {
                  bgScriptListenerCallback = null;
                };
              },
            }).api(),
          },
        },
      };
    }
  };