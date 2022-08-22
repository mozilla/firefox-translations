/* eslint-disable no-undef */

const sendMessage = event => {
    browser.runtime.sendMessage({
        command: event.target.id,
        consent: event.target.checked
    });
};

const inputs = document.getElementsByTagName("input");
for (let input of inputs) {
    input.addEventListener("click", event => {
        // notify the background script that the user changed its consent
        sendMessage(event)
    });

    browser.storage.local.get(input.id).then(item => {
        if (Object.keys(item).length !== 0) {
            const elementName = Object.keys(item)[0];
            document.getElementById(elementName).checked = item[elementName];
        }
    });
}

document.getElementById("lblHeader").textContent =
    browser.i18n.getMessage("datacollectionConsentPageTitle");

document.getElementById("lblDescription").textContent =
browser.i18n.getMessage("datacollectionConsentPageDescription");

document.getElementById("lblReportUserInteraction").textContent =
    browser.i18n.getMessage("datacollectionConsentPageUserInteractionOption");

document.getElementById("lblErrorReport").textContent =
browser.i18n.getMessage("datacollectionConsentPageErrorsOption");

document.getElementById("lblShowChangelog").textContent =
  browser.i18n.getMessage("showChangelogOption");