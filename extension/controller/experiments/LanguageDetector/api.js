/* eslint-disable max-lines-per-function */
/*
 * this Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 */


 /* global ExtensionAPI, ChromeUtils */

// eslint-disable-next-line no-invalid-this
this.experiment_languageDetector = class extends ExtensionAPI {
  getAPI() {
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
              let lang = await LanguageDetector.detectLanguage(str);

              /*
               * language detector returns "no" for both Norwegian Nynorsk ("nn") and Norwegian Bokmål ("nb")
               * let's default to "nb", since we have a better model and
               * Bokmål is more popular in Norway, about 85-90 % of writing is done in Bokmål.
               */
              if (lang.language === "no") lang.language = "nb"

              return lang
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