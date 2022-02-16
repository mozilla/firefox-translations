/* eslint-disable no-undef */
/* eslint-disable max-lines-per-function */


 const baseURL = getRootDirectory(gTestPath).replace(
   "chrome://mochitests/content",
   "https://example.com"
 );

 add_task(async function testTranslationBarDisplayed() {
   info("Test the Translation functionality");

   // open the test page.
   let tab = await BrowserTestUtils.openNewForegroundTab(
     gBrowser,
     `${baseURL }browser_translation_test.html`
   );

   /*
    * the infobar is not triggered first time the page is loaded due some caching
    * so we need to reload the tab in order to have it summoned
    */
   gBrowser.reloadTab(tab);

   // wait for the translation bar to be displayed.
   let notification = await TestUtils.waitForCondition(() => gBrowser
       .getNotificationBox()
       .getNotificationWithValue("fxtranslation-notification"));
   ok(notification, "Translation notification bar was displayed.");

   // let's make sure the selected language in the bar matches the page
   const languageDropdown = notification.querySelector("[anonid=detectedLanguage]");
   const selectedLanguage = languageDropdown.selectedItem.textContent;
   is(selectedLanguage, "Spanish", "Detected language is in spanish");

   // now that the bar was displayed, let's push the button to translate
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

   await SpecialPowers.spawn(gBrowser.selectedBrowser, [], async () => {
     await new Promise(resolve => content.setTimeout(resolve, 5000));

     is(
       content.document.getElementById("translationDiv").innerHTML,
       "Hello world. That's a test of translations.",
       "Text was correctly translated."
     );
   });

   delete window.MozTranslationNotification;
   delete window.now;
   notification.close();
   BrowserTestUtils.removeTab(tab);
 });