import {createElement} from '../shared/common.js';
import compat from '../shared/compat.js';

export default class SelectionTranslation {
	constructor(mediator) {
		// Mediator, has a translate(str, obj) method.
		this.mediator = mediator;

		// Storage for last translation submission, so we don't show responses
		// to previous translations if another request has been submitted.
		this.pendingId = null;

		this.placeholder = createElement('div', {
			translate: 'no'
		});

		// Panel for selection translation
		this.panel = createElement('div', {
			className: 'popup'
		});

		const closeButton = createElement('button', {
			className: 'close-button',
			ariaLabel: 'Close',
			onclick: this.close.bind(this)
		});
		this.panel.appendChild(closeButton);
		
		this.panelText = createElement('p', {
			className: 'translation'
		});
		this.panel.appendChild(this.panelText);

		const loadingRings = createElement('div', {
			className: 'lds-ring'
		});
		this.panel.appendChild(loadingRings);
		for (let i = 0; i < 4; ++i) {
				loadingRings.appendChild(document.createElement('div'));
		}

		const stylesheet = createElement('link', {
			rel: 'stylesheet',
			href: compat.runtime.getURL('SelectionTranslation.css')
		});

		const root = this.placeholder.attachShadow({mode: 'closed'});
		root.appendChild(stylesheet);
		root.appendChild(this.panel);
	}

	close() {
		if (this.placeholder.parentNode)
			this.placeholder.parentNode.removeChild(this.placeholder);
	}

	#getSelection(selection) {
		if (selection.anchorNode.nodeType === Node.ELEMENT_NODE && selection.anchorNode.matches('input, textarea'))
			return this.#getSelectionInFormElement(selection)
		else
			return this.#getSelectionInPage(selection);
	}

	#getSelectionInPage(selection) {
		const selRange = selection.getRangeAt(0);

		// Possible idea from 
		const text = selRange.toString();

		// Get bounding box of selection (in position:fixed terms!)
		const box = selRange.getBoundingClientRect();

		return {text, box};
	}

	#getSelectionInFormElement(selection) {
		const field = selection.anchorNode;

		const text = field.value.slice(field.selectionStart, field.selectionEnd);

		const box = field.getBoundingClientRect();

		return {text, box};
	}

	start(selection) {
		const {text, box} = this.#getSelection(selection);
		
		// Unique id for this translation request so we know which one the popup
		// is currently waiting for.
		const id = `selection-panel-${new Date().getTime()}`;
		this.pendingId = id;
		
		// Reset popup state, and show it in a loading state.
		this.panelText.textContent = '';
		this.panel.classList.add('loading');
		document.body.appendChild(this.placeholder);

		// Position popup directly under the selection
		// TODO: Maybe above or right of selection if it is in one of the corners
		//       of the screen?
		Object.assign(this.panel.style, {
				top: `${box.bottom+window.scrollY}px`, // scrollY to go from position:fixed to position:absolute
				left: `${box.left+window.scrollX}px`,
				width: `${box.width}px`
		});

		this.mediator.translate(text, {id, html: false});
	}

	 enqueueTranslationResponse({request: {user: {id}}, target, error}) {
		if (id !== this.pendingId)
			return;

		this.panel.classList.remove('loading');

		if (error) {
			this.close();
		} else {
			this.panelText.textContent = target.text;
		}
	 }
}