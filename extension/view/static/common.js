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

const StateHelper = {
	get(target, prop, receiver) {
		if (prop.substr(0, 1) === '!')
			return !Reflect.get(target, prop.substr(1));

		return Reflect.get(...arguments);
	},
	has(target, prop) {
		if (prop.substr(0, 1) === '!')
			return Reflect.has(target, prop.substr(1));

		return Reflect.has(target, prop);
	}
};

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
	const stateProxy = new Proxy(state, StateHelper);

	// Assign values to each element that has <div data-bind:something=""> attributes
	queryXPathAll.call(this, './/*[@*[starts-with(name(), "data-bind:")]]').forEach(el => {
		Object.entries(el.dataset).forEach(([key, value]) => {
			let match = key.match(/^bind:(.+)$/);
			if (!match) return;

			try {
				switch (match[1]) {
					case 'options':
						renderSelect(el, stateProxy[value]);
						break;
					default:
						// Special case for <progress value=undefined> to get an indeterminate progress bar
						if (match[1] === 'value' && el instanceof HTMLProgressElement && typeof stateProxy[value] !== 'number') {
							el.removeAttribute('value');
						} else {
							if (!(value in stateProxy))
								console.warn('render state has no key', value);
							else if (typeof stateProxy[value] !== 'undefined')
								el[match[1]] = stateProxy[value];
						}
						break;
				}
			} catch (e) {
				console.error('Error while setting', match[1], 'of', el, 'to the value of', value, ':', e, state[value]);
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

function debounce(callable) {
	let scheduled = null;
	return (...args) => {
		if (scheduled) {
			scheduled.args = args;
		} else {
			scheduled = {args};
			requestIdleCallback(() => {
				callable(...scheduled.args);
				scheduled = null;
			}, {timeout: 500});
		}
	};
}