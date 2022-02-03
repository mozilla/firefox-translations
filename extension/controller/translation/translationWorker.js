/* eslint-disable no-global-assign */
/* eslint-disable no-native-reassign */
/* eslint-disable max-lines */

/* global engineRegistryRootURL, engineRegistryRootURLTest, engineRegistry, loadEmscriptenGlueCode, Queue */
/* global modelRegistryRootURL, modelRegistryRootURLTest, modelRegistry,importScripts */

/**
 * Converts the hexadecimal hashes from the registry to something we can use with
 * the fetch() method.
 */
function hexToBase64(hexstring) {
    return btoa(hexstring.match(/\w{2}/g).map(function(a) {
        return String.fromCharCode(parseInt(a, 16));
    }).join(""));
}

/**
 * Little wrapper to delay a promise to be made only once it is first awaited on
 */
function lazy(factory) {
    return {
        then(...args) {
            // Ask for the actual promise
            const promise = factory();
            // Replace ourselves with the actual promise for next calls
            this.then = promise.then.bind(promise);
            // Forward the current call to the promise
            return this.then(...args);
        }
    };
}

/**
 * Returns a set that is the intersection of two iterables
 */
function intersect(a, b) {
    const bSet = new Set(b);
    return new Set(a.filter(item => bSet.has(item)));
}

class PerformanceDummy {
    constructor(performance) {
        this.performance = performance;
        this.marks = {};
    }

    mark(name) {
        this.marks[name] = this.performance.now();
    }

    measure(name, startMark, endMark) {
        const end = endMark ? this.marks[endMark] : this.performance.now();
        const start = startMark ? this.marks[startMark] : 0;
        console.log('%c[measure] %s:%c %ims', 'background-color: orange', name, 'background-color: green; color:white', end - start);
    }
} 

// const performance = new PerformanceDummy(window.performance);

const BATCH_SIZE = 4; // number of requested translations

const CACHE_NAME = "bergamot-translations";

const MAX_DOWNLOAD_TIME = 60000; // TODO move this


/**
 * Wrapper around bergamot-translator and model management. You only need
 * to call translate() which is async, the helper will manage execution by
 * itself.
 */
 class TranslationHelper {
    
    constructor(wasmURL) {
        // all variables specific to translation service
        this.registry = lazy(this.loadModelRegistery.bind(this));
        this.module = lazy(this.loadTranslationModule.bind(this));
        this.service = lazy(this.loadTranslationService.bind(this));

        // a map of language-pair to Array<TranslationModel> object
        this.models = new Map();

        // List of batches we push() to & shift() from
        this.queue = [];

        // IdleCallback id when idle callback is scheduled.
        this.callbackId = null;

        this.batchSerial = 0;
    }

    async loadTranslationModule() {
        return new Promise(async (resolve, reject) => {
            try {
                performance.mark('loadTranslationModule.start')
                const response = await fetch("controller/translation/bergamot-translator-worker.wasm");
                const wasmBinary = await response.arrayBuffer();

                const { addOnPreMain, Module } = loadEmscriptenGlueCode({
                    wasmBinary,
                    preRun: [
                        () => {
                            // this.wasmModuleStartTimestamp = Date.now();
                        }
                    ],
                    onRuntimeInitialized: () => {
                        performance.measure('loadTranslationModule', 'loadTranslationModule.start');
                        resolve(Module);
                    }
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    async loadTranslationService() {
        const Module = await this.module;
        return new Module.BlockingService({});
    }

    async loadModelRegistery() {
        // I know doesn't need to be async but at some point we might want to use fetch() here.
        return new Promise((resolve, reject) => {
            // I don't like the format of this JSON but for now want to be able to
            // sync it upstream. At some point I'd rather have the format of
            // TranslateLocally and ideally be able to consume its tar.gz files
            // directly.

            const registry = Object.entries(modelRegistry).map(([languagePair, files]) => ({
                from: languagePair.substr(0, 2),
                to: languagePair.substr(2, 2),
                files: Object.fromEntries(Object.entries(files).map(([filename, properties]) => (
                    [
                        filename,
                        {
                            ...properties,
                            url: `${modelRegistryRootURL}/${languagePair}/${properties.name}`
                        }
                    ]
                )))
            }));

            resolve(registry);
        });
    }

    async loadLanguageModel({files: {vocab, model, lex}}) {
        const Module = await this.module;

        const modelConfig = `
        beam-size: 1
        normalize: 1.0
        word-penalty: 0
        max-length-break: 128
        mini-batch-words: 1024
        workspace: 128
        max-length-factor: 2.0
        skip-cost: true
        cpu-threads: 0
        quiet: true
        quiet-translation: true
        gemm-precision: int8shiftAlphaAll
        alignment: soft
        `;
        
        // download the files as buffers from the given urls
        const [modelMemory, vocabMemory, shortlistMemory] = await Promise.all([
            this.prepareAlignedMemoryFromBuffer(
                await this.getItemFromCacheOrWeb(model.url, model.size, model.expectedSha256Hash),
                256
            ),
            this.prepareAlignedMemoryFromBuffer(
                await this.getItemFromCacheOrWeb(vocab.url, vocab.size, vocab.expectedSha256Hash),
                64
            ),
            this.prepareAlignedMemoryFromBuffer(
                await this.getItemFromCacheOrWeb(lex.url, lex.size, lex.expectedSha256Hash),
                64
            ),
        ]);

        let vocabs = new Module.AlignedMemoryList();
        vocabs.push_back(vocabMemory);

        return new Module.TranslationModel(modelConfig, modelMemory, shortlistMemory, vocabs);
    }

    async getItemFromCacheOrWeb(url, size, checksum) {
        const cache = await caches.open(CACHE_NAME);
        const match = await cache.match(url);

        if (!match)
            return this.getItemFromWeb(url, size, checksum, cache); // also puts it in the cache

        const buffer = await match.arrayBuffer();
        if (await this.digestSha256AsHex(buffer) !== checksum) {
            cache.delete(url);
            throw new Error("Error downloading translation engine. (checksum)")
        }

        return buffer;
    }

    async getItemFromWeb(url, size, checksum, cache) {
        try {
            // Rig up a timeout cancel signal for our fetch
            const abort = new AbortController();
            const timeout = setTimeout(() => abort.abort(), MAX_DOWNLOAD_TIME);

            // Start downloading the url
            const response = await fetch(url, {
                integrity: `sha256-${hexToBase64(checksum)}`,
                signal: abort.signal
            });

            // Also stream it to cache
            if (cache)
                await cache.put(url, response.clone());

            // Finish downloading (or crash due to timeout)
            const buffer = await response.arrayBuffer();

            // Download finished, remove the abort timer
            clearTimeout(timeout);

            return buffer;
        } catch (e) {
            if (cache)
                cache.delete(url);
            throw e;
        }
    }

    async digestSha256AsHex(buffer) {
        // hash the message
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        // convert buffer to byte array
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        // convert bytes to hex string
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }

    async prepareAlignedMemoryFromBuffer(buffer, alignmentSize) {
        const Module = await this.module;
        const bytes = new Int8Array(buffer);
        const memory = new Module.AlignedMemory(bytes.byteLength, alignmentSize);
        memory.getByteArrayView().set(bytes);
        return memory;
    }

    async getModels(from, to) {
        const key = JSON.stringify({from, to});

        if (!this.models.has(key)) {
            this.models.set(key, new Promise(async (resolve, reject) => {
                console.debug('Searching for models for', {from, to});

                const registry = await this.registry;

                // TODO: This all scales really badly.

                let direct = [], outbound = [], inbound = [];

                registry.forEach(model => {
                    if (model.from === from && model.to === to)
                        direct.push(model);
                    else if (model.from === from)
                        outbound.push(model);
                    else if (model.to === to)
                        inbound.push(model);
                });

                if (direct.length)
                    return resolve([await this.loadLanguageModel(direct[0])]);

                // Find the pivot language
                const shared = intersect(
                    ...outbound.map(model => model.to),
                    ...inbound.map(model => model.from)
                );

                if (!shared.length)
                    throw new Error(`No model available to translate from ${from} to ${to}`);

                resolve([
                    await this.loadLanguageModel(outbound.find(model => shared.has(model.to))),
                    await this.loadLanguageModel(inbound.find(model => shared.has(model.from)))
                ]);
            }));
        }

        return await this.models.get(key);
    }

    run() {
        if (this.callbackId) {
            console.debug("Already scheduled to run");
            return;
        }

        this.callbackId = requestIdleCallback(async () => {
            // This callback has been called, so remove its id
            this.callbackId = null;

            // This will block this thread entirely
            await this.consumeBatch();

            // If that didn't do it, ask for another call
            if (this.queue.length)
                this.run();
        }, {timeout: 1000}); // Start after 1000ms even if not idle
    }

    translate(request) {
        const {from, to, text, qualityScore, alignment, html} = request;
        console.debug("Requested to translate", text, "from", from, "to", to);
        
        return new Promise(async (resolve, reject) => {
            // Batching key: only requests with the same key can be batched
            // together. Think same translation model, same options.
            const key = JSON.stringify({from, to, qualityScore, alignment, html});

            // (Fetching models first because if we would do it between looking
            // for a batch and making a new one, we end up with a race condition.)
            const models = await this.getModels(from, to);
            
            this.enqueue({key, models, request, resolve, reject});

            this.run();
        });
    }

    enqueue({key, models, request, resolve, reject}) {
         // Find a batch in the queue that we can add to
         // (TODO: can we search backwards? that would speed things up)
        let batch = this.queue.find(batch => batch.key === key && batch.requests.length < BATCH_SIZE);

        // No batch or full batch? Queue up a new one
        if (!batch) {
            batch = {id: ++this.batchSerial, key, models, requests: []};
            this.queue.push(batch);
        }

        batch.requests.push({request, resolve, reject});
    }

    remove(filter) {
        const queue = this.queue;

        this.queue = [];

        queue.forEach(batch => {
            batch.forEach(task => {
                if (filter(task.request)) {
                    task.reject(new Error('removed by filter'));
                    return;
                }

                this.enqueue({
                    key: batch.key,
                    models: batch.models,
                    request: task.request,
                    resolve: task.resolve,
                    reject: task.reject
                });
            });
        });

        console.debug("After pruning closed tab, ", this.queue.length, "of", queue.length, "batches left");
    }

    async consumeBatch() {
        performance.mark('BTConsumeBatch.start');

        const Module = await this.module;
        const service = await this.service;

        console.debug('Total number of batches in queue', this.queue.length);
        const batch = this.queue.shift();
        if (batch === undefined)
            return;

        console.debug("Translating batch", batch);

        const htmlOptions = new Module.HTMLOptions();
        htmlOptions.setContinuationDelimiters("\n ,.(){}[]0123456789");
        htmlOptions.setSubstituteInlineTagsWithSpaces(true);

        // TODO: now getting that data from the first request. translate() will
        // have made sure we only get requests with the same options in this
        // batch. But in the future I would like to pass on options per request
        // to bergamot-translator.
        const responseOptions = {
            qualityScores: batch.requests[0].request.qualityScore,
            alignment: batch.requests[0].request.alignment,
            html: batch.requests[0].request.html,
            htmlOptions
        };

        let input = new Module.VectorString();

        batch.requests.forEach(({request: {text}}) => input.push_back(text));

        // translate the input, which is a vector<String>; the result is a vector<Response>
        performance.mark('BTBlockingService.translate.start');
        const responses = batch.models.length > 1
            ? service.translateViaPivoting(...batch.models, input, responseOptions)
            : service.translate(...batch.models, input, responseOptions);
        performance.measure('BTBlockingService.translate', 'BTBlockingService.translate.start');

        input.delete();

        performance.mark('BTResolveRequests.start')
        batch.requests.forEach(({request, resolve, reject}, i) => {
            const response = responses.get(i);
            // TODO: look at response.ok and reject() if it is false
            resolve({
                request, // Include request for easy reference? Will allow you
                         // to specify custom properties and use that to link
                         // request & response back to each other.
                translation: response.getTranslatedText()
            });
        });
        performance.measure('BTResolveRequests', 'BTResolveRequests.start');

        responses.delete(); // Is this necessary?

        performance.measure('BTConsumeBatch', 'BTConsumeBatch.start');
    }
}

const translationHelper = new TranslationHelper();

browser.runtime.onMessage.addListener((message, sender) => {
    // console.log("Received message", message, "from sender", sender);

    switch (message.command) {
        case "AvailableModelRequest":
            translationHelper.registry.then(registry => {
                browser.tabs.sendMessage(sender.tab.id, {
                    command: "AvailableModelResponse",
                    models: registry.map(({from, to}) => ({from, to}))
                });
            });
            break;

        case "TranslateRequest":
            // safe sender id for "TranslateAbort" requests
            translationHelper.translate({...message.data, _senderTabId: sender.tab.id}).then(response => {
                browser.tabs.sendMessage(sender.tab.id, {
                    command: "TranslateResponse",
                    data: response 
                });
            });
            break;

        case "TranslateAbort":
            translationHelper.remove((request) => {
                return request._senderTabId === sender.tab.id;
            });
            break;
    }
});

async function test() {
    console.log(await Promise.all([
        translationHelper.translate({
            from: 'de',
            to: 'en',
            text: 'Hallo Welt. Wie geht es dir?'
        }),
        translationHelper.translate({
            from: 'de',
            to: 'en',
            text: 'Mein Name ist Jelmer.'
        })
    ]));
}