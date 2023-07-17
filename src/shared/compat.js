class NotImplementedError extends Error {
	constructor() {
		super('Not implemented');
	}
}

function promisify(object, methods) {
	return new Proxy(object, {
		get(target, prop, receiver) {
			// Note: I tried using Reflect.get() here, but Chrome doesn't like that.
			if (methods.includes(prop))
				return (...args) => new Promise((accept, reject) => {
					target[prop](...args, (retval) => {
						if (chrome.runtime.lastError)
							reject(chrome.runtime.lastError);
						else
							accept(retval);
					})
				});
			else
				return target[prop];
		}
	});
}

export default new class {
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
					if (['sync', 'local', 'managed'].includes(prop))
						return promisify(chrome.storage[prop], ['get', 'set', 'remove']);
					else
						return chrome.storage[prop]
				}
			});
		else
			return this.#runtime.storage;
	}

	get runtime() {
		return this.#runtime.runtime;
	}

	get tabs() {
		if (this.#isChromium)
			return promisify(chrome.tabs, ['query']);
		else
			return this.#runtime.tabs;
	}

	get i18n() {
		if (this.#isChromium)
			return promisify(chrome.i18n, ['detectLanguage', 'getAcceptLanguages']);
		else
			return this.#runtime.i18n;
	}

	get action() {
		return this.#runtime.action;
	}

	get contextMenus() {
		return this.#runtime.contextMenus;
	}
};