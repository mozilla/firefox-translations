/* eslint-disable no-global-assign */
/* eslint-disable no-native-reassign */
/* eslint-disable max-lines */

/* global engineRegistryRootURL, engineRegistryRootURLTest, engineRegistry, loadEmscriptenGlueCode, Queue */
/* global modelRegistryRootURL, modelRegistryRootURLTest, modelRegistry,importScripts */

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
 * Little wrapper around the message passing API to keep track of messages and
 * their responses in such a way that you can just wait for them by awaiting
 * the promise returned by `request()`.
 */
class Channel {
    constructor(port) {
        this.port = port;
        this.port.onMessage.addListener(this.onMessage.bind(this));
        this.serial = 0;
        this.pending = new Map();
    }

    request(command, data) {
        return new Promise((resolve, reject) => {
            const id = ++this.serial;
            this.pending.set(id, {resolve, reject});
            console.log('Sending', {id, command, data})
            this.port.postMessage({id, command, data});
        })
    }

    onMessage(message) {
        console.log('Received', message);
        
        if (message.id === undefined) {
            console.warn('Ignoring message from translateLocally that was missing the id', message);
        }

        if (message.update) {
            console.warn('Ignoring update messages for now, not implemented yet', message);
            return;
        }

        const {resolve, reject} = this.pending.get(message.id);
        this.pending.delete(message.id);

        if (!message.success)
            reject(message.error);
        else
            resolve(message.data);
    }
}

/**
 * Wrapper around bergamot-translator and model management. You only need
 * to call translate() which is async, the helper will manage execution by
 * itself.
 */
 class TranslationHelper {
    
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

            resolve(new Channel(port));
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

        return response.map(model => {
            const [from, to, ...rest] = model.shortname.split('-', 3);
            return {from, to, model};
        });
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

    async downloadModel(modelID) {
        const client = await this.client;
        const response = await client.request('DownloadModel', {modelID});
        return 
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