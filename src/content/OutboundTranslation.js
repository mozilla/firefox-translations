import { BoundElementRenderer, isElementInViewport, debounce } from '../shared/common.js';
import compat from '../shared/compat.js';
import { SupersededError } from '@browsermt/bergamot-translator';

function createElement(name, attributes, children) {
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

const regionNamesInEnglish = new Intl.DisplayNames([...navigator.languages, 'en'], {type: 'language'});

const name = (code) => {
	if (!code)
		return undefined;
	
	try {
		return regionNamesInEnglish.of(code);
	} catch (RangeError) {
		return `[${code}]`; // fallback if code is not known or invalid
	}
};

export default class OutboundTranslation {
	/**
	 * @typedef {{
	 * 	translate: (text: String) => Promise<String>,
	 *  backtranslate: (text: String) => Promise<String>
	 * }} OutboundTranslationDelegate
	 */

	/**
	 * Current target form element where translated text goes.
	 * @type {HTMLElement?}
	 */
	#target;

	/**
	 * @type {String}
	 */
	#from;

	/**
	 * @type {String}
	 */
	#to;

	/**
	 * DOM root of outbound translation pane.
	 * @type {ShadowRoot}
	 */
	#tree;

	/**
	 * Text area that the user types untranslated text into.
	 * @type {HTMLTextAreaElement}
	 */
	#inputField;

	/**
	 * Preview pane that shows the backtranslated text.
	 * @type {HTMLElement}
	 */
	#referenceField;

	/**
	 * Translation delegate
	 * @type {OutboundTranslationDelegate}
	 */
	delegate;

	/**
	 * Public root of translation pane.
	 * @type {HTMLElement}
	 */
	element;

	/**
	 * @type {Number}
	 */
	height = 300;

	/**
	 * @param {OutboundTranslationDelegate} delegate
	 */
	constructor(delegate) {
		this.delegate = delegate;

		this.element = createElement('div', {'translate': 'no'});
		
		this.#tree = this.element.attachShadow({mode: 'closed'});

		this.#tree.appendChild(createElement('link', {
			rel: 'stylesheet',
			href: compat.runtime.getURL('OutboundTranslation.css')
		}));

		this.#tree.appendChild(createElement('div', {className: 'pane'}, [
			createElement('p', {className: 'input-field-label'}, [
				'Translating what you type from ',
				createElement('em', {'data-bind:text-content': 'from'}),
				' to ',
				createElement('em', {'data-bind:text-content': 'to'}),
				':'
			]),
			this.#inputField = createElement('textarea', {
				className: 'input-field',
				placeholder: 'Type here to begin translating…',
				onkeydown: this.#onKeyDown.bind(this),
				oninput: this.#onInput.bind(this)
			}),
			createElement('p', {className: 'reference-field-label'}, [
				'Translating the translated text from ',
				createElement('em', {'data-bind:text-content': 'to'}),
				' back to ',
				createElement('em', {'data-bind:text-content': 'from'}),
				' to validate the translation:'
			]),
			this.#referenceField = createElement('div', {
				className: 'reference-field'
			}),
			createElement('button', {
				className: 'primary close-button',
				onclick: this.close.bind(this)
			}, [
				'Close'
			])
		]));

		const renderer = new BoundElementRenderer(this.#tree);

		this.render = debounce(() => {
			renderer.render({
				from: name(this.#from),
				to: name(this.#to)
			})
		});
	}

	get from() {
		return this.#from;
	}

	set from(from) {
		this.#from = from;
		this.render();
	}

	get to() {
		return this.#to;
	}

	set to(to) {
		this.#to = to;
		this.render();
	}

	get target() {
		return this.#target;
	}

	/**
	 * @param {HTMLElement?} target
	 */
	set target(target) {
		// Remove event listeners from the old element
		if (this.#target) {
			this.#target.removeEventListener('focus', this.#onFocusTarget);
		}

		this.#target = target;

		// Attach event listeners to the new target (if there is one)
		if (this.#target) {
			this.#target.addEventListener('focus', this.#onFocusTarget);
		}

		if (this.#target && !this.element.parentNode)
			this.open();
		else if (!this.#target && this.element.parentNode)
			this.close();
	}

	open() {
		// Update document bottom padding & set height on panel
		this.resize();

		document.body.appendChild(this.element);
		this.#inputField.value = this.#target.value;
		this.#inputField.focus();
	}

	close() {
		this.element.parentNode.removeChild(this.element);

		this.#target?.focus();
	}

	resize() {
		this.element.style.setProperty('--outbound-translation-height', `${this.height}px`);
	}

	#onFocusTarget(e) {
		setTimeout(() => this.#inputField.focus());
	}

	#onKeyDown(e) {
		switch (e.key) {
			case 'Escape':
				this.close();
				break;
			case 'Tab':
				// TODO: emulate tab on original field to go to next field and
				// optionally update OutboundTranslation.target with it.
				break;
			default:
				console.log('#onKeyDown', e.key);
				break;
		}
	}

	async #onInput(e) {
		try {
			// Make sure target is visible (mimics behaviour you normally get when
			// typing into a text field that's currently not in view.)
			if (!isElementInViewport(this.#target))
				this.#target.scrollIntoView();

			const translated = await this.delegate.translate(this.#inputField.value)
			this.#target.value = translated;

			const backtranslated = await this.delegate.backtranslate(translated);
			this.#referenceField.textContent = backtranslated;
		} catch (err) {
			if (err instanceof SupersededError)
				return;
			
			throw err;
		}
	}
}