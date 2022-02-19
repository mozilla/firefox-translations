/* eslint-disable max-lines-per-function */
/*
 * this Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* global ExtensionAPI, ChromeUtils, modelRegistry, TranslationNotificationManager  */

 // eslint-disable-next-line no-invalid-this
 this.experiments_translationbar = class extends ExtensionAPI {
    getAPI(context) {

      let translationNotificationManager;
      const { ExtensionUtils } = ChromeUtils.import(
        "resource://gre/modules/ExtensionUtils.jsm",
        {},
      );
      const { ExtensionError } = ExtensionUtils;

      const { Services } = ChromeUtils.import(
        "resource://gre/modules/Services.jsm",
        {},
      );

      const { ExtensionCommon } = ChromeUtils.import(
        "resource://gre/modules/ExtensionCommon.jsm",
        {},
      );

      // map responsible holding the TranslationNotificationManager per tabid
      const translatonNotificationManagers = new Map();

      Services.scriptloader.loadSubScript(`${context.extension.getURL("/view/js/TranslationNotificationManager.js",)}?cachebuster=${Date.now()}`
      ,);
      Services.scriptloader.loadSubScript(`${context.extension.getURL("/model/modelRegistry.js",)}?cachebuster=${Date.now()}`
      ,);

      /*
       * variable responsible for holding a reference to the backgroundscript
       * event listener
       */
      let bgScriptListenerCallback = null;

      return {
        experiments: {
          translationbar: {
            show: function show(tabId, detectedLanguage, navigatorLanguage, localizedLabels) {
              try {

                // disable the legacy translation infobar
                Services.prefs.setBoolPref("browser.translation.ui.show", false);
                Services.prefs.setBoolPref(
                  "browser.translation.detectLanguage",
                  false,
                );

                const { tabManager } = context.extension;
                const tab = tabManager.get(tabId);
                const chromeWin = tab.browser.ownerGlobal;

                /*
                 * let's test if either this language or this page should not
                 * display the infobar
                 */
                const neverForLangs = Services.prefs.getCharPref("browser.translation.neverForLanguages",);
                const principal = tab.browser.contentPrincipal;
                if (neverForLangs.split(",").includes(detectedLanguage) ||
                    Services.perms.testExactPermissionFromPrincipal(principal, "translate") ===
                    Services.perms.DENY_ACTION) {
                      return;
                }

                /*
                 * as a workaround to be able to load updates for the translation notification on extension reload
                 * we use the current unix timestamp as part of the element id.
                 * TODO: Restrict use of Date.now() as cachebuster to development mode only
                 */
                chromeWin.now = Date.now();
                chromeWin.customElements.setElementCreationCallback(
                  `translation-notification-${chromeWin.now}`,
                  () => {
                    Services.scriptloader.loadSubScript(
                      `${context.extension.getURL("view/js/translation-notification-fxtranslations.js",)
                        }?cachebuster=${
                        chromeWin.now}`,
                      chromeWin,
                    );

                  },
                );

                const notificationBox = tab.browser.ownerGlobal.gBrowser.getNotificationBox(tab.browser);
                let notif = notificationBox.appendNotification("fxtranslation-notification", {
                    priority: notificationBox.PRIORITY_INFO_HIGH,
                    notificationIs: `translation-notification-${chromeWin.now}`,
                });
                translationNotificationManager = new TranslationNotificationManager(
                  this,
                  modelRegistry,
                  detectedLanguage
                );
                translationNotificationManager.navigatorLanguage = navigatorLanguage;
                translationNotificationManager.tabId = tabId;
                translationNotificationManager.bgScriptListenerCallback = bgScriptListenerCallback;
                translationNotificationManager.notificationBox = notif;
                translationNotificationManager.browser = tab.browser;
                translationNotificationManager.logoIcon = context.extension.getURL("/view/icons/translation.16x16.png",)
                translationNotificationManager.localizedLabels = localizedLabels;

                notif.init(translationNotificationManager);
                translatonNotificationManagers.set(tabId, translationNotificationManager);
              } catch (error) {
                // surface otherwise silent or obscurely reported errors
                console.error(error.message, error.stack);
                throw new ExtensionError(error.message);
              }
             },
            updateProgress: function updateProgress(tabId, progressMessage) {
              const translatonNotificationManager = translatonNotificationManagers.get(tabId);
              translatonNotificationManager.notificationBox.updateTranslationProgress(progressMessage);
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