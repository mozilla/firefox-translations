/* eslint-disable no-global-assign */
/* eslint-disable no-native-reassign */
/* eslint-disable max-lines */

/* global engineRegistryRootURL, engineRegistryRootURLTest, engineRegistry, loadEmscriptenGlueCode, Queue */
/* global modelRegistryRootURL, modelRegistryRootURLTest, modelRegistry,importScripts */


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
            console.log('Sending', {id, command, data})
            this.port.postMessage({id, command, data});
        })
    }

    onMessage(message) {
        console.log('Received', message);
        
        if (message.id === undefined) {
            console.warn('Ignoring message from translateLocally that was missing the id', message);
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
}

/**
 * Wrapper around TranslateLocally native messaging API.
 */
 class TLTranslationHelper {
    
    constructor() {
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
    }

    async loadNativeClient() {
        return new Promise((resolve, reject) => {
            const port = browser.runtime.connectNative('translateLocally');

            port.onDisconnect.addListener((e) => {
                console.log('translateLocally disconnected', port.error);
            });

            resolve(new PortChannel(port));
        });
    }

    /**
     * Loads the model registry. Uses the registry shipped with this extension,
     * but formatted a bit easier to use, and future-proofed to be swapped out
     * with a TranslateLocally type registry. Returns Promise<List<Model>>
     */
    async loadModelRegistery() {
        const client = await this.client;
        const response = await client.request('ListModels', {includeRemote: true});

        // Add 'from' and 'to' keys for each model. Since theoretically a model
        // can have multiple froms keys in TranslateLocally, we do a little
        // product here.
        return Array.from(flatten(response, function*(model) {
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
    async translate(request) {
        const client = await this.client;
        const response = await client.request('Translate', {
            src: request.from,
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
