// For untar.js
workerScriptUri = browser.runtime.getURL('3rd_party/js-untar/untar-worker.js');

const defaults = {
	cacheSize: 0
};

const implementations = [
	{
		name: "WASM, 1 worker",
		factory: () => new WASMTranslationHelper({...defaults, workers: 1, useNativeIntGemm: false})
	},
	{
		name: "WASM, 1 worker, native intgemm",
		factory: () => new WASMTranslationHelper({...defaults, workers: 1, useNativeIntGemm: true})
	},
	{
		name: "WASM, 4 workers",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: false})
	},
	{
		name: "WASM, 4 workers, native intgemm, batch-size: 8",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: true, batchSize: 8})
	},
	{
		name: "WASM, 4 workers, native intgemm, batch-size 16",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: true, batchSize: 16})
	},
	{
		name: "WASM, 4 workers, native intgemm, batch-size 32",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: true, batchSize: 32})
	},
	{
		name: "WASM, 4 workers, native intgemm, batch-size 128",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: true, batchSize: 128})
	},
	{
		name: "WASM, 4 workers, native intgemm, batch-size 256",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: true, batchSize: 256})
	},
	{
		name: "Native Messaging, 1 worker",
		factory: () => new TLTranslationHelper({...defaults, workers: 1})
	},
	{
		name: "Native Messaging, 4 workers",
		factory: () => new TLTranslationHelper({...defaults, workers: 4})
	},
];

function readFileAsText(file) {
	return new Promise((accept, reject) => {
		const reader = new FileReader();
		reader.addEventListener('load', e => {
			accept(reader.result);
		});
		reader.readAsText(file);
	})
}

async function readTestSet(file) {
	const parser = new DOMParser();
	
	const document = parser.parseFromString(await readFileAsText(file), 'application/xml');

	const texts = [];

	document.querySelectorAll('dataset > doc > src > p').forEach(p => {
		const segments = [];
		p.querySelectorAll('seg').forEach(seg => {
			segments.push(seg.textContent);
		});
		texts.push(segments.join(' '));
	});

	return texts;
}

function countWords(text, html) {
	if (html) {
		text = text.replace(/<(script|style|code|svg|textarea)[^>]*>.+?<\/\1>/ig, ' ');
		text = text.replace(/<\/?[^>]+>/g, ' ');
	}
	return text.split(/\b\W+\b/).length;
}

function observe(obj, callback) {
	return new Proxy(obj, {
		get(target, prop, receiver) {
			const val = Reflect.get(target, prop);

			if (prop === 'prototype')
				return val;

			try {
				return new Proxy(val, this);
			} catch (e) {
				if (e instanceof TypeError)
					return val;
				else
					throw e;
			}
		},
		set(target, prop, value) {
			target[prop] = value;
			callback(obj);
			return true;
		}
	});
}

const state = observe({
	from: 'de',
	to: 'en',
	html: true,
	busy: false,
	texts: [],
	chunks: undefined,
	words: undefined,
}, renderBoundElements.bind(document.querySelector('#controls')));

addBoundElementListeners.call(document.querySelector('#controls'), (name, value) => {
	state[name] = value;
});

renderBoundElements.call(document.querySelector('#controls'), state);

const results = implementations.map(implementation => {
	const row = document.querySelector('#results-row').content.firstElementChild.cloneNode(true);
	document.querySelector('#results tbody').appendChild(row);

	const render = renderBoundElements.bind(row);

	const data = observe({
		enabled: true,
		busy: false,
		name: implementation.name,
		startup: undefined,
		first: undefined,
		time: undefined,
		wps: undefined,
		done: 0,
		total: 0
	}, debounce(render));

	// Initial render of row
	render(data);

	// Connect checkboxes to `data`
	addBoundElementListeners.call(row, (name, value) => data[name] = value);

	return {row, data, implementation};
});

addEventListeners({
	'input #test-set-selector': e => {
		Array.from(e.target.files).forEach(async file => {
			state.busy = true;
			state.texts = await readTestSet(file);
			state.chunks = state.texts.length;
			state.words = state.texts.reduce((words, text) => words + countWords(text, state.html), 0);
			state.busy = false;
		});
	},
	'click #run-test': async e => {
		state.busy = true;
		for (let {data, implementation} of results) {
			if (!data.enabled) continue;

			data.busy = true;

			const init = performance.now();

			const translator = implementation.factory();
			await translator.translate({
				from: state.from,
				to: state.to,
				text: 'This is a warm-up sentence.',
				html: false
			});
			
			const start = performance.now();

			data.startup = start - init;

			const promises = state.texts.map(async text => {
				data.total = data.total + 1;
				await translator.translate({
					from: state.from,
					to: state.to,
					text,
					html: state.html
				});
				data.done = data.done + 1; // sorry necessary for observe()
			});

			await Promise.any(promises); // any() instead of race() because I want a response, not an error
			data.first = performance.now() - start;

			await Promise.all(promises);
			data.time = performance.now() - start;

			data.wps = Math.round(state.words / (data.time / 1000));

			data.busy = false;
		}
		state.busy = false;
	}
});