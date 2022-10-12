import compat from '../shared/compat.js';
import {
	renderBoundElements,
	addBoundElementListeners
} from '../shared/common.js';
import preferences from '../shared/preferences.js';

const globalState = preferences.view({
	provider: 'wasm',
	developer: false,
	progressIndicator: ''
});

const localState = {
	translateLocallyAvailable: false,
	get benchmarkURL() {
		return compat.runtime.getURL('benchmark.html');
	}
};

const render = () => renderBoundElements(document.body, {...globalState, ...localState});

// Re-render page if value changes from the outside
globalState.addListener(render);

// Store value if we changed it on the options page
addBoundElementListeners(document.body, (key, value) => {
	preferences.set(key, value);
});

function canTranslateLocally() {
	return new Promise((resolve, reject) => {
		const port = compat.runtime.connectNative('translatelocally');
		port.onDisconnect.addListener(() => resolve(false));
		port.onMessage.addListener(message => {
			resolve(true);
			port.disconnect();
		});

		// Doesn't matter whether this message is supported or not. If it isn't
		// it will still elicit a response message, which will confirm that
		// translatelocally exists and works.
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