const regionNamesInEnglish = new Intl.DisplayNames([...navigator.languages, 'en'], {type: 'language'});

// Tab state
const tabState = {};

// Plugin state, like configuration mostly
const globalState = {};

// Init global state
compat.storage.local.get(['developer']).then(state => {
	Object.assign(globalState, state);
});

compat.storage.onChanged.addListener(changes => {
    Object.entries(changes).forEach(([key, {newValue}]) => {
        globalState[key] = newValue;
    });
    render();
});

function render() {
	// If the model (or one of the models in case of pivoting) needs downloading
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
		'lang-from': name(tabState.from),
		'lang-to': name(tabState.to),
		'lang-from-options': new Map(tabState.models.map(({from}) => [from, name(from)])),
		'lang-to-options': new Map(tabState.models.filter(model => tabState.from === model.from).map(({to, pivot}) => [to, name(to) + (pivot ? ` (via ${name(pivot)})` : '')])),
		'needs-download': needsDownload,
		'completedTranslationRequests': tabState.totalTranslationRequests - tabState.pendingTranslationRequests || undefined,
		'canExportPages': tabState.recordedPagesCount > 0,
	};

	// Toggle "hidden" state of all <div data-state=""> elements
	document.querySelectorAll('*[data-state]').forEach(el => {
		el.hidden = tabState.state ? el.dataset.state != tabState.state : el.dataset.state != '';
	});

	renderBoundElements(document.body, renderState);
}

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
	});

	addEventListeners(document.body, {
		'click #translate-btn': e => {
			backgroundScript.postMessage({
				command: 'TranslateStart'
			});
		},
		'click #download-btn': e => {
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
		'click #abort-translate-btn': e => {
			backgroundScript.postMessage({
				command: 'TranslateAbort'
			});
		},
		'click #export-recorded-pages-btn': e => {
			backgroundScript.postMessage({
				command: 'ExportRecordedPages'
			});
		}
	});
});
