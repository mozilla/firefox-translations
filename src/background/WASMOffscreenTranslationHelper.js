export default class WASMOffscreenTranslationHelper {
    #initialized;

    constructor(options) {
        this.#initialized = (async () => {
            const offscreenURL = chrome.runtime.getURL('offscreen.html');

            // Check if offscreen page is already available
            const matchedClients = await clients.matchAll();
            if (!matchedClients.some(client => client.url === offscreenURL)) {
                await chrome.offscreen.createDocument({
                    url: offscreenURL,
                    reasons: [chrome.offscreen.Reason.WORKERS],
                    justification: 'Translation engine'
                });
            }

            // Re-initialise regardless (TODO: really?)
            const {error} = await chrome.runtime.sendMessage({
                target: 'offscreen',
                command: 'Initialize',
                data: {
                    args: [options]
                }
            });

            if (error !== undefined)
                throw error;
            
            return true;
        })();
    }

    async #call(name, args) {
        await this.#initialized;

        const {result, error} = await chrome.runtime.sendMessage({
            target: 'offscreen',
            command: 'Call',
            data: {name, args}
        });

        if (error !== undefined)
            throw error;

        return result;
    }

    #get(property) {
        return new Promise(async (accept, reject) => {
            await this.#initialized;
            
            const out = await chrome.runtime.sendMessage({
                target: 'offscreen',
                command: 'Get',
                data: {property}
            });

            const {result, error} = out;

            if (error !== undefined)
                reject(error)
            else
                accept(result);
        });
    }

    get registry() {
        return this.#get('registry');
    }

    downloadModel(id) {
        return this.#call('downloadModel', [id]); // normally returns PromiseWithProgress
    }

    translate(request) {
        return this.#call('translate', [request]);
    }

    remove(filter) {
        // Haha not implemented yet
    }

    delete() {
        chrome.offscreen.closeDocument();
        this.#initialized = null;
    }
}