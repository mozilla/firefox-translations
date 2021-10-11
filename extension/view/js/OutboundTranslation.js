
/* global browser */

// eslint-disable-next-line no-unused-vars
class OutboundTranslation {

  constructor(mediator) {
    this.mediator = mediator;
    this.selectedTextArea = null;
    this.otDiv = null;
    this.otTextArea = null;
  }

  // eslint-disable-next-line max-lines-per-function
  async start() {

    let pageFragment = null;
    try {
      // first we load the pageFragment (UI)
      const response = await fetch(browser
        .runtime.getURL("view/static/ot.html"), { mode: "no-cors" });
      if (response.ok) {
        pageFragment = await response.text();
      } else {
        pageFragment = "Error loading outbound translation code fragment";
      }
    } catch (exception) {
      console.error(exception.message, exception.stack);
    }

      // then we create the div that holds it
      this.otDiv = document.createElement("div");
      this.otDiv.className = "fxtranslations-ot";
      this.otDiv.innerHTML = pageFragment;

      /*
       * we scan all textareas and attach our listeners to display
       * the UI when the element receives focus
       */
      const textareas = document.querySelectorAll("textarea");
      for (const textarea of textareas) {
        textarea.addEventListener("focus", () => {
          this.attachOtToTextAreaListener();
        });
      }

      /*
       * we then add the typying listeners to the outbound translation main
       * textarea in order to capture what's input and push it to the
       * translatinon queue
       */
      this.otDiv.querySelector("textarea").addEventListener("keyup", () => {
        this.sendTextToTranslation();
      });
  }

  attachOtToTextAreaListener() {
    document.body.appendChild(this.otDiv);

    this.selectedTextArea = document.activeElement;
    this.otTextArea = document.getElementById("OTapp")
      .querySelector("textarea");

    // set focus on the OT textarea
    this.otTextArea.focus();

    // listen to when the textarea loses focus in order to remove the div
    this.otTextArea.addEventListener("blur", () => {
      document.body.removeChild(this.otDiv);
    });
  }

  sendTextToTranslation() {
    const text = `${this.otTextArea.value} `;
    if (text.trim().length) {

      /*
       * send the content back to mediator in order to have the translation
       * requested by it
       */
      this.notifyMediator("translate", text.split("\n"));
    }
  }

  notifyMediator(command, payload) {
    this.mediator.contentScriptsMessageListener(this, {command, payload});
  }

  mediatorNotification(translationMessage) {
    this.updateselectedTextArea(translationMessage.translatedParagraph);
  }

  updateselectedTextArea(content) {
    this.selectedTextArea.value = content;
  }
}