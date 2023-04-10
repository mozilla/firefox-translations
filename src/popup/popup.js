import compat from '../shared/compat.js';
import {
	addEventListeners,
	addBoundElementListeners,
  BoundElementRenderer,
} from '../shared/common.js';
import preferences from '../shared/preferences.js';

const regionNamesInEnglish = new Intl.DisplayNames([...navigator.languages, 'en'], {type: 'language'});

// Tab state
const tabState = {};

// Plugin state (a synchronised view of what's currently in storage)
const globalState = preferences.view({
	'developer': false
})

let lastRenderedState = undefined;

let renderTimeout = new class {
	constructor() {
		this.timeout = null;
	}

	/**
	 * calls callback delayed. If there's already a delayed callback scheduled,
	 * the callback will be set to the new one, but the timeout will just continue
	 * and not reset from the beginning of `delay`.
	 */
	delayed(callback, delay) {
		if (this.timeout === null)
			this.timeout = setTimeout(this.immediate.bind(this), delay);
		this.callback = callback;
	}

	/**
	 * Call callback now, and clear any previously scheduled callback.
	 */
	immediate(callback) {
		clearTimeout(this.timeout);
		this.timeout = null;
		(callback || this.callback)();
	}
};

const boundRenderer = new BoundElementRenderer(document.body);

function render() {
	// If the model (or one of the models in case of pivoting) needs 
	// downloading. This info is not always entirely up-to-date since `local`
	// is a getter when queried from WASMTranslationHelper, but that doesn't
	// survive the message passing we use to get state.
	const needsDownload = tabState.models?.find(model => tabState.from === model.from && tabState.to === model.to)?.models?.some(({model}) => !model.local);

	const name = (code) => {
		if (!code)
			return undefined;
		
		try {
			return regionNamesInEnglish.of(code);
		} catch (RangeError) {
			return `[${code}]`; // fallback if code is not known or invalid
		}
	};

	const renderState = {
		...globalState,
		...tabState,
		'langFromName': name(tabState.from),
		'langToName': name(tabState.to),
		'langFromOptions': new Map(tabState.models?.map(({from}) => [from, name(from)])),
		'langToOptions': new Map(tabState.models?.filter(model => tabState.from === model.from).map(({to, pivot}) => [to, name(to) + (pivot ? ` (via ${name(pivot)})` : '')])),
		'needsDownload': needsDownload,
		'completedTranslationRequests': tabState.totalTranslationRequests - tabState.pendingTranslationRequests || undefined,
		'canExportPages': tabState.recordedPagesCount > 0,
	};

	// Little hack because we don't have a translation-completed state in the
	// background script, but we do want to render a different popup when there's
	// no more translations pending.
	// https://github.com/jelmervdl/translatelocally-web-ext/issues/54
	if (renderState.state === 'translation-in-progress' && renderState.pendingTranslationRequests === 0)
		renderState.state = 'translation-completed';

	// Callback to do the actual render
	const render = () => {
		// Remember the currently rendered state (for delay calculation below)
		lastRenderedState = renderState.state;
		boundRenderer.render(renderState);
	}

	// If we switched state, we delay the render a bit because we might be
	// flipping between two states e.g. a very brief translating-in-progress
	// because a new element popped up, and mostly translation-completed for the
	// rest of the time. We don't want that single brief element to make the
	// interface flicker between the two states all the time.
	if (tabState.state !== lastRenderedState && lastRenderedState !== undefined)
		renderTimeout.delayed(render, 250);
	else
		renderTimeout.immediate(render);
}

// re-render if the 'developer' preference changes (but also when the real
// values are fetched from storage!)
globalState.addListener(render);

function download(url, name) {
	const a = document.createElement('a');
	a.href = url;
	a.download = name;
	a.click();
	a.addEventListener('click', e => {
		requestIdleCallback(() => {
			URL.revokeObjectURL(url);
		});
	});
}

// Query which tab we represent and then connect to the tab state in the 
// background-script. Connecting will cause us to receive an "Update" message
// with the tab's state (and any future updates to it)
compat.tabs.query({active: true, currentWindow: true}).then(tabs => {
	const tabId = tabs[0].id;

	const backgroundScript = compat.runtime.connect({name: `popup-${tabId}`});

	backgroundScript.onMessage.addListener(({command, data}) => {
		switch (command) {
			case 'Update':
				Object.assign(tabState, data);
				render();
				break;
			case 'DownloadRecordedPages':
				download(data.url, data.name);
				break;
		}
	});

	addBoundElementListeners(document.body, (key, value) => {
		backgroundScript.postMessage({
			command: 'UpdateRequest',
			data: {[key]: value}
		});

		// If the user changes the 'translate to' field, interpret this as a
		// strong preference to always translate to that language.
		if (key === 'to')
			preferences.set('preferredLanguageForPage', value);
	});

	addEventListeners(document.body, {
		'click .translate-btn': e => {
			backgroundScript.postMessage({
				command: 'TranslateStart'
			});
		},
		'click .download-btn': e => {
			// TODO this assumes tabState.from and tabState.to reflect the current UI,
			// which they should iff the UpdateRequest has been processed and
			// broadcasted by backgroundScript.
			const models = tabState.models
				.find(({from, to}) => from === tabState.from && to === tabState.to)
		        .models
		        .map(({model}) => model.id)
		        .slice(0, 1);

			backgroundScript.postMessage({
				command: 'DownloadModels',
				data: {models}
			});
		},
		'click .abort-translate-btn': e => {
			backgroundScript.postMessage({
				command: 'TranslateAbort'
			});
		},
		'click .export-recorded-pages-btn': e => {
			backgroundScript.postMessage({
				command: 'ExportRecordedPages'
			});
		}
	});
});
