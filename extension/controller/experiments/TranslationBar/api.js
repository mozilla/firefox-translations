/* eslint-disable max-lines-per-function */
/*
 * this Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */

/* global ExtensionAPI, ExtensionCommon, Services */


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

      const { EventManager, EventEmitter } = ExtensionCommon;
      const apiEventEmitter = new EventEmitter();

      // map responsible holding the TranslationNotificationManager per tabid
      const translatonNotificationManagers = new Map();

      Services.scriptloader.loadSubScript(
        `${context.extension.getURL("/view/js/TranslationNotificationManager.js",)}?cachebuster=${Date.now()}`
      ,);
      Services.scriptloader.loadSubScript(
        `${context.extension.getURL("/model/modelRegistry.js",)}?cachebuster=${Date.now()}`
      ,);

      // variable responsible for holding a reference to the backgroundscript
      // event listener
      let bgScriptListenerCallback = null;

      return {
        experiments: {
          translationbar: {
            show: function show(tabid, detectedLanguage, navigatorLanguage) {
              try {
                const { tabManager } = context.extension;
                const tab = tabManager.get(tabid);
                const chromeWin = tab.browser.ownerGlobal;

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
                let notif = notificationBox.appendNotification(`translation-notification-${chromeWin.now}`, {
                    priority: notificationBox.PRIORITY_INFO_HIGH,
                    notificationIs: `translation-notification-${chromeWin.now}`,
                });
                translationNotificationManager = new TranslationNotificationManager(
                  this,
                  modelRegistry,
                  detectedLanguage,
                  navigatorLanguage,
                  tabid,
                  bgScriptListenerCallback,
                  notif
                );
                notif.init(translationNotificationManager);
                translatonNotificationManagers.set(tabid, translationNotificationManager);
              } catch (error) {
                // surface otherwise silent or obscurely reported errors
                console.error(error.message, error.stack);
                throw new ExtensionError(error.message);
              }
             },
            updateProgress: function updateProgress(tabid, progressMessage) {
              console.log({ data: "updateProgress na api", tabid, progressMessage });
              const translatonNotificationManager = translatonNotificationManagers.get(tabid);
              translatonNotificationManager.notificationBox.updateTranslationProgress(true, progressMessage);
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