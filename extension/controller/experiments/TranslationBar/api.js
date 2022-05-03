/* eslint-disable max-lines-per-function */
/*
 * this Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* global ExtensionAPI, ChromeUtils, modelRegistry, TranslationNotificationManager  */

/*
 * custom elements can only be registered, and not unregistered.
 * To make sure that the extension is able to register the custom element
 * even after an extension update/reload, use a generated unique name.
 */
const TRANSLATION_NOTIFICATION_ELEMENT_ID = `translation-notification-${Date.now()}`;
const windowsWithCustomElement = new WeakSet();


// map responsible holding the TranslationNotificationManager per tabid
const translationNotificationManagers = new Map();

 // eslint-disable-next-line no-invalid-this
 this.experiments_translationbar = class extends ExtensionAPI {
    onShutdown(isAppShutdown) {
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

      const { ExtensionUtils } = ChromeUtils.import("resource://gre/modules/ExtensionUtils.jsm");
      const { ExtensionError } = ExtensionUtils;

      const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

      const { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");

      Services.scriptloader.loadSubScript(`${context.extension.getURL("/view/js/TranslationNotificationManager.js",)}`
      ,);
      Services.scriptloader.loadSubScript(`${context.extension.getURL("/model/modelRegistry.js",)}`
      ,);

      /*
       * variable responsible for holding a reference to the backgroundscript
       * event listener
       */
      let bgScriptListenerCallback = null;

      return {
        experiments: {
          translationbar: {
            show: function show(tabId, detectedLanguage, navigatorLanguage, localizedLabels, pageActionRequest, infobarSettings, autoTranslate) {
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
                  Services.scriptloader.loadSubScript(
                    context.extension.getURL("view/js/translation-notification-fxtranslations.js"),
                    chromeWin
                  );
                }

                const notificationBox = tab.browser.ownerGlobal.gBrowser.getNotificationBox(tab.browser);
                let notif = notificationBox.appendNotification("fxtranslation-notification", {
                    priority: notificationBox.PRIORITY_INFO_HIGH,
                    eventCallback() {
                      // removed / dismissed / disconnected in any way.
                      translationNotificationManagers.delete(tabId);
                      // ^ may also happen when the tab is navigated.
                    },
                    notificationIs: TRANSLATION_NOTIFICATION_ELEMENT_ID,
                });
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
                translationNotificationManager.logoIcon = context.extension.getURL("/view/icons/translation.16x16.png",)
                translationNotificationManager.localizedLabels = localizedLabels;
                translationNotificationManager.infobarSettings = infobarSettings;
                translationNotificationManager.autoTranslate = autoTranslate;

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
            switchOnPreferences: function switchOnPreferences() {
               const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
               Services.prefs.setBoolPref("browser.translation.ui.show", false);
               Services.prefs.setBoolPref("extensions.translations.disabled", false);
               Services.prefs.setBoolPref("browser.translation.detectLanguage",false,);
               Services.prefs.setBoolPref("javascript.options.wasm_simd_wormhole",true,);
            },
            getLocalizedLanguageName: function getLocalizedLanguageName(languageCode){
              // eslint-disable-next-line no-undefined
              return Services.intl.getLanguageDisplayNames(undefined, [languageCode,])[0];
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