// For untar.js
workerScriptUri = browser.runtime.getURL('3rd_party/js-untar/untar-worker.js');

const implementations = [
	{
		name: "WASM, 1 worker",
		factory: () => new WASMTranslationHelper({workers: 1, useNativeIntGemm: false})
	},
	{
		name: "WASM, 1 worker, native intgemm",
		factory: () => new WASMTranslationHelper({workers: 1, useNativeIntGemm: true})
	},
	{
		name: "WASM, 4 workers",
		factory: () => new WASMTranslationHelper({workers: 4, useNativeIntGemm: false})
	},
	{
		name: "Native Messaging",
		factory: () => new TLTranslationHelper()
	},
];

async function run({implementation, texts, from , to, update}) {
	performance.mark('start-scenario');
	const translator = implementation.factory();
	await translator.translate({from, to, text: 'This is a warm-up sentence.', html: false});
	performance.measure('scenario-loaded', 'start-scenario');

	const start = performance.now();

	let total = 0;
	let done = 0;

	await Promise.all(texts.map(async text => {
		update(done, ++total);
		await translator.translate({from, to, text, html: false});
		update(++done, total);
	}));

	return performance.now() - start;
}

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
	busy: false,
	texts: [],
	words: null,
}, renderBoundElements.bind(document.body));

renderBoundElements(state);

addEventListeners({
	'input #test-set-selector': e => {
		Array.from(e.target.files).forEach(async file => {
			state.busy = true;
			state.texts = (await readTestSet(file)).slice(0, 250);
			state.words = state.texts.reduce((words, text) => words + text.split(/\b\W+\b/).length, 0);
			state.busy = false;
		});
	},
	'click #run-test': async e => {
		for (let implementation of implementations) {
			const row = document.querySelector('#results-row').content.firstElementChild.cloneNode(true);
			document.querySelector('#results tbody').appendChild(row);

			const render = renderBoundElements.bind(row);

			const data = observe({
				name: implementation.name,
				time: null,
				wps: null,
				done: 0,
				total: 0
			}, debounce(render));

			render(data);

			data.time = await run({
				implementation,
				texts: state.texts,
				from: 'de',
				to: 'en',
				update: (done, total) => {
					data.done = done;
					data.total = total;
				}
			});

			data.wps = state.words / (data.time / 1000);
		}
	}
});