// Defaults. Duplicated in backgroundScript.js :(

const state = {
	provider: 'wasm',
	translateLocallyAvailable: false,
	developer: false,
	get benchmarkURL() {
		return compat.runtime.getURL('view/static/benchmark.html');
	}
};

compat.storage.local.get().then(localState => {
	Object.assign(state, localState);
	renderBoundElements(document.body, state);
});

compat.storage.onChanged.addListener(async changes => {
	Object.entries(changes).forEach(([key, {newValue}]) => {
		state[key] = newValue;
	});
	renderBoundElements(document.body, state);
});

addBoundElementListeners(document.body, (key, value) => {
	compat.storage.local.set({[key]: value});
});

const port = compat.runtime.connectNative('translatelocally');
port.onDisconnect.addListener(e => {
	console.log('onDisconnect', port.error);
	if (port.error || compat.runtime.lastError) {
		state.translateLocallyAvailable = false;
		renderBoundElements(document.body, state);
	}
});
port.disconnect();
state.translateLocallyAvailable = true;
renderBoundElements(document.body, state);
