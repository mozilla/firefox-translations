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

function renderBoundElements(state) {
	// Assign values to each element that has <div data-bind:something=""> attributes
	queryXPathAll('//*[@*[starts-with(name(), "data-bind:")]]').forEach(el => {
		Object.entries(el.dataset).forEach(([key, value]) => {
			let match = key.match(/^bind:(.+)$/);
			if (!match) return;

			try {
				switch (match[1]) {
					case 'options':
						renderSelect(el, state[value]);
						break;
					default:
						// Special case for <progress value=undefined> to get an indeterminate progress bar
						if (match[1] === 'value' && el instanceof HTMLProgressElement && typeof state[value] !== 'number')
							el.removeAttribute('value');
						else
							if (!(value in state))
								console.warn('render state has no key', value);
							el[match[1]] = state[value];
						break;
				}
			} catch (e) {
				console.error('Error while setting', value, 'of', el, ':', e);
			}
		});
	});
}

function addBoundElementListeners(callback) {
	addEventListeners({
		'change *[data-bind\\:value]': e => {
			callback(e.target.dataset['bind:value'], e.target.value, e);
		},
		'change input[type=checkbox][data-bind\\:checked]': e => {
			callback(e.target.dataset['bind:checked'], e.target.checked, e);
		}
	});
}