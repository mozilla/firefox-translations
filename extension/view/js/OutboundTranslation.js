
/* global browser, Sentry, DOMPurify */

// eslint-disable-next-line no-unused-vars
class OutboundTranslation {

  constructor(mediator) {
    this.mediator = mediator;
    this.selectedTextArea = null;
    this.otDiv = null;
    this.otTextArea = null;
    this.backTranslationsTextArea = null;
    this.translationTimeout = null;
    this.TYPING_TIMEOUT = 500; // constant defining how long to wait before translating after the user stopped typing
    this.isUserTyping = false;
    this.textareaContentsMap = new Map();
  }

  // eslint-disable-next-line max-lines-per-function
  start(navigatorLanguage, pageLanguage) {
    // eslint-disable-next-line max-lines-per-function
    Sentry.wrap(async () => {
      let pageFragment = null;
      try {
        // first we load the pageFragment (UI)
        const response = await fetch(browser
          .runtime.getURL("view/static/outboundTranslation.html"), { mode: "no-cors" });
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
      this.otDiv.id = "fxtranslations-ot";
      this.pageStatusLabel = this.otDiv.querySelector(".fxtranslations-status");
      const cleanString = DOMPurify.sanitize(browser.i18n.getMessage("formtranslationsDescription", [navigatorLanguage, pageLanguage]), { USE_PROFILES: { html: true } });
      this.otDiv.querySelector(".fxtranslations-header").innerHTML = cleanString;

      // it's safe to hardcode the widget to have the highest possible zindex in the page
      this.otDiv.style.zIndex = 2147483647;

      /*
       * we scan all textareas and attach our listeners to display
       * the widget when the element receives focus
       */
      this.addFormListeners(document.querySelectorAll("textarea"));

      /*
       * we then add the typying listeners to the outbound translation main
       * textarea in order to capture what's input and push it to the
       * translatinon queue
       */
      this.otDiv.querySelector("textarea").addEventListener("keydown", () => Sentry.wrap(() => {
        if (!this.isUserTyping) {
          this.isUserTyping = true;
          this.updateStatusLabel(browser.i18n.getMessage("formtranslationsTyping"));
        }
        if (this.translationTimeout) {
          clearTimeout(this.translationTimeout);
        }
        this.translationTimeout = setTimeout(
          this.sendTextToTranslation.bind(this),
          this.TYPING_TIMEOUT
        );
      }));

      /*
       * we need to list to then scroll in the main textarea in order to scroll
       * all other at same time.
       */
      this.otDiv.querySelector("textarea").addEventListener("scroll", e => Sentry.wrap(() => {
        window.requestAnimationFrame(() => {
          this.scrollTextAreas(e.target.scrollTop);
        });
      }));

      this.startMutationObserver();
      this.updateStatusLabel(browser.i18n.getMessage("formtranslationsReady"));
    });
  }

  addFormListeners(formElements) {
    for (const formElement of formElements) {
      formElement.addEventListener("focus", () => Sentry.wrap(() => {
        this.attachOtToTextAreaListener(formElement);
      }));
    }
  }

  attachOtToTextAreaListener(formElement) {
    if (document.body.contains(this.otDiv)) return;
    document.body.appendChild(this.otDiv);
    this.selectedTextArea = formElement;
    this.otTextArea = document.getElementById("OTapp")
      .querySelectorAll("textarea")[0];

    // set focus on the OT textarea
    this.otTextArea.focus();

    // get a reference to the backtranslations textarea
    this.backTranslationsTextArea = document.getElementById("OTapp")
    .querySelectorAll("textarea")[1];

    // listen to when the textarea loses focus in order to remove the div
    this.otTextArea.addEventListener("blur", () => Sentry.wrap(() => {
        // if the widget is still in the dom
        if (document.body.contains(this.otDiv)) {
          // first we save the content of the widget
          this.textareaContentsMap.set(this.selectedTextArea, {
            typedContent: this.otTextArea.value,
            translatedContent: this.backTranslationsTextArea.value
          });
          // remove it from the dom
          document.body.removeChild(this.otDiv);
          // and clear its forms
          this.otTextArea.value = "";
          this.backTranslationsTextArea.value = "";
          this.notifyMediator("reportFormsEvent", "hidden");
        }
      }));

    // update the widget content's if we have it stored
    const widgetContent = this.textareaContentsMap.get(formElement);
    if (widgetContent){
      this.otTextArea.value = widgetContent.typedContent;
      this.backTranslationsTextArea.value = widgetContent.translatedContent;
    }
    this.notifyMediator("reportFormsEvent", "displayed");
  }

  sendTextToTranslation() {

    this.isUserTyping = false;
    const text = `${this.otTextArea.value}  `;
    if (text.trim().length) {

      /*
       * send the content back to mediator in order to have the translation
       * requested by it
       */
      const payload = {
        text,
        type: "outbound"
      };

      this.updateStatusLabel(browser.i18n.getMessage("formtranslationsTranslationInProgress"));
      this.notifyMediator("translate", payload);
    } else {
      // textarea is empty. let's clear everything.
      this.updateStatusLabel(browser.i18n.getMessage("formtranslationsReady"));
      this.updateBackTranslationTextArea("");
      this.updateselectedTextArea("");
    }
  }

  sendBackTranslationRequest(text) {
    if (text.trim().length) {

      /*
       * send the content back to mediator in order to have the translation
       * requested by it
       */
      const payload = {
        text,
        type: "backTranslation"
      };
      this.notifyMediator("translate", payload);
    }
  }

  notifyMediator(command, payload) {
    this.mediator.contentScriptsMessageListener(this, { command, payload });
  }

  mediatorNotification(translationMessage) {

    if (translationMessage.type === "outbound") {

     /*
      * notification received from the mediator with our request. let's update
      * the original targeted textarea
      */
      this.updateselectedTextArea(translationMessage.translatedParagraph);
      this.sendBackTranslationRequest(translationMessage.translatedParagraph);
    } else {

      /*
       * and then request the translation to the mediator with the new text if
       * this is an outbound translation request
       */
      this.updateBackTranslationTextArea(translationMessage.translatedParagraph);
      this.updateStatusLabel(browser.i18n.getMessage("formtranslationsTranslationCompleted"));
    }
  }

  updateBackTranslationTextArea(content) {
    this.backTranslationsTextArea.value = content;
    this.backTranslationsTextArea.scrollTop = this.backTranslationsTextArea.scrollHeight;
  }

  updateselectedTextArea(content) {
    var nativeSetterTextarea = Reflect.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    Reflect.apply(nativeSetterTextarea, this.selectedTextArea, [content]);
    const nativeEvent = new Event("input", { bubbles: true });
    this.selectedTextArea.dispatchEvent(nativeEvent);
    this.selectedTextArea.scrollTop = this.selectedTextArea.scrollHeight;
  }

  extractElementZIndex(element){
    // first we check if the element contains inline style set
    let styleZIndex = element.style &&
                      element.style.zIndex &&
                      !isNaN(element.style.zIndex)
    ? parseInt(element.style.zIndex, 10)
    : 0;

    /*
     * then we check if the element also has a computed zindex in a css file
     * yes, that can happen. this is the world wild web.
     */
    let computedZIndex = getComputedStyle(element) &&
                        getComputedStyle(element).zIndex &&
                        !isNaN(getComputedStyle(element).zIndex)
    ? parseInt(getComputedStyle(element).zIndex, 10)
    : 0;
    return Math.max(styleZIndex, computedZIndex);
  }

  /*
   * although there's a mutation observer already in InPageTranslation.js,
   * OutboundTranslation.js also deserves its own, so we could both reduce
   * cpu time when Form Translation is not enabled, to not require one more
   * message to go through mediator, and also to reduce complexity and increase
   * modularity. If we notice that two mutation observers are hitting performance
   * we should revisit this.
   */
  startMutationObserver() {
    // select the node that will be observed for mutations
    const targetNode = document;

    // options for the observer (which mutations to observe)
    const config = { attributes: true, childList: true, subtree: true };
    // callback function to execute when mutations are observed
    const callback = function(mutationsList) {
        for (const mutation of mutationsList) {
            if (mutation.type === "childList" &&
                mutation.addedNodes[0] &&
                mutation.addedNodes[0].id !== "fxtranslations-ot") {
              // and then add listeners to occasional new form elements
              mutation.addedNodes.forEach(node => {
                if (node.nodeType === 1) this.startTreeWalker(node)
              });
            }
        }
    }.bind(this);

    // create an observer instance linked to the callback function
    const observer = new MutationObserver(callback);

    // start observing the target node for configured mutations
    observer.observe(targetNode, config);
  }

  startTreeWalker(root) {
    const acceptNode = node => {
        return node.nodeName === "TEXTAREA"
    }

    const nodeIterator = document.createNodeIterator(
        root,
        // eslint-disable-next-line no-bitwise
        NodeFilter.ELEMENT,
        acceptNode
    );

    let currentNode;
    // eslint-disable-next-line no-cond-assign
    while (currentNode = nodeIterator.nextNode()) {
      this.addFormListeners([currentNode]);
    }
  }

  updateStatusLabel(status) {
    // update the status in the widget
    this.pageStatusLabel.textContent = status;
  }

  scrollTextAreas(scrollTop) {
    this.backTranslationsTextArea.scrollTop = scrollTop;
    this.selectedTextArea.scrollTop = scrollTop;
  }
}