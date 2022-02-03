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

/**
 * Hash function for strings because sometimes you just need to have something
 * unique but not immensely long.
 */
function cyrb53(str, seed = 0) {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1>>>16), 2246822507) ^ Math.imul(h2 ^ (h2>>>13), 3266489909);
    h2 = Math.imul(h2 ^ (h2>>>16), 2246822507) ^ Math.imul(h1 ^ (h1>>>13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1>>>0);
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


class Channel {
    constructor(worker) {
        this.worker = worker;
        this.worker.onmessage = this.onmessage.bind(this);
        this.serial = 0;
        this.pending = new Map();
    }

    request(message) {
        return new Promise((resolve, reject) => {
            const id = ++this.serial;
            this.pending.set(id, {resolve, reject});
            console.log('Sending', {id, message});
            this.worker.postMessage({id, message});
        })
    }

    onmessage({data: {id, message, error}}) {
        if (id === undefined)
            return;

        console.log('Receiving', {id, message, error});

        const {resolve, reject} = this.pending.get(id);
        this.pending.delete(id);

        if (error !== undefined)
            reject(error);
        else
            resolve(message); // Note: message can be undefined
    }
}

/**
 * Wrapper around bergamot-translator and model management. You only need
 * to call translate() which is async, the helper will manage execution by
 * itself.
 */
 class TranslationHelper {
    
    constructor() {
        // all variables specific to translation service
        this.registry = lazy(this.loadModelRegistery.bind(this));
        
        // a map of language-pair to Map<{from:str,to:str}, List<{from:str,to:str}>> object
        this.models = new Map();

        this.workers = [];

        // List of batches we push() to & shift() from
        this.queue = [];

        // IdleCallback id when idle callback is scheduled.
        this.callbackId = null;

        this.batchSerial = 0;
    }

    loadWorker() {
        const worker = new Worker('controller/translation/translationWorkerThread.js');

        const channel = new Channel(worker);

        return new Proxy(worker, {
            get(target, name, receiver) {
                return (...args) => {
                    return channel.request({name, args: Array.from(args)}) // returns a Promise
                }
            }
        });
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

    async loadTranslationModel(key) {
        performance.mark(`loadTranslationModule.${JSON.stringify(key)}`);

        const files = (await this.registry).find(model => model.from == key.from && model.to == key.to).files;

        const [model, vocab, shortlist] = await Promise.all([
            this.getItemFromCacheOrWeb(files.model.url, files.model.size, files.model.expectedSha256Hash),
            this.getItemFromCacheOrWeb(files.vocab.url, files.vocab.size, files.vocab.expectedSha256Hash),
            this.getItemFromCacheOrWeb(files.lex.url, files.lex.size, files.lex.expectedSha256Hash),
        ]);

        performance.measure('loadTranslationModel', `loadTranslationModule.${JSON.stringify(key)}`);

        return {model, vocab, shortlist};
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
                    return resolve([direct[0]]);

                // Find the pivot language
                const shared = intersect(
                    ...outbound.map(model => model.to),
                    ...inbound.map(model => model.from)
                );

                if (!shared.length)
                    throw new Error(`No model available to translate from ${from} to ${to}`);

                resolve([
                    outbound.find(model => shared.has(model.to)),
                    inbound.find(model => shared.has(model.from))
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
            if (!this.workers.length)
                this.workers.push(this.loadWorker());

            // This will block this thread entirely
            await this.consumeBatch(this.workers[0]);

            // Allow a next call
            this.callbackId = null;
            
            // If that didn't do it, ask for another call
            if (this.queue.length)
                this.run();
        }, {timeout: 1000}); // Start after 1000ms even if not idle
    }

    translate(request) {
        const {from, to, text, html, priority} = request;
        
        return new Promise(async (resolve, reject) => {
            // Batching key: only requests with the same key can be batched
            // together. Think same translation model, same options.
            const key = JSON.stringify({from, to, html});

            // (Fetching models first because if we would do it between looking
            // for a batch and making a new one, we end up with a race condition.)
            const models = await this.getModels(from, to);
            
            this.enqueue({key, models, request, resolve, reject, priority});

            this.run();
        });
    }

    enqueue({key, models, request, resolve, reject, priority}) {
        if (priority === undefined)
            priority = 0;
         // Find a batch in the queue that we can add to
         // (TODO: can we search backwards? that would speed things up)
        let batch = this.queue.find(batch => {
            return batch.key === key
                && batch.priority === priority
                && batch.requests.length < BATCH_SIZE
        });

        // No batch or full batch? Queue up a new one
        if (!batch) {
            batch = {id: ++this.batchSerial, key, priority, models, requests: []};
            this.queue.push(batch);
            this.queue.sort((a, b) => a.priority - b.priority);
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
                    priority: batch.priority,
                    models: batch.models,
                    request: task.request,
                    resolve: task.resolve,
                    reject: task.reject
                });
            });
        });

        console.debug("After pruning closed tab, ", this.queue.length, "of", queue.length, "batches left");
    }

    async consumeBatch(worker) {
        performance.mark('BTConsumeBatch.start');

        console.debug('Total number of batches in queue', this.queue.length);
        const batch = this.queue.shift();
        if (batch === undefined)
            return;

        console.debug("Translating batch", batch);

        // Make sure the worker has all necessary models loaded. If not, tell it
        // first to load them.
        await Promise.all(batch.models.map(async ({from, to}) => {
            if (!await worker.hasTranslationModel({from, to})) {
                const buffers = await this.loadTranslationModel({from, to});
                await worker.loadTranslationModel({from, to}, buffers);
            }
        }));

        const responses = await worker.translate({
            models: batch.models.map(({from, to}) => ({from, to})),
            texts: batch.requests.map(({request: {text}}) => text),
            options: {html: batch.requests[0].request.html}
        });

        batch.requests.forEach(({request, resolve, reject}, i) => {
            // TODO: look at response.ok and reject() if it is false
            resolve({
                request, // Include request for easy reference? Will allow you
                         // to specify custom properties and use that to link
                         // request & response back to each other.
                translation: responses[i].translation
            });
        });
        
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