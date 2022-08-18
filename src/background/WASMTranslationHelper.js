import compat from '../shared/compat.js';
import { PromiseWithProgress } from '../shared/promise.js';
import { first, flatten } from '../shared/func.js';
import * as YAML from '../shared/yaml.js';
import { BatchTranslator, TranslatorBacking } from '@browsermt/bergamot-translator';
import { inflate } from 'pako';
import untar from 'js-untar';

/**
 * @typedef {Object} TranslationRequest
 * @property {String} from
 * @property {String} to
 * @property {String} text
 * @property {Boolean} html
 * @property {Integer?} priority
 */

const CACHE_NAME = "bergamot-translations";

const MAX_DOWNLOAD_TIME = 60000; // TODO move this

const WASM_TRANSLATION_WORKER_URL = compat.runtime.getURL('translation-worker.js');

class BergamotBacking extends TranslatorBacking {
    constructor(options) {
        super({
            ...options,
            workerUrl: WASM_TRANSLATION_WORKER_URL
        })
    }

    #hasTranslationModel({from, to}) {
        const key = JSON.stringify({from, to});
        return this.models.has(key);
    }

    /**
     * Loads the model registry. Uses the registry shipped with this extension,
     * but formatted a bit easier to use, and future-proofed to be swapped out
     * with a TranslateLocally type registry. Returns Promise<List<Model>>
     */
    async loadModelRegistery() {
        const cache = typeof caches !== 'undefined' ? caches.open(CACHE_NAME) : null;
        const response = await fetch('https://translatelocally.com/models.json');
        const {models} = await response.json();
        let serial = 0;

        // Check whether each of the models is already downloaded
        models.forEach((model) => {
            // Give the model an id for easy look-up
            model.id = ++serial;
            
            // Async check whether the model is in cache
            let modelInCache = false;
            if (cache) {
                cache.then(cache => cache.match(model.url).then(response => {
                    modelInCache = response && response.ok;
                }));
            }

            Object.defineProperty(model, 'local', {
                enumerable: true,
                get: () => modelInCache || this.#hasTranslationModel(model)
            });
        });

        // Add 'from' and 'to' keys for each model. Since theoretically a model
        // can have multiple froms keys in TranslateLocally, we do a little
        // product here.
        return Array.from(flatten(models, function*(model) {
            try {
                const to = first(Intl.getCanonicalLocales(model.trgTag));
                for (let from of Intl.getCanonicalLocales(Object.keys(model.srcTags))) {
                    yield {from, to, model};
                }
            } catch (err) {
                console.log('Skipped model', model, err);
            }
        }));
    }

    downloadModel(id) {
        return new PromiseWithProgress(async (accept, reject, update) => {
            try {
                const model = (await this.registry).find(({model}) => model.id === id);
                accept(await this.loadTranslationModel(model, update));
            } catch (err) {
                reject(err);
            }
        });
    }

     /**
     * Downloads (or from cache) a translation model and returns a set of
     * ArrayBuffers. These can then be passed to a TranslationWorker thread
     * to instantiate a TranslationModel inside the WASM vm.
     * Returns Promise<Map<str,ArrayBuffer>>.
     */
    async loadTranslationModel({from, to}, update) {
        performance.mark(`loadTranslationModule.${JSON.stringify({from, to})}`);

        // Find that model in the registry which will tell us about its files
        const entries = (await this.registry).filter(model => model.from == from && model.to == to);

        // Prefer tiny models above non-tiny ones (right now base models don't even work properly 😅)
        entries.sort(({model: a}, {model: b}) => (a.shortName.indexOf('tiny') === -1 ? 1 : 0) - (b.shortName.indexOf('tiny') === -1 ? 1 : 0));

        if (!entries)
            throw new Error(`No model for '${from}' -> '${to}'`);

        const entry = first(entries).model;

        const compressedArchive = await this.getItemFromCacheOrWeb(entry.url, entry.checksum, update);

        const archive = inflate(compressedArchive);

        const files = await untar(archive.buffer);

        const find = (filename) => {
            const found = files.find(file => file.name.match(/(?:^|\/)([^\/]+)$/)[1] === filename)
            if (found === undefined)
                throw new Error(`Could not find '${filename}' in model archive`);
            return found;
        };

        const config = YAML.parse(find('config.intgemm8bitalpha.yml').readAsString());

        const model = find(config.models[0]).buffer;

        const vocabs = config.vocabs.map(vocab => find(vocab).buffer);

        const shortlist = find(config.shortlist[0]).buffer;

        performance.measure('loadTranslationModel', `loadTranslationModule.${JSON.stringify({from, to})}`);

        // Return the buffers
        return {model, vocabs, shortlist, config};
    }

    /**
     * Helper to either get a URL remote or from cache. Downloaded file is
     * always checked against checksum.
     * @param {String} url
     * @param {String} checksum sha256 checksum as hexadecimal string
     * @returns {Promise<ArrayBuffer>}
     */
    async getItemFromCacheOrWeb(url, checksum, update) {
        try {
            let cache = null;

            // Only check the cache if we're not running in private mode
            if (typeof caches !== 'undefined') {
                cache = await caches.open(CACHE_NAME);
                const match = await cache.match(url);

                if (match) {
                    // Found it in the cache, let's check whether it (still) matches the
                    // checksum. If not, redownload it.
                    const buffer = await match.arrayBuffer();
                    if (await this.digestSha256AsHex(buffer) === checksum)
                        return buffer;
                    else
                        cache.delete(url);
                }
            }

            return await this.getItemFromWeb(url, checksum, cache, update);
        } catch (e) {
            throw new Error(`Failed to download '${url}': ${e.message}`);
        }
    }

    /**
     * Helper to download file from the web (and store it in the cache if that
     * is passed in as well). Verifies the checksum.
     * @param {String} url
     * @param {String} checksum sha256 checksum as hexadecimal string
     * @param {Cache?} cache optional cache to save response into
     * @returns {Promise<ArrayBuffer>}
     */
    async getItemFromWeb(url, checksum, cache, update) {
        try {
            // Rig up a timeout cancel signal for our fetch
            const abort = new AbortController();
            let timeout = setTimeout(() => abort.abort(), MAX_DOWNLOAD_TIME);

            // Start downloading the url, will give us response headers.
            const response = await fetch(url, {signal: abort.signal});

            // Also stream it to cache. We check the promise later, but we have
            // to clone the response before we start reading.
            const cached = cache ? cache.put(url, response.clone()) : Promise.resolve(true);

            /** @type {ArrayBuffer} */
            let buffer;

            if (update) {
                const size = parseInt(response.headers.get('Content-Length'));

                // If we didn't get a size, we can't report progress.
                if (size) {
                    const body = new Uint8Array(size);
                    const reader = response.body.getReader();
                    let read = 0;

                    while (true) {
                        const {done, value} = await reader.read();

                        if (done)
                            break;

                        body.set(value, read);
                        read += value.length;
                        update({size, read});

                        // Reset timeout because progress is good!
                        clearTimeout(timeout);
                        timeout = setTimeout(() => abort.abort(), MAX_DOWNLOAD_TIME);
                    }

                    buffer = body.buffer;
                }
            }

            // Fallback fast route when we either don't have an update() or we
            // didn't get a Content-Length header.
            if (!buffer)
                buffer = await response.arrayBuffer();

            // Download finished, remove the abort timer
            clearTimeout(timeout);

            // Make sure caching succeeded (if no cache, always true)
            await cached;

            // Checking checksum afterwards. Previously I used sub-resource
            // integrity to check the hash, but that will delay getReader()
            // until the resource has been downloaded & checked.
            if (await this.digestSha256AsHex(buffer) !== checksum)
                throw new TypeError(`Response for ${url} did not match checksum ${checksum}`);
            
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
     * @param {ArrayBuffer} buffer
     * @returns {Promise<String>} SHA256 checksum as hexadecimal string
     */
    async digestSha256AsHex(buffer) {
        // hash the message
        const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
        // convert buffer to byte array
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        // convert bytes to hex string
        return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    }
}

/**
 * Wrapper around bergamot-translator and model management. You only need
 * to call translate() which is async, the helper will manage execution by
 * itself.
 */
export default class WASMTranslationHelper {
    constructor(options) {
        this.backing = new BergamotBacking(options);
        this.translator = new BatchTranslator(options, this.backing);
    }

    get registry() {
        return this.backing.registry;
    }

    downloadModel(id) {
        return this.backing.downloadModel(id);
    }

    translate(request) {
        return this.translator.translate(request);
    }

    remove(filter) {
        return this.translator.filter(filter);
    }
}
