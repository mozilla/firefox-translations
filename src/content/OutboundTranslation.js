import { createElement, BoundElementRenderer, isElementInViewport, debounce } from '../shared/common.js';
import compat from '../shared/compat.js';
import { SupersededError } from '@browsermt/bergamot-translator';

function moveCursorToEnd(target) {
	if ('value' in target) {
		const length = target.value.length;
		target.setSelectionRange(length, length);
	} else if (target.isContentEditable) {
		const range = document.createRange();
		if (!target.lastChild) return; // it is empty
		range.setEnd(target.lastChild,
			target.lastChild.nodeType === Node.TEXT_NODE 
			? target.lastChild.nodeValue.length
			: 1);
		range.collapse();
		const selection = window.getSelection();
		selection.removeAllRanges();
		selection.addRange(range);
	}
}

function getEffectiveBackgroundColor(el) {
	while (el instanceof Element) {
		const style = getComputedStyle(el);
		if (style.backgroundColor !== 'transparent' && !/^rgba\(.*,\s*0(\.\d+)?\)$/.test(style.backgroundColor))
			return style.backgroundColor;
		else
			el = el.parentNode;
	}
}

function setValueInput(target, value) {
	// Reflect.apply(Reflect.getOwnPropertyDescriptor(this.#target.__proto__, 'value').get, this.#target, [value])
	target.value = value;

	// Notify any external scripts of the change
	const event = new Event("input", {bubbles: true});
  target.dispatchEvent(event);
}

function isDraftJS(target) {
	return target.matches('.public-DraftEditor-content');
}

function setValueContentEditable(target, value) {
	// Source: https://github.com/facebook/draft-js/issues/616
	return new Promise(accept => {
		const selection = window.getSelection();
		const range = document.createRange();
		range.selectNodeContents(target);
		selection.removeAllRanges();
		selection.addRange(range);

		// Wait for selection before dispatching the `beforeinput` event
		if (isDraftJS(target)) {
			document.addEventListener("selectionchange", () => {
				target.dispatchEvent(new InputEvent("beforeinput", {
					inputType: "insertText",
					data: value,
					bubbles: true,
					cancelable: true
				}));
				accept();
			}, {once: true});
		} else {
			document.execCommand('insertText', false, value);
			accept();
		}
	});
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
	 * 	translate: ({from: String, to: String, text: String}) => Promise<String>,
	 *  backtranslate: ({from: String, to: String, text: String}) => Promise<String>
	 * }} OutboundTranslationDelegate
	 */

	/**
	 * Current target form element where translated text goes.
	 * @type {HTMLElement?}
	 */
	#target;

	/**
	 * Language of the page. Confusing enough this is the language we translate
	 * the typed text into!
	 * @type {String}
	 */
	#pageLanguage;

	/**
	 * Language the page is translated to. This is the language the user is typing
	 * in, and thus the `from` language when backtranslating.
	 * @type {String}
	 */
	#userLanguage;

	/**
	 * @type {String[]}
	 */
	#userLanguageOptions = [];

	/**
	 * DOM root of outbound translation pane.
	 * @type {ShadowRoot}
	 */
	#tree;

	/**
	 * DOM element of the pane at the bottom of the screen.
	 * @type {HTMLElement}
	 */
	#pane;

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
	 * Overlay that shows the text is as it will be inserted in the page
	 * @type {HTMLElement}
	 */
	#previewField;

	/**
	 * Text content of the preview field.
	 * @type {String}
	 */
	#previewValue;

	/**
	 * Dropdown to select language of user input
	 * @type {HTMLSelectElement}
	 */
	#userLanguageDropdown;

	/**
	 * @type {HTMLElement}
	 */
	#focusRing;

	/**
	 * @type {(state: Object) => Null}
	 */
	#render;

	/**
	 * Number of loading translations. Since one can cancel the other async we use
	 * a number.
	 * @type {Number}
	 */
	#loading = 0;

	/**
	 * Bound `#onFocusTarget` method.
	 * @type {(event:FocusEvent) => Null}
	 */
	#onFocusTargetListener;

	/**
	 * Watches the target for size changes.
	 * @type {ResizeObserver}
	 */
	#targetResizeObserver;

	/**
	 * Called if the target or the page resizes.
	 * @type {(entries: ResizeObserverEntries[], observer:ResizeObserver) => Null}
	 */
	#onResizeListener;

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
	 * @type {WeakMap<Element,{value: String, translated: String, backtranslated: String}>}
	 */
	memory = new WeakMap();

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

		// Ring drawn around the form field we're currently editing
		this.#focusRing = this.#tree.appendChild(createElement('div', {className: 'focus-ring'}, [
			createElement('span', {className: 'label'}, ['Editing with TranslateLocally']),
			this.#previewField = createElement('div', {className: 'preview-field'}, [])
		]));

		// Invisible area that can be dragged up or down to resize the pane
		const resizeBar = createElement('div', {className: 'resize-bar'});

		// Panel that shows outbound translation widgets
		this.#tree.appendChild(this.#pane = createElement('dialog', {
			className: 'pane',
			open: true
		}, [
			resizeBar,
			createElement('div', {className: 'outbound-translation-widget'}, [
				createElement('p', {className: 'input-field-label'}, [
					'Translating what you type from ',
					// createElement('em', {'data-bind:text-content': 'to'}),
					this.#userLanguageDropdown = createElement('select', {
						'data-bind:value': 'userLanguage',
						'data-bind:options': 'userLanguageOptions'
					}),
					' to ',
					createElement('em', {'data-bind:text-content': 'pageLanguageName'}),
					':'
				]),
				this.#inputField = createElement('textarea', {
					className: 'input-field',
					placeholder: 'Type here to begin translating…'
				}),
				createElement('p', {className: 'reference-field-label'}, [
					'Translating the translated text from ',
					createElement('em', {'data-bind:text-content': 'pageLanguageName'}),
					' back into ',
					createElement('em', {'data-bind:text-content': 'userLanguageName'}),
					' to validate the translation:'
				]),
				this.#referenceField = createElement('div', {
					className: 'reference-field'
				}),
				createElement('button', {
					className: 'primary close-button',
					onclick: this.stop.bind(this)
				}, ['Close'])
			])
		]));

		const renderer = new BoundElementRenderer(this.#tree);

		// Re-render when `from` or `to` change
		this.#render = debounce(() => {
			const renderState = {
				userLanguage: this.#userLanguage,
				userLanguageOptions: this.#userLanguageOptions.map(lang => [lang, name(lang)]),
				userLanguageName: name(this.#userLanguage),
				pageLanguageName: name(this.#pageLanguage),
			};

			renderer.render(renderState)
		});

		// Capture [Escape] and [Tab] keypresses
		this.#inputField.addEventListener('keydown', this.#onKeyDown.bind(this));

		// Capture input in the textfield we need to translate
		this.#inputField.addEventListener('input', this.#onInput.bind(this));

		// Sync scrolling of input field with reference field.
		this.#inputField.addEventListener('scroll', this.#syncScrollPosition.bind(this), {passive: true})

		// Observer that's registered with window for resize changes
		// TOOD: Is this necessary or is the ResizeObserver on the form field sufficient?
		this.#onResizeListener = this.#renderFocusRing.bind(this);

		// Observer for changes to the form field to keep the focus ring in sync
		this.#targetResizeObserver = new ResizeObserver(this.#onResizeListener);

		// TODO: Detect if #target becomes invisible/inaccessible (DOM changes)

		// TODO: Detect if #target becomes disabled/readonly (DOM changes)

		this.#onFocusTargetListener = this.#onFocusTarget.bind(this);

		this.#userLanguageDropdown.addEventListener('input', e => {
			if (!this.delegate.onUserLanguageChange || this.delegate.onUserLanguageChange(e.target.value) !== false)
				this.setUserLanguage(e.target.value);
		});

		// Add resize behaviour to the invisible resize bar
		resizeBar.addEventListener('mousedown', e => {
			e.preventDefault(); // Prevent selecting stuff

			const startHeight = this.height;
			const startY = e.screenY;

			const onMouseMove = (e) => {
				const height = startHeight - (e.screenY - startY);
				this.height = Math.max(200, Math.min(0.9 * document.documentElement.clientHeight, height));
				this.element.style.setProperty('--outbound-translation-height', `${this.height}px`);
				// TODO: Remember height between pages?
			}

			const onMouseUp = () => {
				window.removeEventListener('mousemove', onMouseMove);
				window.removeEventListener('mouseup', onMouseUp);
			}

			window.addEventListener('mousemove', onMouseMove);
			window.addEventListener('mouseup', onMouseUp);
		});

		// Prevent certain events from leaking out of the widget so they can't be
		// captured and cancelled by the parent page. Does not prevent handlers
		// installed with {capture:true} though. Those could still wreak havoc.
		['focusin', 'keydown', 'keyup', 'keypress', 'click', 'mousedown'].forEach(event => {
			this.#tree.addEventListener(event, e => { e.stopPropagation(); });
		});
	}

	/**
	 * Sets the target language for backtranslation
	 * @param {String} language
	 */
	setPageLanguage(language) {
		this.#pageLanguage = language;
		this.#render();
	}

	/**
	 * @param {String} language
	 */
	setUserLanguage(language) {
		this.#userLanguage = language;
		this.#render();
	}

	/**
	 * @param {String[]} languages the user can type in
	 */
	setUserLanguageOptions(languages) {
		this.#userLanguageOptions = Array.from(languages);
		this.#render();
	}

	/**
	 * Turns on Outbound translation for the page.
	 */
	start() {
		document.body.addEventListener('focusin', this.#onFocusTargetListener);
		document.defaultView.addEventListener('resize', this.#onResizeListener);

		this.#setTarget(document.activeElement)
	}

	/**
	 * Disables Outbound translation for the page.
	 */
	stop() {
		// Move focus back to original #target.
		this.hide();

		// Using setTarget(null) to trigger a final update of the value of the old
		// target field. Will also call hide() but without the #target set, which is
		// why we call it ourselves earlier.
		// Note: might mess with event listeners, so calling before removing the
		// listeners.
		this.#setTarget(null);

		document.body.removeEventListener('focusin', this.#onFocusTargetListener);
		document.defaultView.removeEventListener('resize', this.#onResizeListener);
	}

	/**
	 * Shows the pane
	 */
	show() {
		// Update document bottom padding & set height on panel
		this.element.style.setProperty('--outbound-translation-height', `${this.height}px`);

		document.body.appendChild(this.element);

		this.#restore(); // async, does focus() when time is ready
		
		this.#renderFocusRing();

		this.#scrollIfNecessary();
	}

	/**
	 * Hides the pane
	 */
	hide() {
		this.element.parentNode?.removeChild(this.element);
		
		if (this.#target) {
			this.#target.focus();
			moveCursorToEnd(this.#target);
		}
	}

	/**
	 * Can this element be edited by this widget?
	 */
	#isSupportedElement(element) {
		return element.matches('textarea, input:not([type]), input[type=text], input[type=search], [contenteditable=""], [contenteditable="true"]');
	}

	#usePreviewField() {
		return this.#target?.isContentEditable;
	}

	#renderPreviewField() {
		const targetStyle = getComputedStyle(this.#target);

		const previewStyle = {};

		for (let key of targetStyle)
			if (['text', 'font', 'color', 'padding', 'line-'].some(prefix => key.startsWith(prefix)))
				previewStyle[key] = targetStyle.getPropertyValue(key)

		previewStyle['background-color'] = getEffectiveBackgroundColor(this.#target) || 'Canvas';

		Object.assign(this.#previewField.style, previewStyle);
	}

	/**
	 * Change the target to another form element, or null to hide the
	 * outbound translation widget temporarily but pop back up when we
	 * select a supported element again.
	 */
	#setTarget(target) {
		if (this.#target) {
			this.#targetResizeObserver.unobserve(this.#target);

			// If we're moving away from a [contenteditable] target, finalize setting
			// its contents.
			if (this.#usePreviewField() && this.#previewValue !== null)
				this.#setTargetValue(this.#previewValue);
		}

		if (target && this.#isSupportedElement(target)) {
			this.#target = target;

			this.#targetResizeObserver.observe(this.#target);

			if (this.#usePreviewField()) {
				this.#previewField.hidden = false;

				// Make the preview field match the style of the original textbox
				this.#renderPreviewField();
				
				// Set previewValue to Null to mark it as unchanged
				this.#previewValue = null;

				// Reflect the current text of the preview in the field? Not sure about
				// this, as it could be copying a placeholder text.
				this.#previewField.textContent = this.#getTargetValue();
			} else {
				this.#previewField.hidden = true;
			}

			this.show();
		} else {
			this.#target = null;
			this.hide();
		}
	}

	/**
	 * Reads the target's current value.
	 * @return {String}
	 */
	#getTargetValue() {
		if ('value' in this.#target)
			return this.#target.value;
		else if ('innerText' in this.#target)
			return this.#target.innerText; // or textContent? Should text hidden by styling be returned?
		else
			throw new Error(`No accessor implemented for type ${this.#target.__proto__.constructor.name}`);
	}

	/**
	 * Sets target's value, simulating as if it was done normally, triggering
	 * all the right events.
	 * @param {String} value
	 */
	#setTargetValue(value) {
		if ('value' in this.#target) {
			setValueInput(this.#target, value);
	  } else if (this.#target.isContentEditable) {
	  	setValueContentEditable(this.#target, value);
		}
		else
			throw new Error(`No accessor implemented for type ${this.#target.__proto__.constructor.name}`);
	}

	#setPreviewValue(value) {
		this.#previewValue = value;
		this.#previewField.innerText = value;
	}

	/**
	 * If the target field has a value, backtranslate it and populate the
	 * input field with it.
	 */
	async #restore() {
		// Text content of the element that's on the page (and in the foreign language)
		const inPageValue = this.#getTargetValue();
	
		// If we've edited the field before, and it hasn't changed since then, pick
		// up where we left off.
		if (inPageValue && this.memory.get(this.#target)?.translated === inPageValue) {
			const {value, reference} = this.memory.get(this.#target);
			this.#inputField.value = value;
			this.#referenceField.textContent = reference;
		}
		
		// If the field has a value, backtranslate it to populate the input widget.
		else if (inPageValue) {
			// During backtranslation disable the input field for a minute to avoid
			// confusion.
			Object.assign(this.#inputField, {
				value: '',
				disabled: true,
				placeholder: 'Translating original input…'
			});

			try {
				const text = await this.delegate.backtranslate({
					from: this.#pageLanguage,
					to: this.#userLanguage,
					text: inPageValue
				});
				this.#inputField.value = text
				this.#referenceField.textContent = text;
			} finally {
				Object.assign(this.#inputField, {
					disabled: false,
					placeholder: 'Type here to begin translating…'
				});
			}
		}
		
		// The field is just empty, make sure our widgets are empty as well.
		else {
			// If it doesn't just make sure the input field is empty
			this.#inputField.value = '';
			this.#referenceField.textContent = '';
		}

		this.#inputField.focus();
		this.#syncScrollPosition();
	}

	/**
	 * Update the position of the fake focus we draw around the form element
	 * that's currently being edited.
	 */
	#renderFocusRing() {
		const rect = this.#target.getBoundingClientRect();

		Object.assign(this.#focusRing.style, {
			top: `${rect.top + (document.documentElement.scrollTop || document.body.scrollTop)}px`,
			left: `${rect.left + (document.documentElement.scrollLeft || document.body.scrollLeft)}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`
		});
	}

	/**
	 * Scroll the page to show the form element again if necessary.
	 */
	#scrollIfNecessary() {
		// `20` is about a line height, `320` is line height + bottom panel
		if (!isElementInViewport(this.#target, {top: 20, bottom: 320}))
			this.#target.scrollIntoView();

		// TODO: replace this by something that prefers to scroll it closer to
		// the panel or the bottom of the window, but not behind the panel.
	}

	/**
	 * Sync the scroll position of the reference field to that of the input field.
	 */
	#syncScrollPosition() {
		this.#referenceField.scrollTop = this.#inputField.scrollTop;
	}

	/**
	 * Called when a new element on the page gains focus.
	 * @param {FocusEvent} event
	 */
	#onFocusTarget(event) {
		// Ignore focusin events coming from ourselves
		if (this.#tree.contains(event.target))
			return;

		// Clicking on target (or website triggering focus) will transport focus
		// back to outbound translation widget.
		if (event.target === this.#target) {
			this.#inputField.focus()
			return;
		}

		this.#setTarget(event.target);
	}

	/**
	 * Called when a key is pressed in the input field of the outbound translation
	 * widget. We use it to catch special keys like Escape and Tab.
	 * @param {KeyboardEvent} e
	 */
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

	/**
	 * Called when typing or pasting in the form field. Triggers translation.
	 * @param {InputEvent} e
	 */
	async #onInput(e) {
		if (!this.#target)
			throw new Error('Called #onInput without having a #target');

		if (!this.#pageLanguage || !this.#userLanguage || !this.#userLanguageOptions.includes(this.#userLanguage)) {
			console.error('#onInput called but `pageLanguage` or `userLanguage` is invalid');
			return;
		}

		try {
			// Make sure target is visible (mimics behaviour you normally get when
			// typing into a text field that's currently not in view.)
			this.#scrollIfNecessary()

			this.#pane.classList.toggle('loading', ++this.#loading);
			
			// local copies in case it changes during translate()
			const value = this.#inputField.value;
			const target = this.#target;

			const translated = await this.delegate.backtranslate({
				from: this.#userLanguage,
				to: this.#pageLanguage,
				text: value
			});

			// Quick check we're still editing the same field after the translation
			// finally came back.
			if (this.#target !== target)
				return;

			if (this.#usePreviewField())
				this.#setPreviewValue(translated);
			else
				this.#setTargetValue(translated);

			const reference = await this.delegate.translate({
				from: this.#pageLanguage,
				to: this.#userLanguage,
				text: translated
			});

			this.#referenceField.textContent = reference;
			this.#syncScrollPosition();

			// Store for later
			this.memory.set(this.#target, {
				value,
				translated,
				reference
			});
		} catch (err) {
			if (err instanceof SupersededError)
				return;
			
			throw err;
		} finally {
			this.#pane.classList.toggle('loading', --this.#loading);
		}
	}
}