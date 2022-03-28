// Defaults. Duplicated in backgroundScript.js :(
const state = {
	provider: 'wasm'
};

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
