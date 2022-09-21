import { lazy, flatten, first, deduplicate } from '../shared/func.js';
import { PromiseWithProgress } from '../shared/promise.js';
import compat from '../shared/compat.js';

/**
 * Little wrapper around the message passing API to keep track of messages and
 * their responses in such a way that you can just wait for them by awaiting
 * the promise returned by `request()`.
 */
class PortChannel {
    constructor(port) {
        this.port = port;
        this.port.onMessage.addListener(this.onMessage.bind(this));
        this.serial = 0;
        this.pending = new Map();
    }

    request(command, data) {
        return new PromiseWithProgress((resolve, reject, update) => {
            const id = ++this.serial;
            this.pending.set(id, {resolve, reject, update});
            this.port.postMessage({id, command, data});
        })
    }

    onMessage(message) {
        if (message.id === undefined) {
            console.warn('Ignoring message from translateLocally that was missing the id', message);
            return;
        }
        
        const {resolve, reject, update} = this.pending.get(message.id);

        if (!message.update)
            this.pending.delete(message.id);

        if (message.update)
            update(message.data);
        else if (!message.success)
            reject(message.error);
        else
            resolve(message.data);
    }

    disconnect() {
        this.port.disconnect();
    }
}

/**
 * Wrapper around TranslateLocally native messaging API.
 */
export default class TLTranslationHelper {

    constructor(options) {
        this.threads = Math.max(options?.workers || 1, 1);

        this.cacheSize = Math.max(options?.cacheSize || 0, 0);

        this.client = lazy(this.loadNativeClient.bind(this));

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

        // Error handler for all errors that are async, not tied to a specific
        // call and that are unrecoverable.
        this.onerror = err => console.error('TranslateLocally error:', err);
    }

    async loadNativeClient() {
        const port = compat.runtime.connectNative('translatelocally');

        port.onDisconnect.addListener(() => {
            if (port.error)
                this.onerror(port.error);
        });

        const channel = new PortChannel(port);

        // "Configure" is not yet implemented in main branch, but as long as
        // we're not doing performance analysis that is fine.
        try {
            await channel.request('Configure', {
                threads: this.threads,
                cacheSize: this.cacheSize
            });
        } catch (e) {
            if (e.toString().includes('Unrecognised message command')) {
                console.warn("Older version of TranslateLocally found without 'Configure' command");
            } else {
                throw e; // Some other error
            }
        }

        return channel;
    }

    /**
     * Loads the model registry. Uses the registry shipped with this extension,
     * but formatted a bit easier to use, and future-proofed to be swapped out
     * with a TranslateLocally type registry. Returns Promise<List<Model>>
     */
    async loadModelRegistery() {
        const client = await this.client;
        const models = await client.request('ListModels', {includeRemote: true});

        // Add 'from' and 'to' keys for each model. Since theoretically a model
        // can have multiple from keys in TranslateLocally, we do a little
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
        });

        // Deduplicate models, preferring local ones above tiny ones, and tiny
        // ones above base models because of download size.
        entries = deduplicate(entries, {
            key({from, to}) {
                return `${from}:${to}`;
            },
            sort({model: a}, {model: b}) {
                if (a.local != b.local)
                    return (a.local ? 0 : 1) - (b.local ? 0 : 1);

                // TODO: why is it "shortname" no capital N here, but "shortName" in the index?
                // Bug in TranslateLocally? Yep! https://github.com/XapaJIaMnu/translateLocally/issues/118
                const key = 'shortname' in a ? 'shortname' : 'shortName'

                return (a[key].indexOf('tiny') === -1 ? 1 : 0) - (b[key].indexOf('tiny') === -1 ? 1 : 0)
            }
        });

        return Array.from(entries);
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
    async translate(request) {
        const client = await this.client;
        const response = await client.request('Translate', {
            src: request.from, // TODO: Use `model` and `pivot` and model ids?
            trg: request.to,
            text: request.text,
            html: request.html
        });
        return Object.assign(response, {request})
    }

    downloadModel(modelID) {
        // TODO Dirty dirty hack I don't want to wrap it manually just to
        // propagate the progress messages.
        return new PromiseWithProgress(async (accept, reject, update) => {
            const client = await this.client;
            const response = client.request('DownloadModel', {modelID});
            response.addProgressListener(update);
            response.then(accept, reject);

            // Also update this.registry to reflect that this model is now local
            response.then(async () => {
                const models = await this.registry;
                const model = models.find(({model: id}) => id === modelID);
                model.local = true;
            })
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

    /**
     * Releases the connection, effectively stopping TranslateLocally running
     * in the background.
     */
    async delete() {
        if (this.client.instantiated) {
            const client = await this.client;
            client.disconnect();
        }
    }
}
