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
	console.log('renderSelect', select, values);
	while (select.length)
		select.remove(0);
	values.forEach(value => select.add(new Option(value), null));
}

function render(state) {
	console.log('render', state);

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
}

browser.tabs.query({active: true, currentWindow: true}).then(tabs => {
	const tabId = tabs[0].id;

	const backgroundScript = browser.runtime.connect({name: `popup-${tabId}`});

	const state = {
		state: 'page-loading',
		from: undefined,
		to: undefined,
		models: [],
		pendingTranslationRequests: 0,
		totalTranslationRequests: 0
	};

	backgroundScript.onMessage.addListener(({command, data}) => {
		console.log('[popup] backgroundScript.onMessage', {command, data});

		switch (command) {
			case 'Update':
				console.log('Update', data);
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
		}
	});
});
