browser.storage.local.get().then(renderBoundElements);

browser.storage.onChanged.addListener(async changes => {
	renderBoundElements(await browser.storage.local.get());
});

addBoundElementListeners((key, value) => {
	browser.storage.local.set({[key]: value});
});
