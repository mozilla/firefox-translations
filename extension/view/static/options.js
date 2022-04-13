// Defaults. Duplicated in backgroundScript.js :(

const state = new Proxy({
	provider: 'wasm',
	translateLocallyAvailable: false
}, StateHelper);

browser.storage.local.get().then(localState => {
	Object.assign(state, localState);
	renderBoundElements(state);
});

browser.storage.onChanged.addListener(async changes => {
	Object.entries(changes).forEach(([key, {newValue}]) => {
		state[key] = newValue;
	});
	renderBoundElements(state);
});

addBoundElementListeners((key, value) => {
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
	renderBoundElements(state);
})
port.disconnect();
