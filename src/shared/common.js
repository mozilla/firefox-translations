export function addEventListeners(root, handlers) {
	const handlersPerEventType = {};

	Object.entries(handlers).forEach(([name, callback]) => {
		const [event, selector] = name.split(' ', 2);
		if (!(event in handlersPerEventType))
			handlersPerEventType[event] = [];
		handlersPerEventType[event].push({selector, callback});
	});

	Object.entries(handlersPerEventType).forEach(([event, handlers]) => {
		root.addEventListener(event, e => {
			handlers.forEach(({selector, callback}) => {
				if (e.target.matches(selector))
					callback(e);
			});
		});
	});
}

export const StateHelper = {
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

export function renderSelect(select, values) {
	// Todo: we can be smarter about this!
	while (select.length)
		select.remove(0);
	for (let [value, label] of values)
		select.add(new Option(label, value), null);
}

export function queryXPathAll(root, query, callback) {
	const result = document.evaluate(query, root, null, XPathResult.UNORDERED_NODE_ITERATOR_TYPE, null);
	let output = [];
	let element;
	while (element = result.iterateNext()) {
		output.push(element);
	};
	return output;
}

export class BoundElementRenderer {
	constructor(root) {
		// this.elements = queryXPathAll(root, './/*[@*[starts-with(name(), "data-bind:")]]');
		this.elements = [];
		
		root.querySelectorAll('*').forEach(el => {
			const bindings = [];

			Object.entries(el.dataset).forEach(([key, value]) => {
				let match = key.match(/^bind:(.+)$/);
				if (match) bindings.push({attribute: match[1], key: value});
			});

			if (bindings.length > 0)
				this.elements.push({el, bindings});
		});
	}

	render(state) {
		const stateProxy = new Proxy(state, StateHelper);

		this.elements.forEach(({el, bindings}) => {
			bindings.forEach(({attribute, key}) => {
				try {
					switch (attribute) {
						case 'options':
							renderSelect(el, stateProxy[key]);
							break;
						default:
							// Special case for <progress value=undefined> to get an indeterminate progress bar
							if (attribute === 'value' && el instanceof HTMLProgressElement && typeof stateProxy[key] !== 'number') {
								el.removeAttribute('value');
							} else {
								if (!key.startsWith('!') && !(key in stateProxy))
									console.warn('render state has no key', key);
								else if (typeof stateProxy[key] === 'undefined')
									el.removeAttribute(attribute);
								else
									el[attribute] = stateProxy[key];
							}
							break;
					}
				} catch (e) {
					console.error('Error while setting',attribute, 'of', el, 'to the value of', key, ':', e, state[key]);
				}
			});
		});
	}
}

export function renderBoundElements(root, state) {
	return new BoundElementRenderer(root).render(state);
}

export function addBoundElementListeners(root, callback) {
	addEventListeners(root, {
		'change *[data-bind\\:value]': e => {
			callback(e.target.dataset['bind:value'], e.target.value, e);
		},
		'change input[type=checkbox][data-bind\\:checked]': e => {
			callback(e.target.dataset['bind:checked'], e.target.checked, e);
		}
	});
}

export function debounce(callable) {
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

export async function* asCompleted(iterable) {
	const promises = new Set(iterable);
	while (promises.size() > 0) {
		const next = await Promise.race(promises);
		yield next;
		promises.delete(next);
	}
}