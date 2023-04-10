import jsep from "jsep";

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

export function renderSelect(select, values) {
	// Todo: we can be smarter about this!
	const current = select.value;

	while (select.length)
		select.remove(0);
	
	for (let [value, label] of values)
		select.add(new Option(label, value), null);

	// console.log('renderSelect', select.options, select.value, current);

	if (current)
		select.value = current;
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

const binaryOperators = {
	'===': (left, right) => (state) => left(state) === right(state),
	'!==': (left, right) => (state) => left(state) !== right(state),
	 '==': (left, right) => (state) => left(state)  == right(state),
	 '!=': (left, right) => (state) => left(state)  != right(state),
	 '<=': (left, right) => (state) => left(state)  <= right(state),
	 '>=': (left, right) => (state) => left(state)  >= right(state),
	  '<': (left, right) => (state) => left(state)   < right(state),
	  '>': (left, right) => (state) => left(state)   > right(state),
}

const unaryOperators = {
	'!': (arg) => (state) => !arg(state)
};

function compileAST(expression) {
	switch (expression.type) {
		case 'BinaryExpression':
			if (!(expression.operator in binaryOperators))
				throw new Error(`Unknown operator: ${expression.operator}`);
			return binaryOperators[expression.operator](compileAST(expression.left), compileAST(expression.right));
		case 'UnaryExpression':
			return unaryOperators[expression.operator](compileAST(expression.argument));
		case 'MemberExpression':
			const object = compileAST(expression.object);
			const property = compileAST(expression.property);
			return (state) => object(state)[property(state)];
		case 'Identifier':
			return (state) => state[expression.name];
		case 'Literal':
			return () => expression.value;
		default:
			throw new Error(`Unknown expression type: ${expression.type}`);
	}
}

function compileExpression(expression) {
	// I wish I could just use `new Function()` but that's frowned upon in web extensions
	const fun = compileAST(jsep(expression));
	fun.expression = expression;
	return fun;
}

export class BoundElementRenderer {
	constructor(root) {
		// this.elements = queryXPathAll(root, './/*[@*[starts-with(name(), "data-bind:")]]');
		this.elements = [];

		if (!(root instanceof Node))
			console.trace('constructor without element');

		let stack = [];
		let el = root;
		const next = root.nextElementSibling;

		while (el ? el !== next : stack.length > 0) {
			if (!el) {
				el = stack.pop().nextElementSibling;
				continue;
			}

			let bindings = [];
			let nested = null;

			if (el.dataset) {
				Object.entries(el.dataset).forEach(([key, value]) => {
					let match = key.match(/^bind:(.+)$/);
					if (match) bindings.push({attribute: match[1], key: compileExpression(value)});
				});

				if (el !== root && 'bind:hidden' in el.dataset)
					nested = new BoundElementRenderer(el);

				if (bindings.length || nested)
					this.elements.push({el, bindings, nested})
			}

			if (el.firstElementChild && !nested) {
				stack.push(el);
				el = el.firstElementChild;
			} else {
				el = el.nextElementSibling;
			}
		}
	}

	render(state) {
		const compare = ({attribute:a}, {attribute:b}) => a < b ? -1 : a > b ? 1 : 0;

		this.elements.forEach(({el, nested, bindings}) => {
			// Sorting bindings so we set `options` before `value`, because the other
			// way around won't work.
			bindings.sort(compare).forEach(({attribute, key}) => {
				let value = undefined;
				try {
					value = key(state);
					switch (attribute) {
						case 'options':
							renderSelect(el, value);
							break;
						default:
							// Special case for <progress value=undefined> to get an indeterminate progress bar
							if (attribute === 'value' && el instanceof HTMLProgressElement && typeof value !== 'number') {
								el.removeAttribute('value');
							} else {
								if (typeof value === 'undefined')
									el.removeAttribute(attribute);
								else
									el[attribute] = value;
							}
							break;
					}
				} catch (e) {
					console.error('Error while setting',attribute, 'of', el, 'to the value of', key.expression, ':', e, value);
				}
			});

			// If this is a el[hidden] type of element, it is rendered separately
			// and only when relevant.
			if (nested && !el.hidden)
				nested.render(state);
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

/**
 * Test whether the element is visible on the page at all.
 * @returns {Boolean}
 */
export function isElementVisible(element) {
	if (element.nodeType === Node.TEXT_NODE)
		element = element.parentElement;

	// Based on jQuery (talk about battle-tested...)
	// https://github.com/jquery/jquery/blob/main/src/css/hiddenVisibleSelectors.js
	return element && !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
}

/**
 * Test whether an element intersects with the viewport.
 * @param {Node}
 * @param {{
 * 	top?: Number,
 *  bottom?: Number,
 *  left?: Number,
 *  right?: Number }} margin from edges of viewport
 * @returns {Boolean} intersects or not
 */
export function isElementInViewport(element, margin) {
	if (element.nodeType === Node.TEXT_NODE)
		element = element.parentElement;

	margin = {
		top: 0,
		left: 0,
		bottom: 0,
		right: 0,
		...(margin || {})
	};

	const viewport = {
		height: window.innerHeight || document.documentElement.clientHeight,
		width: window.innerWidth || document.documentElement.clientWidth
	};

	const rect = element.getBoundingClientRect();

	return rect.bottom >= margin.top &&
		rect.top <= viewport.height - margin.bottom &&
		rect.right >= margin.left &&
		rect.left <= viewport.width - margin.right;
}

export function createElement(name, attributes, children) {
	const el = document.createElement(name);

	// Todo nested stuff?
	for (let [key, value] of Object.entries(attributes))
		if (key in el)
			el[key] = value;
		else
			el.setAttribute(key, value);

	for (let child of (children || [])) {
		if (!(child instanceof Node))
			child = document.createTextNode(child)

		el.appendChild(child);
	}

	return el
}
