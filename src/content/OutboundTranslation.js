import { isElementInViewport } from '../shared/common.js';
import compat from '../shared/compat.js';

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

		this.#tree.appendChild(createElement('div', {
			className: 'pane'
		}, [
			createElement('div', {
				className: 'outbound-translation-widget'
			}, [
				this.#inputField = createElement('textarea', {
					className: 'input-field',
					onkeydown: this.#onKeyDown.bind(this),
					oninput: this.#onInput.bind(this)
				}),
				this.#referenceField = createElement('div', {
					className: 'reference-field'
				})
			]),
			createElement('button', {
				className: 'primary close-button',
				onclick: this.close.bind(this)
			}, [
				'Close'
			])
		]));
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
			console.warn('#onInput', err);
		}
	}
}