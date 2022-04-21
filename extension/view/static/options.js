// Defaults. Duplicated in backgroundScript.js :(

const state = new Proxy({
	provider: 'wasm',
	translateLocallyAvailable: false
}, StateHelper);

compat.storage.local.get().then(localState => {
	Object.assign(state, localState);
	renderBoundElements(state);
});

compat.storage.onChanged.addListener(async changes => {
	Object.entries(changes).forEach(([key, {newValue}]) => {
		state[key] = newValue;
	});
	renderBoundElements(state);
});

addBoundElementListeners((key, value) => {
	compat.storage.local.set({[key]: value});
});

const port = compat.runtime.connectNative('translatelocally');
port.onDisconnect.addListener(e => {
	console.log('onDisconnect', port.error);
	if (port.error || compat.runtime.lastError) {
		state.translateLocallyAvailable = false;
		renderBoundElements(state);
	}
})
port.disconnect();
state.translateLocallyAvailable = true;
renderBoundElements(state);
