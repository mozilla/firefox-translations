import compat from '../shared/compat.js';
import { PromiseWithProgress } from '../shared/promise.js';
import { first, flatten, deduplicate } from '../shared/func.js';
import * as YAML from '../shared/yaml.js';
import { BatchTranslator, TranslatorBacking } from '@browsermt/bergamot-translator';
import { inflate } from 'pako';
import untar from '../vendor/js-untar/untar.js';

/**
 * @typedef {Object} TranslationRequest
 * @property {String} from
 * @property {String} to
 * @property {String} text
 * @property {Boolean} html
 * @property {Integer?} priority
 */

const CACHE_NAME = "translatelocally";

const MAX_DOWNLOAD_TIME = 60000; // TODO move this

class BergamotBacking extends TranslatorBacking {
    #hasTranslationModel({from, to}) {
        const key = JSON.stringify({from, to});
        return this.models.has(key);
    }

    /**
     * Loads the model registry. Uses the registry shipped with this extension,
     * but formatted a bit easier to use, and future-proofed to be swapped out
     * with a TranslateLocally type registry.
     * @returns {Promise<List<{
     *  from: String,
     *  to: String,
     *  model: {
     *    id: Number,
     *    local: Boolean,
     *    shortName: String,
     *    url: String,
     *    checksum: String
     *  }>>}
     */
    async loadModelRegistery() {
        const response = await fetch('https://translatelocally.com/models.json');
        let {models} = await response.json();
        let serial = 0;

        // Add 'from' and 'to' keys for each model. Since theoretically a model
        // can have multiple froms keys in TranslateLocally, we do a little
        // product here.
        let entries = flatten(models, function*(model) {
            try {
                const to = first(Intl.getCanonicalLocales(model.trgTag));
                for (let from of Intl.getCanonicalLocales(Object.keys(model.srcTags))) {
                    yield {from, to, model};
                }
            } catch (err) {
                console.log('Skipped model', model, err);
            }
        })

        // Check whether each of the models is already downloaded
        const cache = typeof caches !== 'undefined' ? caches.open(CACHE_NAME) : null;
        entries = await Promise.all(Array.from(entries, async (entry) => {
            // Give the model an id for easy look-up
            entry.model.id = ++serial;

            // Maybe we already have the model in memory
            entry.model.local = this.#hasTranslationModel(entry);

            // Check whether the model is in cache otherwise
            if (!entry.model.local && cache) {
                const response = await (await cache).match(entry.model.url);
                entry.model.local = response?.ok || false;
            }

            return entry;
        }));

        // Deduplicate models, preferring local ones above tiny ones, and tiny
        // ones above base models because of download size.
        entries = deduplicate(entries, {
            key({from, to}) {
                return `${from}:${to}`;
            },
            sort({model: a}, {model: b}) {
                if (a.local != b.local)
                    return (a.local ? 0 : 1) - (b.local ? 0 : 1);
                return (a.shortName.indexOf('tiny') === -1 ? 1 : 0) - (b.shortName.indexOf('tiny') === -1 ? 1 : 0)
            }
        });

        return Array.from(entries);
    }

    downloadModel(id) {
        return new PromiseWithProgress(async (accept, reject, update) => {
            try {
                const model = (await this.registry).find(({model}) => model.id === id);
                
                // Wait for the buffers to download & decompress
                const buffers = await this.loadTranslationModel(model, update);

                // Mark model as local now (mutates this.registry!)
                model.local = true;

                accept(buffers);
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
        const entry = (await this.registry).find(model => model.from == from && model.to == to);

        if (!entry)
            throw new Error(`No model for '${from}' -> '${to}'`);

        const compressedArchive = await this.getItemFromCacheOrWeb(entry.model.url, entry.model.checksum, update);

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
        return this.backing.downloadModel(id); // returns PromiseWithProgress
    }

    translate(request) {
        return this.translator.translate(request); // returns promise
    }

    remove(filter) {
        return this.translator.remove(filter);
    }

    delete() {
        return this.translator.delete(); // returns promise
    }
}
