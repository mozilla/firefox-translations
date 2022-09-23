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

function paint() {
	return new Promise((accept) => requestAnimationFrame(accept));
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

	#focusRing;

	/**
	 * Bound `#onFocusTarget` method.
	 * @type {(event:FocusEvent) => Null}
	 */
	#onFocusTargetListener;

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
				onclick: this.stop.bind(this)
			}, [
				'Close'
			])
		]));

		const renderer = new BoundElementRenderer(this.#tree);

		// Prevent focusin events from leaking out of the widget
		this.#tree.addEventListener('focusin', e => e.stopPropagation(), true);

		this.render = debounce(() => {
			renderer.render({
				from: name(this.#from),
				to: name(this.#to)
			})
		});

		this.#focusRing = this.#tree.appendChild(createElement('div', {className: 'focus-ring'}));

		this.#onFocusTargetListener = this.#onFocusTarget.bind(this);
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

	#isSupportedElement(element) {
		return element.matches('textarea, input[type=text], input[type=search]');
	}

	#setTarget(target) {
		if (target && this.#isSupportedElement(target)) {
			this.#target = target;
			this.show();
			this.#restore();	
		} else {
			this.#target = null;
			this.hide();
		}
	}

	/**
	 * Turns on Outbound translation for the page.
	 */
	start() {
		document.body.addEventListener('focusin', this.#onFocusTargetListener);
		this.#setTarget(document.activeElement)
	}

	/**
	 * Disables Outbound translation for the page.
	 */
	stop() {
		document.body.removeEventListener('focusin', this.#onFocusTargetListener);
		this.hide();
	}

	/**
	 * Shows the pane
	 */
	show() {
		// Update document bottom padding & set height on panel
		this.resize();

		document.body.appendChild(this.element);
		this.#inputField.focus();

		const rect = this.#target.getBoundingClientRect();

		Object.assign(this.#focusRing.style, {
			top: `${rect.top + (document.documentElement.scrollTop || document.body.scrollTop)}px`,
			left: `${rect.left + (document.documentElement.scrollLeft || document.body.scrollLeft)}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`
		});
	}

	/**
	 * Hides the pane
	 */
	hide() {
		this.element.parentNode?.removeChild(this.element);
		this.#target?.focus();
	}

	resize() {
		this.element.style.setProperty('--outbound-translation-height', `${this.height}px`);
	}

	#restore() {
		// If the target field has a value, backtranslate it and populate the
		// input field with it.
		if (this.#target.value) {
			Object.assign(this.#inputField, {
				value: '',
				disabled: true
			});

			this.delegate.backtranslate(this.#target.value)
				.then(text => {
					this.#inputField.value = text
				})
				.finally(() => {
					this.#inputField.disabled = false;
					this.#inputField.focus();
				});
		} else {
			// If it doesn't just make sure the input field is empty
			this.#inputField.value = '';
			this.#inputField.focus();
		}
	}

	#onFocusTarget(event) {
		// Ignore focusin events coming from ourselves
		if (this.#tree.contains(event.target))
			return;

		// Ignore re-focussings on the current target?
		if (event.target === this.#target) {

			return;
		}

		console.log('onFocusTarget', event.target);
		
		this.#setTarget(event.target);
	}

	#onKeyDown(e) {
		switch (e.key) {
			case 'Escape':
				this.stop();
				break;
			case 'Tab':
				this.hide(); // calls target.focus() just in time for the tab to register and jump to the next field
				break;
		}
	}

	async #onInput(e) {
		if (!this.#target)
			throw new Error('Called #onInput without having a #target');

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