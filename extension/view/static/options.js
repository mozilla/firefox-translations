// Defaults. Duplicated in backgroundScript.js :(

const globalState = {
	provider: 'wasm',
	developer: false,
};

const localState = {
	translateLocallyAvailable: false,
	get benchmarkURL() {
		return compat.runtime.getURL('view/static/benchmark.html');
	}
};

const render = () => renderBoundElements(document.body, {...globalState, ...localState});

compat.storage.local.get().then(state => {
	Object.assign(globalState, state);
	render();
});

compat.storage.onChanged.addListener(async changes => {
	Object.entries(changes).forEach(([key, {newValue}]) => {
		globalState[key] = newValue;
	});
	render();
});

addBoundElementListeners(document.body, (key, value) => {
	compat.storage.local.set({[key]: value});
});

function canTranslateLocally() {
	return new Promise((resolve, reject) => {
		const port = compat.runtime.connectNative('translatelocally');
		port.onDisconnect.addListener(() => resolve(false));
		port.onMessage.addListener(message => {
			resolve(true);
			port.disconnect();
		});
		port.postMessage({
			"id": 1,
			"command": "Version",
			"data": {}
		});
	});
}

canTranslateLocally().then(available => {
	localState.translateLocallyAvailable = available;
	render();
});