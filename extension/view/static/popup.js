const regionNamesInEnglish = new Intl.DisplayNames([...navigator.languages, 'en'], {type: 'language'});

function render(state) {
	// Shortcuts, I use these everywhere
	const from = state.from || state.page.from;
	const to = state.to || state.page.to;

	// If the model (or one of the models in case of pivoting) needs downloading
	const needsDownload = state.page.models.find(model => from === model.from && to === model.to)?.models?.some(({model}) => !model.local);

	const name = (code) => {
		try {
			return regionNamesInEnglish.of(code);
		} catch (RangeError) {
			return `[${code}]`; // fallback if code is not known or invalid
		}
	};

	const renderState = {
		...state,
		from,
		to,
		'lang-from': regionNamesInEnglish.of(from),
		'lang-to': regionNamesInEnglish.of(to),
		'lang-from-options': new Map(state.page.models.map(({from}) => [from, name(from)])),
		'lang-to-options': new Map(state.page.models.filter(model => from === model.from).map(({to, pivot}) => [to, name(to) + (pivot ? ` (via ${name(pivot)})` : '')])),
		'needs-download': needsDownload,
		'completedTranslationRequests': state.totalTranslationRequests - state.pendingTranslationRequests || undefined,
		'benchmarkURL': browser.runtime.getURL('view/static/benchmark.html')
	};

	// Toggle "hidden" state of all <div data-state=""> elements
	document.querySelectorAll('*[data-state]').forEach(el => {
		el.hidden = el.dataset.state != renderState.state;
	});

	renderBoundElements(document.body, renderState);
}

// Query which tab we represent and then connect to the tab state in the 
// background-script. Connecting will cause us to receive an "Update" message
// with the tab's state (and any future updates to it)
browser.tabs.query({active: true, currentWindow: true}).then(tabs => {
	const tabId = tabs[0].id;

	const backgroundScript = browser.runtime.connect({name: `popup-${tabId}`});

	const state = {};

	backgroundScript.onMessage.addListener(({command, data}) => {
		switch (command) {
			case 'Update':
				Object.assign(state, data);
				render(state);
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
				command: 'TranslateStart',
				data: {
					from: state.from || state.page.from,
					to: state.to || state.page.to
				}
			});
		},
		'click #download-btn': e => {
			const data = {
				from: state.from || state.page.from,
				to: state.to || state.page.to
			};

			// TODO this assumes state.from and state.to reflect the current UI,
			// which they should iff the UpdateRequest has been processed and
			// broadcasted by backgroundScript.
			data.models = state.page.models
			              .find(({from, to}) => from === data.from && to === data.to)
			              .models
			              .map(({model}) => model.id);

			backgroundScript.postMessage({
				command: 'DownloadModels',
				data
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
