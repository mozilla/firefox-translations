// Defaults. Duplicated in backgroundScript.js :(

const state = {
	provider: 'wasm',
	translateLocallyAvailable: false,
	recorder: false,
	get benchmarkURL() {
		return browser.runtime.getURL('view/static/benchmark.html');
	}
};

browser.storage.local.get().then(localState => {
	Object.assign(state, localState);
	renderBoundElements(document.body, state);
});

browser.storage.onChanged.addListener(async changes => {
	Object.entries(changes).forEach(([key, {newValue}]) => {
		state[key] = newValue;
	});
	renderBoundElements(document.body, state);
});

addBoundElementListeners(document.body, (key, value) => {
	browser.storage.local.set({[key]: value});
});

const port = browser.runtime.connectNative('translatelocally');
port.onDisconnect.addListener(e => {
	console.log('onDisconnect', port.error);
	if (port.error) {
		state.translateLocallyAvailable = false;
	} else {
		state.translateLocallyAvailable = true;
	}
	renderBoundElements(document.body, state);
})
port.disconnect();
