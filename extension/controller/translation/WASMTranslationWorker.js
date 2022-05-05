/**
 * Wrapper around the dirty bits of Bergamot's WASM bindings.
 */

// Global because importScripts is global.
var Module = {};

importScripts('yaml.js');

class WASMTranslationWorker {
    static GEMM_TO_FALLBACK_FUNCTIONS_MAP = {
        'int8_prepare_a': 'int8PrepareAFallback',
        'int8_prepare_b': 'int8PrepareBFallback',
        'int8_prepare_b_from_transposed': 'int8PrepareBFromTransposedFallback',
        'int8_prepare_b_from_quantized_transposed': 'int8PrepareBFromQuantizedTransposedFallback',
        'int8_prepare_bias': 'int8PrepareBiasFallback',
        'int8_multiply_and_add_bias': 'int8MultiplyAndAddBiasFallback',
        'int8_select_columns_of_b': 'int8SelectColumnsOfBFallback'
    };

    static NATIVE_INT_GEMM = 'mozIntGemm';

    /**
     * options: {useNativeIntGemm: false, cacheSize: 0}
     */
    constructor(options) {
        this.options = options || {};

        this.module = this.loadModule();

        this.service = this.loadTranslationService();

        this.models = new Map(); // Map<str,Promise<TranslationModel>>
    }

    linkNativeIntGemm(info) {
        if (!WebAssembly['mozIntGemm']) {
            console.warn('Native gemm requested but not available, falling back to embedded gemm');
            return linkFallbackIntGemm(info);
        }

        const instance = new WebAssembly.Instance(WebAssembly['mozIntGemm'](), {
            '': {memory: info['env']['memory']}
        });

        if (!Array.from(Object.keys(WASMTranslationWorker.GEMM_TO_FALLBACK_FUNCTIONS_MAP)).every(fun => instance.exports[fun])) {
            console.warn('Native gemm is missing expected functions, falling back to embedded gemm');
            return linkFallbackIntGemm(info);
        }

        console.info('Using native gemm');

        return instance.exports;
    }

    linkFallbackIntGemm(info) {
        const mapping = Object.entries(WASMTranslationWorker.GEMM_TO_FALLBACK_FUNCTIONS_MAP).map(([key, name]) => {
            return [key, (...args) => Module['asm'][name](...args)]
        });

        console.info('Using fallback gemm');

        return Object.fromEntries(mapping);
    }

    /**
     * Internal method. Reads and instantiates the WASM binary.
     */
    loadModule() {
        return new Promise(async (resolve, reject) => {
            const response = await fetch('bergamot-translator-worker.wasm');

            Object.assign(Module, {
                instantiateWasm: (info, accept) => {
                    WebAssembly.instantiateStreaming(response, {
                        ...info,
                        'wasm_gemm': this.options.useNativeIntGemm
                            ? this.linkNativeIntGemm(info)
                            : this.linkFallbackIntGemm(info)
                    }).then(({instance}) => accept(instance));

                    return {};
                },
                onRuntimeInitialized: () => {
                    resolve(Module);
                }
            });

            // Emscripten glue code
            importScripts('bergamot-translator-worker.js');
        });
    }

    /**
     * Internal method. Instantiates a BlockingService()
     */
    async loadTranslationService() {
        const Module = await this.module;
        return new Module.BlockingService({cacheSize: Math.max(this.options.cacheSize || 0, 0)});
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

        // This because service_bindings.cpp:prepareVocabsSmartMemories :(
        const uniqueVocabs = Array.from(new Set(buffers.vocabs));

        const [modelMemory, shortlistMemory, ...vocabMemory] = await Promise.all([
            this.prepareAlignedMemoryFromBuffer(buffers.model, 256),
            this.prepareAlignedMemoryFromBuffer(buffers.shortlist, 64),
            ...uniqueVocabs.map(vocab => this.prepareAlignedMemoryFromBuffer(vocab, 64))
        ]);

        const vocabs = new Module.AlignedMemoryList();
        vocabMemory.forEach(vocab => vocabs.push_back(vocab));

        // Defaults
        let modelConfig = YAML.parse(`
            beam-size: 1
            normalize: 1.0
            word-penalty: 0
            cpu-threads: 0
            gemm-precision: int8shiftAlphaAll
        `);

        if (buffers.config)
            Object.assign(modelConfig, buffers.config);

        // WASM marian is only compiled with support for shiftedAll.
        if (modelConfig['gemm-precision'] === 'int8')
            modelConfig['gemm-precision'] = 'int8shiftAll';

        // Override these
        Object.assign(modelConfig, YAML.parse(`
            skip-cost: true
            alignment: soft
            quiet: true
            quiet-translation: true
            max-length-break: 128
            mini-batch-words: 1024
            workspace: 128
            max-length-factor: 2.0
        `));

        console.debug('Model config:', YAML.stringify(modelConfig));
                
        const key = JSON.stringify({from,to});
        this.models.set(key, new Module.TranslationModel(YAML.stringify(modelConfig), modelMemory, shortlistMemory, vocabs, null));
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
    async translate({models, texts}) {
        const Module = await this.module;
        const service = await this.service;

        // Convert texts array into a std::vector<std::string>.
        let input = new Module.VectorString();
        texts.forEach(({text}) => input.push_back(text));

        // Extracts the texts[].html options into ResponseOption objects
        let options = new Module.VectorResponseOptions();
        texts.forEach(({html}) => options.push_back({qualityScores: false, alignment: false, html}));

        // Turn our model names into a list of TranslationModel pointers
        const translationModels = models.map(({from,to}) => {
            const key = JSON.stringify({from,to});
            return this.models.get(key);
        });

        // translate the input, which is a vector<String>; the result is a vector<Response>
        const responses = models.length > 1
            ? service.translateViaPivoting(...translationModels, input, options)
            : service.translate(...translationModels, input, options);
        
        input.delete();
        options.delete();

        // Convert the Response WASM wrappers into native JavaScript types we
        // can send over the 'wire' (message passing) in the same format as we
        // use in bergamot-translator.
        const translations = texts.map((_, i) => ({
            target: {
                text: responses.get(i).getTranslatedText()
            }
        }));

        responses.delete();

        return translations;
    }
}

onmessage = ({data}) => {
    if (!data.options){
        console.warn('Did not receive initial message with options');
        return;
    }

    const worker = new WASMTranslationWorker(data.options);

    // Responder for Proxy<Channel> created in TranslationHelper.loadWorker()
    onmessage = async ({data: {id, message}}) => {
        try {
            const result = await worker[message.name](...message.args);
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
}
