function addEventListeners(handlers) {
	const handlersPerEventType = {};

	Object.entries(handlers).forEach(([name, callback]) => {
		const [event, selector] = name.split(' ', 2);
		if (!(event in handlersPerEventType))
			handlersPerEventType[event] = [];
		handlersPerEventType[event].push({selector, callback});
	});

	Object.entries(handlersPerEventType).forEach(([event, handlers]) => {
		document.body.addEventListener(event, e => {
			handlers.forEach(({selector, callback}) => {
				if (e.target.matches(selector))
					callback(e);
			});
		});
	});
}

function renderSelect(select, values) {
	// Todo: we can be smarter about this!
	while (select.length)
		select.remove(0);
	for (let [value, label] of values)
		select.add(new Option(label, value), null);
}

function queryXPathAll(query, callback) {
	const result = document.evaluate(query, this instanceof Element ? this : document.body, null, XPathResult.UNORDERED_NODE_ITERATOR_TYPE, null);
	let output = [];
	let element;
	while (element = result.iterateNext()) {
		output.push(element);
	};
	return output;
}

const regionNamesInEnglish = new Intl.DisplayNames([...navigator.languages, 'en'], {type: 'language'});

function render(state) {
	// Shortcuts, I use these everywhere
	const from = state.from || state.page.from;
	const to = state.to || state.page.to;

	// If the model (or one of the models in case of pivoting) needs downloading
	const needsDownload = state.page.models.find(model => from === model.from && to === model.to)?.models?.some(({model}) => !model.local);

	const renderState = {
		...state,
		from,
		to,
		'lang-from': regionNamesInEnglish.of(from),
		'lang-to': regionNamesInEnglish.of(to),
		'lang-from-options': new Map(state.page.models.map(({from}) => [from, regionNamesInEnglish.of(from)])),
		'lang-to-options': new Map(state.page.models.filter(model => from === model.from).map(({to, pivot}) => [to, regionNamesInEnglish.of(to) + (pivot ? ` (via ${regionNamesInEnglish.of(pivot)})` : '')])),
		'needs-download': needsDownload,
		'!needs-download': !needsDownload, // data-bind has no operators, so ! goes in the name :P
		'completedTranslationRequests': state.totalTranslationRequests - state.pendingTranslationRequests || undefined
	};

	// Toggle "hidden" state of all <div data-state=""> elements
	document.querySelectorAll('*[data-state]').forEach(el => {
		el.hidden = el.dataset.state != renderState.state;
	});

	// Assign values to each element that has <div data-bind:something=""> attributes
	queryXPathAll('//*[@*[starts-with(name(), "data-bind:")]]').forEach(el => {
		Object.entries(el.dataset).forEach(([key, value]) => {
			let match = key.match(/^bind:(.+)$/);
			if (!match) return;

			try {
				switch (match[1]) {
					case 'options':
						renderSelect(el, renderState[value]);
						break;
					default:
						// Special case for <progress value=undefined> to get an indeterminate progress bar
						if (match[1] === 'value' && el instanceof HTMLProgressElement && typeof renderState[value] !== 'number')
							el.removeAttribute('value');
						else
							if (!(value in renderState))
								console.warn('render state has no key', value);
							el[match[1]] = renderState[value];
						break;
				}
			} catch (e) {
				console.error('Error while setting', value, 'of', el, ':', e);
			}
		});
	});
}

// Query which tab we represent and then connect to the tab state in the 
// background-script. Connecting will cause us to receive an "Update" message
// with the tab's state (and any future updates to it)
browser.tabs.query({active: true, currentWindow: true}).then(tabs => {
	const tabId = tabs[0].id;

	const backgroundScript = browser.runtime.connect({name: `popup-${tabId}`});

	const state = {
		state: 'page-loading',
		from: undefined,
		to: undefined,
		models: [],
		debug: false,
		pendingTranslationRequests: 0,
		totalTranslationRequests: 0,
		modelDownloadProgress: undefined
	};

	backgroundScript.onMessage.addListener(({command, data}) => {
		switch (command) {
			case 'Update':
				Object.assign(state, data);
				render(state);
				break;
		}
	});

	addEventListeners({
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
			              .map(({model}) => model.shortname);

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
		'change *[data-bind\\:value]': e => {
			backgroundScript.postMessage({
				command: 'UpdateRequest',
				data: {
					[e.target.dataset['bind:value']]: e.target.value
				}
			});
		},
		'change input[type=checkbox][data-bind\\:checked]': e => {
			backgroundScript.postMessage({
				command: 'UpdateRequest',
				data: {
					[e.target.dataset['bind:checked']]: e.target.checked
				}
			})
		}
	});
});
