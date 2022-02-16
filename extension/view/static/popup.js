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
	Object.entries(values).forEach(([value, label]) => select.add(new Option(label, value), null));
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

function render(state) {
	const regionNamesInEnglish = new Intl.DisplayNames(['en'], {type: 'language'});

	state = {
		...state,
		'lang-from': regionNamesInEnglish.of(state.from),
		'lang-to': regionNamesInEnglish.of(state.to),
		'lang-from-options': Object.fromEntries(state.models.map(({from}) => [from, regionNamesInEnglish.of(from)])),
		'lang-to-options': Object.fromEntries(state.models.map(({to}) => [to, regionNamesInEnglish.of(to)])),
		'completedTranslationRequests': state.totalTranslationRequests - state.pendingTranslationRequests
	};

	// Toggle "hidden" state of all <div data-state=""> elements
	document.querySelectorAll('*[data-state]').forEach(el => {
		el.hidden = el.dataset.state != state.state;
	});

	// Assign values to each element that has <div data-bind:something=""> attributes
	queryXPathAll('//*[@*[starts-with(name(), "data-bind:")]]').forEach(el => {
		Object.entries(el.dataset).forEach(([key, value]) => {
			let match = key.match(/^bind:(.+)$/);
			if (!match) return;

			switch (match[1]) {
				case 'options':
					renderSelect(el, state[value]);
					break;
				default:
					el[match[1]] = state[value];
					break;
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
		totalTranslationRequests: 0
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
					from: document.querySelector('#lang-from').value,
					to: document.querySelector('#lang-to').value
				}
			});
		},
		'click #abort-translate-btn': e => {
			backgroundScript.postMessage({
				command: 'TranslateAbort'
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
