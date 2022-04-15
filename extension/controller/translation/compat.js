class NotImplementedError extends Error {
	constructor() {
		super('Not implemented');
	}
}

const compat = new class {
	#isFirefox = false;
	#isChromium = false;
	#runtime;

	constructor() {
		if (typeof browser !== 'undefined') {
			this.#isFirefox = true;
			this.#runtime = browser;
		} else if (typeof chrome !== 'undefined') {
			this.#isChromium = true;
			this.#runtime = chrome;
		} else {
			throw new NotImplementedError();
		}
	}

	get storage() {
		if (this.#isChromium)
			return new Proxy(chrome.storage, {
				get(target, prop, receiver) {
					return new Proxy(Reflect.get(chrome.storage, prop, receiver), {
						get(target, prop, receiver) {
							if (prop === 'get')
								return (keys) => new Promise(accept => target.get(keys, accept));
							else
								return Reflect.get(target, prop);
						}
					});
				}
			});
		else
			return this.#runtime.storage;
	}

	get runtime() {
		return this.#runtime.runtime;
	}

	get webNavigation() {
		return this.#runtime.webNavigation;
	}

	get tabs() {
		return this.#runtime.tabs;
	}

	get i18n() {
		return this.#runtime.i18n;
	}

	get pageAction() {
		return this.#runtime.pageAction;
	}
};