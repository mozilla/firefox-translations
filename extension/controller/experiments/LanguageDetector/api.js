/* eslint-disable max-lines-per-function */
/*
 * this Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */


 /* global ExtensionAPI, ExtensionCommon */

this.experiment_languageDetector = class extends ExtensionAPI {
  getAPI(context) {
    const { LanguageDetector } = ChromeUtils.import(
      "resource:///modules/translation/LanguageDetector.jsm",
      {},
    );

    const { ExtensionUtils } = ChromeUtils.import(
      "resource://gre/modules/ExtensionUtils.jsm",
      {},
    );
    const { ExtensionError } = ExtensionUtils;

    return {
      experiments: {
        languageDetector: {
          detect: async function detect(str) {
            try {
              return await LanguageDetector.detectLanguage(str);
            } catch (error) {
              // surface otherwise silent or obscurely reported errors
              console.error(error.message, error.stack);
              throw new ExtensionError(error.message);
            }
           },
        },
      },
    };
  }
};