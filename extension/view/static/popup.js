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
	values.forEach(value => select.add(new Option(value), null));
}

function render(state) {
	console.log('[popup] Render', state);

	document.querySelectorAll('*[data-state]').forEach(el => {
		el.hidden = el.dataset.state != state.state;
	});

	const fromOptions = new Set(state.models.map(({from}) => from));
	renderSelect(document.querySelector('#lang-from'), fromOptions);
	document.querySelector('#lang-from').value = state.from;

	const toOptions = new Set(state.models
		.filter(({from}) => (!state.from || state.from === from))
		.map(({to}) => to));
	renderSelect(document.querySelector('#lang-to'), toOptions);
	document.querySelector('#lang-to').value = state.to;

	const progress = state.totalTranslationRequests - state.pendingTranslationRequests;
	if (progress)
		document.querySelector('#progress-bar').value = progress;
	else
		document.querySelector('#progress-bar').removeAttribute('value'); // gives you a nice I DONT KNOW?! kind of style progress bar during model loading ;)
	document.querySelector('#progress-bar').max = state.totalTranslationRequests;

	document.querySelectorAll('input[type=checkbox][data-state-key]').forEach(el => {
		el.checked = state[el.dataset.stateKey];
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
		'change input[type=checkbox][data-state-key]': e => {
			backgroundScript.postMessage({
				command: 'UpdateRequest',
				data: {
					[e.target.dataset.stateKey]: e.target.checked
				}
			})
		}
	});
});
