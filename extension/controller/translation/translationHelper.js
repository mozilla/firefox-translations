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

const MAX_WORKERS = 4;

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
    async getModels(from, to) {
        const key = JSON.stringify({from, to});

        // Note that the `this.models` map stores Promises. This so that
        // multiple calls to `getModels` that ask for the same model will
        // return the same promise, and the actual lookup is only done once.
        // The lookup is async because we need to await `this.registry`
        if (!this.models.has(key)) {
            this.models.set(key, new Promise(async (resolve, reject) => {
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
                    outbound.map(model => model.to),
                    inbound.map(model => model.from)
                );

                if (!shared.size)
                    throw new Error(`No model available to translate from ${from} to ${to}`);

                resolve([
                    outbound.find(model => shared.has(model.to)),
                    inbound.find(model => shared.has(model.from))
                ]);
            }));
        }

        return await this.models.get(key);
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
        const {text} = request;

        if (!this._port) {
            this._port = browser.runtime.connectNative('translateLocally');

            this._callbacks = new Map();
            this._serial = 0;

            this._port.onMessage.addListener(message => {
                console.log('translateLocally responded with', message);
                const promise = this._callbacks.get(message.id);
                try {
                    promise.resolve(message);
                } catch (e) {
                    promise.reject(e);
                } finally {
                    this._callbacks.delete(message.id);
                }
            });

            this._port.onDisconnect.addListener((e) => {
                console.log('translateLocally disconnected', e);
                this._port = null;
            });
        }

        return new Promise((resolve, reject) => {
            const id = ++this._serial;
            this._callbacks.set(id, {
                resolve: response => resolve({request, translation: response.target.text}),
                reject
            });
            this._port.postMessage({
                id,
                text,
                html: true,
                die: false
            });
        });
    }

    /**
     * Prune pending requests by testing each one of them to whether they're
     * still relevant. Used to prune translation requests from tabs that got
     * closed.
     */
    remove(filter) {
        //TODO
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