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

const BATCH_SIZE = 8; // number of requested translations

const CACHE_NAME = "bergamot-translations";

const MAX_DOWNLOAD_TIME = 60000; // TODO move this

const MAX_WORKERS = 1;

/**
 * Little wrapper around the message passing API to keep track of messages and
 * their responses in such a way that you can just wait for them by awaiting
 * the promise returned by `request()`.
 */
class Channel {
    constructor(worker) {
        this.worker = worker;
        this.worker.onerror = this.onerror.bind(this);
        this.worker.onmessage = this.onmessage.bind(this);
        this.serial = 0;
        this.pending = new Map();
    }

    request(message) {
        return new Promise((resolve, reject) => {
            const id = ++this.serial;
            this.pending.set(id, {resolve, reject});
            this.worker.postMessage({id, message});
        })
    }

    onerror(error) {
        throw new Error(`Error in worker: ${error.message}`);
    }

    onmessage({data: {id, message, error}}) {
        if (id === undefined)
            return;

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
        // registry of all available models and their urls: Promise<List<Model>>
        this.registry = lazy(this.loadModelRegistery.bind(this));

        // Map<{from:str,to:str}, Promise<Map<name:str,buffer:ArrayBuffer>>>
        this.buffers = new Map();
        
        // a map of language-pairs to a list of models you need for it: Map<{from:str,to:str}, Promise<List<{from:str,to:str}>>>
        this.models = new Map();

        // List of active workers (and a flag to mark them idle or not)
        this.workers = [];

        // List of batches we push() to & shift() from
        this.queue = [];

        // batch serial to help keep track of batches when debugging
        this.batchSerial = 0;
    }

    /**
     * Loads a worker thread, and wraps it in a message passing proxy. I.e. it
     * exposes the entire interface of TranslationWorker here, and all calls
     * to it are async. Do note that you can only pass arguments that survive
     * being copied into a message. Returns Proxy<TranslationWorker>.
     */
    loadWorker() {
        // TODO is this really not async? Can I just send messages to it from
        // the start and will they be queued or something?
        const worker = new Worker('controller/translation/translationWorker.js');
        worker.onerror = (err) => console.error('Worker:', err);

        // Little wrapper around the message passing api of Worker to make it
        // easy to await a response to a sent message.
        const channel = new Channel(worker);

        // Wrap the worker in a Proxy so you can treat it as if it is an
        // instance of the TranslationWorker class that lives inside the worker.
        // All function calls to it are transparently passed through the message
        // passing channel.
        return new Proxy(worker, {
            get(target, name, receiver) {
                return (...args) => {
                    return channel.request({name, args: Array.from(args)}) // returns a Promise
                }
            }
        });
    }

    /**
     * Loads the model registry. Uses the registry shipped with this extension,
     * but formatted a bit easier to use, and future-proofed to be swapped out
     * with a TranslateLocally type registry. Returns Promise<List<Model>>
     */
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

    /**
     * Gets or loads translation model data. Caching wrapper around
     * `loadTranslationModel()`. Returns the same promise type.
     */
    getTranslationModel({from, to}) {
        const key = JSON.stringify({from, to});

        if (!this.buffers.has(key))
            this.buffers.set(key, this.loadTranslationModel({from, to}));

        return this.buffers.get(key);
    }

    /**
     * Downloads (or from cache) a translation model and returns a set of
     * ArrayBuffers. These can then be passed to a TranslationWorker thread
     * to instantiate a TranslationModel inside the WASM vm.
     * Returns Promise<Map<str,ArrayBuffer>>.
     */
    async loadTranslationModel({from, to}) {
        performance.mark(`loadTranslationModule.${JSON.stringify({from, to})}`);

        // Find that model in the registry which will tell us about its files
        const files = (await this.registry).find(model => model.from == from && model.to == to).files;

        // Download the files in parallel (checking checksums in the process)
        const [model, vocab, shortlist] = await Promise.all([
            this.getItemFromCacheOrWeb(files.model.url, files.model.size, files.model.expectedSha256Hash),
            this.getItemFromCacheOrWeb(files.vocab.url, files.vocab.size, files.vocab.expectedSha256Hash),
            this.getItemFromCacheOrWeb(files.lex.url, files.lex.size, files.lex.expectedSha256Hash),
        ]);

        performance.measure('loadTranslationModel', `loadTranslationModule.${JSON.stringify({from, to})}`);

        // Return the buffers
        return {model, vocab, shortlist};
    }

    /**
     * Helper to either get a URL remote or from cache. Downloaded file is
     * always checked against checksum. Returns Promise<ArrayBuffer>.
     */
    async getItemFromCacheOrWeb(url, size, checksum) {
        const cache = await caches.open(CACHE_NAME);
        const match = await cache.match(url);

        // It's not already in the cache? Then return the downloaded version
        // (but also put it in the cache)
        if (!match)
            return this.getItemFromWeb(url, size, checksum, cache);

        // Found it in the cache, let's check whether it (still) matches the
        // checksum.
        const buffer = await match.arrayBuffer();
        if (await this.digestSha256AsHex(buffer) !== checksum) {
            cache.delete(url);
            throw new Error("Error downloading translation engine. (checksum)")
        }

        return buffer;
    }

    /**
     * Helper to download file from the web (and store it in the cache if that
     * is passed in as well). Verifies the checksum.
     * Returns Promise<ArrayBuffer>.
     */
    async getItemFromWeb(url, size, checksum, cache) {
        try {
            // Rig up a timeout cancel signal for our fetch
            const abort = new AbortController();
            const timeout = setTimeout(() => abort.abort(), MAX_DOWNLOAD_TIME);

            // Start downloading the url, using the hex checksum to ask
            // `fetch()` to verify the download using subresource integrity 
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
            // If the download timed out or didn't pass muster, make sure it
            // doesn't end up in the cache in a bad way.
            if (cache)
                cache.delete(url);
            throw e;
        }
    }

    /**
     * Expects ArrayBuffer, returns String.
     */
    async digestSha256AsHex(buffer) {
        // hash the message
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        // convert buffer to byte array
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        // convert bytes to hex string
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }

    /**
     * Crappy named method that gives you a list of models to translate from
     * one language into the other. Generally this will be the same as you
     * just put in if there is a direct model, but it could return a list of
     * two models if you need to pivot through a third language.
     * Returns just [{from:str,to:str}...]. To be used something like this:
     * ```
     * const models = await this.getModels(from, to);
     * models.forEach(({from, to}) => {
     *   const buffers = await this.loadTranslationModel({from,to});
     *   [TranslationWorker].loadTranslationModel({from,to}, buffers)
     * });
     * ```
     */
    getModels(from, to) {
        const key = JSON.stringify({from, to});

        // Note that the `this.models` map stores Promises. This so that
        // multiple calls to `getModels` that ask for the same model will
        // return the same promise, and the actual lookup is only done once.
        // The lookup is async because we need to await `this.registry`
        if (!this.models.has(key))
            this.models.set(key, this.loadModels(from, to));

        return this.models.get(key);
    }

    async loadModels(from, to) {
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
            return [direct[0]];

        // Find the pivot language
        const shared = intersect(
            outbound.map(model => model.to),
            inbound.map(model => model.from)
        );

        if (!shared.size)
            throw new Error(`No model available to translate from ${from} to ${to}`);

        return [
            outbound.find(model => shared.has(model.to)),
            inbound.find(model => shared.has(model.from))
        ];
    }

    /**
     * Makes sure queued work gets send to a worker. Will delay it till `idle`
     * to make sure the batches have been filled to some degree. Will keep
     * calling itself as long as there is work in the queue, but it does not
     * hurt to call it multiple times. This function always returns immediately.
     */
    notify() {
        requestIdleCallback(async () => {
            // Is there work to be done?
            if (!this.queue.length)
                return;

            // Find an idle worker
            let worker = this.workers.find(worker => worker.idle);

            // No worker free, but space for more?
            if (!worker && this.workers.length < MAX_WORKERS) {
                worker = {
                    idle: true,
                    worker: this.loadWorker()
                };
                this.workers.push(worker);
            }

            // If no worker, that's the end of it.
            if (!worker)
                return;

            // Up to this point, this function has not used await, so no
            // chance that another call stole our batch since we did the check
            // at the beginning of this function and JavaScript is only
            // cooperatively parallel.
            const batch = this.queue.shift();

            // Put this worker to work, marking as busy
            worker.idle = false;
            await this.consumeBatch(batch, worker.worker);
            worker.idle = true;

            // Is there more work to be done? Do another idleRequest
            if (this.queue.length)
                this.notify();
        }, {timeout: 1000}); // Start after 1000ms even if not idle
    }

    /**
     * The only real public call you need!
     * ```
     * const {translation:str} = await this.translate({
     *   from: 'de',
     *   to: 'en',
     *   text: 'Hallo Welt!',
     *   html: false, // optional
     *   priority: 0 // optional, like `nice` lower numbers are translated first
     * })
     * ```
     */
    translate(request) {
        const {from, to, html, priority} = request;

        return new Promise(async (resolve, reject) => {
            // Batching key: only requests with the same key can be batched
            // together. Think same translation model, same options.
            const key = JSON.stringify({from, to});

            // (Fetching models first because if we would do it between looking
            // for a batch and making a new one, we end up with a race condition.)
            const models = await this.getModels(from, to);
            
            // Put the request and its callbacks into a fitting batch
            this.enqueue({key, models, request, resolve, reject, priority});

            // Tell a worker to pick up the work at some point.
            this.notify();
        });
    }

    /**
     * Prune pending requests by testing each one of them to whether they're
     * still relevant. Used to prune translation requests from tabs that got
     * closed.
     */
    remove(filter) {
        const queue = this.queue;

        this.queue = [];

        queue.forEach(batch => {
            batch.requests.forEach(({request, resolve, reject}) => {
                if (filter(request)) {
                    // Add error.request property to match response.request for
                    // a resolve() callback. Pretty useful if you don't want to
                    // do all kinds of Funcion.bind() dances.
                    reject(Object.assign(new Error('removed by filter'), {request}));
                    return;
                }

                this.enqueue({
                    key: batch.key,
                    priority: batch.priority,
                    models: batch.models,
                    request,
                    resolve,
                    reject
                });
            });
        });
    }

    /**
     * Internal function used to put a request in a batch that still has space.
     * Also responsible for keeping the batches in order of priority. Called by
     * `translate()` but also used when filtering pending requests.
     */
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

    /**
     * Internal method that uses a worker thread to process a batch. You can
     * wait for the batch to be done by awaiting this call. You should only
     * then reuse the worker otherwise you'll just clog up its message queue.
     */
    async consumeBatch(batch, worker) {
        performance.mark('BTConsumeBatch.start');

        // Make sure the worker has all necessary models loaded. If not, tell it
        // first to load them.
        await Promise.all(batch.models.map(async ({from, to}) => {
            if (!await worker.hasTranslationModel({from, to})) {
                const buffers = await this.getTranslationModel({from, to});
                await worker.loadTranslationModel({from, to}, buffers);
            }
        }));

        // Call the worker to translate. Only sending the actually necessary
        // parts of the batch to avoid trying to send things that don't survive
        // the message passing API between this thread and the worker thread.
        const responses = await worker.translate({
            models: batch.models.map(({from, to}) => ({from, to})),
            texts: batch.requests.map(({request: {text, html}}) => ({text, html}))
        });

        // Responses are in! Connect them back to their requests and call their
        // callbacks.
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

// Just a little test to run in the web inspector for debugging
async function test(translationHelper) {
    console.log(await Promise.all([
        translationHelper.translate({
            from: 'de',
            to: 'en',
            text: 'Hallo Welt. Wie geht es dir?'
        }),
        translationHelper.translate({
            from: 'de',
            to: 'en',
            text: 'Mein Name ist <a href="#">Jelmer</a>.',
            html: true
        })
    ]));
}