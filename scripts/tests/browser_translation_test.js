/* eslint-disable prefer-reflect */
/* eslint-disable no-undef */
/* eslint-disable max-lines-per-function */

requestLongerTimeout(4);

const baseURL = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com"
);

add_task(async function testTranslationBarNotDisplayed() {
  info("Test the Translation functionality when the built-in version is enabled");

  if (!Services.prefs.getBoolPref("browser.translations.enable", false)) {
    ok(true, "Built-in version is disabled, skipping test.");
    return;
  }

  info("Waiting 10s until the engines are loaded");
  // let's wait until the engines are loaded
  await new Promise(resolve => setTimeout(resolve, 10000));

  info("Opening the test page");

  // open the test page.
  let tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${baseURL }browser_translation_test.html`
  );

  // wait for the translation bar to be displayed.
  let neverShown = false;
  await TestUtils.waitForCondition(() => gBrowser
      .getNotificationBox()
      .getNotificationWithValue("fxtranslation-notification"))
      .catch(() => {
        neverShown = true;
      });
  ok(neverShown, "Translation notification bar was not displayed.");

  BrowserTestUtils.removeTab(tab);
});

add_task(async function testTranslationBarDisplayed() {
  info("Test the Translation functionality when the built-in version is disabled");

  if (Services.prefs.getBoolPref("browser.translations.enable", false)) {
    ok(true, "Built-in version is enabled, skipping test.");
    return;
  }

  info("Waiting 10s until the engines are loaded");
  // let's wait until the engines are loaded
  await new Promise(resolve => setTimeout(resolve, 10000));

  info("Opening the test page");

  // open the test page.
  let tab = await BrowserTestUtils.openNewForegroundTab(
    gBrowser,
    `${baseURL }browser_translation_test.html`
  );

  // wait for the translation bar to be displayed.
  let notification = await TestUtils.waitForCondition(() => gBrowser
      .getNotificationBox()
      .getNotificationWithValue("fxtranslation-notification"));
  ok(notification, "Translation notification bar was displayed.");

  // let's make sure the selected language in the bar matches the page
  const languageDropdown = notification.querySelector("[anonid=detectedLanguage]");
  const selectedLanguage = languageDropdown.selectedItem.textContent;
  is(selectedLanguage, "Spanish", "Detected language is in spanish");

  // now that the bar was displayed, let's select the form translation and quality estimation checkboxes
  notification.querySelector("[anonid=outboundtranslations-check]").checked = true;
  notification.querySelector("[anonid=qualityestimations-check]").checked = true;
  // and push the button to translate
  let translateButton = notification.querySelector("[anonid=translate]");
  translateButton.click();

  // we wait until the models and engine are loaded
  await TestUtils.waitForCondition(
    () => {
      return (
        notification.querySelector("[anonid=labelTranslate]").getAttribute("value")
           .includes("Automatic Translation enabled")
      );
    },
    "Translation was properly started.",
    5000,
    200
  );

  // check if the translation happened
  await SpecialPowers.spawn(gBrowser.selectedBrowser, [], async () => {
    const checkTranslation = async (document, message) => {
      // check for the translated content
      is(
        document.getElementById("translationDiv").innerText,
        "Hello world. That's a test of translation tests.",
        `Text was correctly translated. (${message})`
      );

      /*
       * let's now select the outbound translation form
       * await SpecialPowers.spawn(gBrowser.selectedBrowser, [], async () => {
       */
       document.getElementById("mainTextarea").focus();
       document.getElementById("OTapp").querySelectorAll("textarea")[0].value = "Hello World";
       document.getElementById("OTapp").querySelectorAll("textarea")[0].dispatchEvent(new content.KeyboardEvent("keydown", { "key": "Enter" }));
       await new Promise(resolve => content.setTimeout(resolve, 5000));

       is(
         document.getElementById("mainTextarea").value.trim(),
         "Hola Mundo",
         `Form translation text was correctly translated. (${message})`
       );

       is(
         document.getElementById("OTapp").querySelectorAll("textarea")[1].value.trim(),
         "Hello World",
         `Back Translation text was correctly translated. (${message})`
       );
    }

    // check quality estimation
    const checkQualityEstimation = async (document, message) => {
      const translation = document.getElementById("translationDiv").innerText;
      const translatedHTMLWithQEScores = document.getElementById("translationDiv").innerHTML;

      // just check for the translated content before checking quality estimation
      is(
        translation,
        "Hello world. That's a test of translation tests.",
        `Text was correctly translated. (${message})`
      );

      // check if number of sentences and the number of sentence score attributes match in the translation
      let sentenceCount = translation.match(/\w\s*([.?!]|$)/g).length;
      let sentenceScoreAttributeCount = (translatedHTMLWithQEScores.match(/x-bergamot-sentence-score/g) || []).length;
      is(
        sentenceScoreAttributeCount,
        sentenceCount,
        `Quality Scores available for every sentence in translation.
          translatedHTML:${translatedHTMLWithQEScores}
          translatedText:${translation}
          message:${message}`
      );

      // check if number of words and the number of word score attributes match in the translation
      let wordCount = translation.match(/\w[.?!,;]*(\s|$)/g).length;
      let wordScoreAttributeCount = (translatedHTMLWithQEScores.match(/x-bergamot-word-score/g) || []).length;
      is(
        wordScoreAttributeCount,
        wordCount,
        `Quality Scores available for every word in translation.
          translatedHTML:${translatedHTMLWithQEScores}
          translatedText:${translation}
          message:${message}`
      );

      // check if all the sentence and word quality scores are valid i.e. in range [-1.0, 0.0]
      const validQEScores = (translatedHTMLWithQEScores) => {
        const regex = /x-bergamot-sentence-score=\"|x-bergamot-word-score=\"/;
        for (const substring of translatedHTMLWithQEScores.split(regex)) {
          let val = parseFloat(substring);
          if (!isNaN(val) && (val > 0 && val < -1.00))
            return false;
        }
        return true;
      };

      is(
        validQEScores(translatedHTMLWithQEScores),
        true,
        `Quality Scores are not in valid range for every word/sentence in translation.
          translatedHTML:${translatedHTMLWithQEScores}
          translatedText:${translation}
          message:${message}`
      );
    }

    await new Promise(resolve => content.setTimeout(resolve, 10000));
    await checkTranslation(content.document, "main frame");
    await checkTranslation(content.document.getElementById("iframe").contentWindow.document, "iframe");

    await checkQualityEstimation(content.document, "main frame");
    await checkQualityEstimation(content.document.getElementById("iframe").contentWindow.document, "iframe");
  });

  delete window.MozTranslationNotification;
  delete window.TRANSLATION_NOTIFICATION_ELEMENT_ID;
  notification.close();
  BrowserTestUtils.removeTab(tab);
});