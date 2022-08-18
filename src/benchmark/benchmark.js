import WASMTranslationHelper from '../background/WASMTranslationHelper.js'
import TLTranslationHelper from '../background/TLTranslationHelper.js';
import {
	BoundElementRenderer,
	debounce,
	addBoundElementListeners,
	addEventListeners
} from '../shared/common.js'


const defaults = {
	cacheSize: 0
};

const implementations = [
	{
		enabled: true,
		name: "WASM, 1 worker, batch-size: 8",
		factory: () => new WASMTranslationHelper({...defaults, workers: 1, useNativeIntGemm: false, batchSize: 8})
	},
	{
		enabled: true,
		name: "WASM, 1 worker, batch-size: 8, cache-size: 20000",
		factory: () => new WASMTranslationHelper({...defaults, workers: 1, useNativeIntGemm: false, batchSize: 16, cacheSize: 20000})
	},
	{
		enabled: false,
		name: "WASM, 1 worker, batch-size: 16",
		factory: () => new WASMTranslationHelper({...defaults, workers: 1, useNativeIntGemm: false, batchSize: 16})
	},
	{
		enabled: true,
		name: "WASM, 1 worker, native intgemm, batch-size: 8",
		factory: () => new WASMTranslationHelper({...defaults, workers: 1, useNativeIntGemm: true})
	},
	{
		enabled: true,
		name: "WASM, 4 workers, batch-size: 8",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: false})
	},
	{
		enabled: true,
		name: "WASM, 4 workers, native intgemm, batch-size: 8",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: true, batchSize: 8})
	},
	{
		enabled: false,
		name: "WASM, 4 workers, native intgemm, batch-size 16",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: true, batchSize: 16})
	},
	{
		enabled: false,
		name: "WASM, 4 workers, native intgemm, batch-size 32",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: true, batchSize: 32})
	},
	{
		enabled: false,
		name: "WASM, 4 workers, native intgemm, batch-size 128",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: true, batchSize: 128})
	},
	{
		enabled: false,
		name: "WASM, 4 workers, native intgemm, batch-size 256",
		factory: () => new WASMTranslationHelper({...defaults, workers: 4, useNativeIntGemm: true, batchSize: 256})
	},
	{
		enabled: true,
		name: "Native Messaging, 1 worker",
		factory: () => new TLTranslationHelper({...defaults, workers: 1})
	},
	{
		enabled: true,
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

const renderer = new BoundElementRenderer(document.querySelector('#controls'));

const state = observe({
	from: 'de',
	to: 'en',
	html: true,
	busy: false,
	texts: [],
	chunks: undefined,
	words: undefined,
	runs: 5,
}, renderer.render.bind(renderer));

addBoundElementListeners(document.querySelector('#controls'), (name, value) => {
	state[name] = value;
});

renderer.render(state);

const scenarios = implementations.map(implementation => {
	const section = document.querySelector('#results-row').content.cloneNode(true);
	console.assert(section.children.length == 2);

	const row = section.querySelector('thead > tr');
	console.assert(row instanceof Element);

	const tbody = section.querySelector('tbody');
	console.assert(tbody instanceof Element);

	const renderer = new BoundElementRenderer(section);
	const render = debounce(renderer.render.bind(renderer));

	// Done after selecting row and tbody because the section will be empty
	// after this step (section is a fragment, not an element, so the document
	// adopts the elements from the fragment!)
	document.querySelector('#results').appendChild(section);

	const data = observe({
		enabled: implementation.enabled,
		expanded: false,
		busy: false,
		name: implementation.name,
		startup: undefined,
		first: undefined,
		time: undefined,
		wps: undefined,
		done: 0,
		total: 0,
		get hideRuns() { return !this.expanded && !this.busy; }
	}, render);

	// Initial render of row (necessary for hidden attributes I guess)
	render(data);

	// Connect checkboxes to `data`
	addBoundElementListeners(row, (name, value) => data[name] = value);

	return {tbody, row, data, runs:[], implementation};
});

async function execute(scenario, run) {
	const row = document.querySelector('#run-row').content.firstElementChild.cloneNode(true);
	scenario.tbody.appendChild(row);

	const renderer = new BoundElementRenderer(row);
	const render = debounce(renderer.render.bind(renderer));

	const data = observe({
		run,
		busy: false,
		startup: undefined,
		first: undefined,
		time: undefined,
		wps: undefined,
		done: 0,
		total: 0
	}, render);

	data.busy = true;

	const init = performance.now();

	const translator = scenario.implementation.factory();

	// Warm-up sentence
	await translator.translate({
		from: state.from,
		to: state.to,
		text: 'Hallo welt!',
		html: false
	});
	
	const start = performance.now();

	data.startup = start - init;

	data.total = state.texts.length;

	const promises = state.texts.map(async text => {
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

	await Promise.allSettled(promises);
	data.time = performance.now() - start;

	data.wps = Math.round(state.words / (data.time / 1000));

	data.busy = false;

	return {row, data};
}

function updateAverages(scenario) {
	for (let column of ['startup', 'first', 'time', 'wps']) {
		scenario.data[column] = Math.round(scenario.runs.reduce((acc, {data}) => acc + data[column], 0) / scenario.runs.length);
	}
}

function updateBarChart() {
	for (let column of ['startup', 'first', 'time', 'wps']) {
		const max = scenarios.filter(({data: {enabled}}) => enabled).reduce((acc, {data}) => Math.max(acc, data[column]), 0);

		for (let {row, data} of scenarios) {
			const cell = row.querySelector(`.${column}-col`);

			if (!data.enabled) {
				cell.style.backgroundImage = '';
				continue;
			}
			const percentage = (100 * data[column] / max).toFixed(0);
			cell.style.backgroundImage = `linear-gradient(90deg,
				rgba(  0,  0,255,0.1) 0%,
				rgba(  0,  0,255,0.1) ${percentage}%,
				rgba(255,255,255,0.0) ${percentage}%,
				rgba(255,255,255,0.0) 100%)`;
		}
	}
}

addEventListeners(document.body, {
	'input #enable-all': e => {
		scenarios.forEach(scenario => scenario.data.enabled = e.target.checked);
	},
	'input #expand-all': e => {
		scenarios.forEach(scenario => scenario.data.expanded = e.target.checked);
	},
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
		for (let scenario of scenarios) {
			if (!scenario.data.enabled) continue;
			scenario.data.busy = true;
			for (let i = 0; i < state.runs; ++i) {
				scenario.runs.push(await execute(scenario, scenario.runs.length + 1));
				updateAverages(scenario);
			}
			scenario.data.busy = false;
		}
		updateBarChart();
		state.busy = false;
	}
});