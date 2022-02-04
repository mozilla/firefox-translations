// Emscripten glue code
importScripts('bergamot-translator-worker.js');

/**
 * Wrapper around the dirty bits of Bergamot's WASM bindings.
 */
class TranslationWorker {
    constructor() {
        this.module = this.loadModule();

        this.service = this.loadTranslationService();

        this.models = new Map(); // Map<str,Promise<TranslationModel>>
    }

    /**
     * Internal method. Reads and instantiates the WASM binary.
     */
    loadModule() {
        return new Promise(async (resolve, reject) => {
            const response = await fetch("bergamot-translator-worker.wasm");
            const wasmBinary = await response.arrayBuffer();

            const { addOnPreMain, Module } = loadEmscriptenGlueCode({
                    wasmBinary,
                    preRun: [
                            () => {
                                    // this.wasmModuleStartTimestamp = Date.now();
                            }
                    ],
                    onRuntimeInitialized: () => {
                            resolve(Module);
                    }
            });
        })
    }

    /**
     * Internal method. Instantiates a BlockingService()
     */
    async loadTranslationService() {
        const Module = await this.module;
        return new Module.BlockingService({});
    }

    /**
     * Returns whether a model has already been loaded in this worker. Marked
     * async because the message passing interface we use expects async methods.
     */ 
    async hasTranslationModel({from,to}) {
        const key = JSON.stringify({from,to});
        return this.models.has(key);
    }

    /**
     * Loads a translation model from a set of file buffers. After this, the
     * model is available to translate with and `hasTranslationModel()` will
     * return true for this pair.
     */ 
    async loadTranslationModel({from, to}, buffers) {
        const Module = await this.module;
        
        const [modelMemory, vocabMemory, shortlistMemory] = await Promise.all([
            this.prepareAlignedMemoryFromBuffer(buffers.model, 256),
            this.prepareAlignedMemoryFromBuffer(buffers.vocab, 64),
            this.prepareAlignedMemoryFromBuffer(buffers.shortlist, 64)
        ]);

        const vocabs = new Module.AlignedMemoryList();
        vocabs.push_back(vocabMemory);

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
                
        const key = JSON.stringify({from,to});
        this.models.set(key, new Module.TranslationModel(modelConfig, modelMemory, shortlistMemory, vocabs));
    }

    /**
     * Internal function. Copies the data from an ArrayBuffer into memory that
     * can be used inside the WASM vm by Marian.
     */
    async prepareAlignedMemoryFromBuffer(buffer, alignmentSize) {
        const Module = await this.module;
        const bytes = new Int8Array(buffer);
        const memory = new Module.AlignedMemory(bytes.byteLength, alignmentSize);
        memory.getByteArrayView().set(bytes);
        return memory;
    }

    /**
     * Public. Does actual translation work. You have to make sure that the
     * models necessary for translating text are already loaded before calling
     * this method.
     */
    async translate({models, texts, options}) {
        console.log('Worker translate called with', {models, texts, options});

        const Module = await this.module;
        const service = await this.service;

        // const htmlOptions = new Module.HTMLOptions();
        // htmlOptions.setContinuationDelimiters("\n ,.(){}[]0123456789");
        // htmlOptions.setSubstituteInlineTagsWithSpaces(true);

        const responseOptions = {
            qualityScores: false,
            alignment: false,
            html: options.html || false,
            // htmlOptions
        };

        // Convert texts array into a std::vector<std::string>.
        let input = new Module.VectorString();
        texts.forEach(text => input.push_back(text));

        // Turn our model names into a list of TranslationModel pointers
        const translationModels = models.map(({from,to}) => {
            const key = JSON.stringify({from,to});
            return this.models.get(key);
        });

        // translate the input, which is a vector<String>; the result is a vector<Response>
        const responses = models.length > 1
            ? service.translateViaPivoting(...translationModels, input, responseOptions)
            : service.translate(...translationModels, input, responseOptions);
        
        input.delete();
        // htmlOptions.delete();

        // Convert the Response WASM wrappers into native JavaScript types we
        // can send over the 'wire' (message passing)
        const translations = texts.map((_, i) => ({
            translation: responses.get(i).getTranslatedText()
        }));

        responses.delete();

        return translations;
    }
}

const worker = new TranslationWorker();

// Responder for Proxy<Channel> created in TranslationHelper.loadWorker()
onmessage = async ({data: {id, message}}) => {
    try {
        const result = await worker[message.name].apply(worker, message.args);
        postMessage({id, message: result});
    } catch (err) {
        console.error(err);
        postMessage({
            id,
            error: {
                name: err.name,
                message: err.message
            }
        });
    }
};