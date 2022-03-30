/* eslint-disable prefer-reflect */
/* eslint-disable no-undef */
/* eslint-disable max-lines-per-function */

requestLongerTimeout(4);

const baseURL = getRootDirectory(gTestPath).replace(
  "chrome://mochitests/content",
  "https://example.com"
);

add_task(async function testTranslationBarDisplayed() {
  info("Test the Translation functionality");

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
        notification.querySelector("[anonid=progress-label]").value
           .includes("Automatic Translation enabled")
      );
    },
    "Translation was properly started.",
    5000,
    200
  );

  // and check if the translation happened
  await SpecialPowers.spawn(gBrowser.selectedBrowser, [], async () => {
    const checkTranslation = async (document, message) => {
      // check for the translated content
      is(
        document.getElementById("translationDiv").innerText,
        "Hello world. That's a test of translation tests.",
        `Text was correctly translated. (${message})`
      );

      /*
       * check for the quality scores in translated html content.
       * The score values might change if different model is used.
       */
      is(
        document.getElementById("translationDiv").innerHTML,
        "<font x-bergamot-sentence-index=\"0\" x-bergamot-sentence-score=\"-0.304852\"><font x-bergamot-word-index=\"0\" x-bergamot-word-score=\"-0.248207\">Hello</font> <font x-bergamot-word-index=\"1\" x-bergamot-word-score=\"-0.361497\">world.</font></font> <font x-bergamot-sentence-index=\"1\" x-bergamot-sentence-score=\"-0.127826\"><font x-bergamot-word-index=\"0\" x-bergamot-word-score=\"-0.0742788\">That's</font> <font x-bergamot-word-index=\"1\" x-bergamot-word-score=\"-0.213941\">a</font> <font x-bergamot-word-index=\"2\" x-bergamot-word-score=\"-0.204642\">test</font> <font x-bergamot-word-index=\"3\" x-bergamot-word-score=\"-0.0640169\">of</font> <font x-bergamot-word-index=\"4\" x-bergamot-word-score=\"-0.00412017\">translation</font> <font x-bergamot-word-index=\"5\" x-bergamot-word-score=\"-0.205956\">tests.</font></font>",
        `Quality Scores are present in translation. (${message})`
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

    await new Promise(resolve => content.setTimeout(resolve, 10000));
    await checkTranslation(content.document, "main frame");
    await checkTranslation(content.document.getElementById("iframe").contentWindow.document, "iframe");
  });

  delete window.MozTranslationNotification;
  delete window.now;
  notification.close();
  BrowserTestUtils.removeTab(tab);
});