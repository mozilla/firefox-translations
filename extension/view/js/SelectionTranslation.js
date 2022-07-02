class SelectionTranslation {
	constructor(mediator) {
		// Mediator, has a translate(str, obj) method.
		this.mediator = mediator;

		// Storage for last translation submission, so we don't show responses
		// to previous translations if another request has been submitted.
		this.pendingId = null;

		// Panel for selection translation
		this.panel = document.createElement('div');
		this.panel.id = 'x-bergamot-translation-popup';
		this.panel.translate = 'no'; // to prevent InPageTranslation to pick up on it
		this.panel.setAttribute('translate', 'no'); // (For old Firefox)

		const closeButton = document.createElement('button');
		this.panel.appendChild(closeButton);
		closeButton.className = 'close-button';
		closeButton.ariaLabel = 'Close';
		closeButton.addEventListener('click', e => {
				document.body.removeChild(this.panel);
		});

		this.panelText = document.createElement('p');
		this.panelText.className = 'translation';
		this.panel.appendChild(this.panelText);

		const loadingRings = document.createElement('div');
		loadingRings.className = 'lds-ring';
		this.panel.appendChild(loadingRings);
		for (let i = 0; i < 4; ++i) {
				loadingRings.appendChild(document.createElement('div'));
		}
	}

	start(selection) {
		const selRange = selection.getRangeAt(0);

		// Possible idea from 
		const text = selRange.toString();

		// Get bounding box of selection (in position:fixed terms!)
		const box = selRange.getBoundingClientRect();
		
		// Unique id for this translation request so we know which one the popup
		// is currently waiting for.
		const id = `selection-panel-${new Date().getTime()}`;
		this.pendingId = id;
		
		// Reset popup state, and show it in a loading state.
		this.panelText.textContent = '';
		this.panel.classList.add('loading');
		document.body.appendChild(this.panel);

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

	 enqueueTranslationResponse(translated, {id}) {
		if (id !== this.pendingId)
			return;

		this.panel.classList.remove('loading');
		this.panelText.textContent = translated;
	 }
}