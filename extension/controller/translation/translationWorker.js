
/*
 * this class should only be instantiated the web worker
 * to serve as a helper and placeholoder for the translation related
 * objects like the underlying wasm module, the language models etc... and
 * their states of operation
 */
class TranslationHelper {

        constructor(postMessage) {
            // all variables specific to translation service
            this.translationService = null;
            this.responseOptions = null;
            this.input = null;
            // a map of language-pair to TranslationModel object
            this.translationModels = new Map();
            this.CACHE_NAME = "fxtranslations";
            this.postMessage = postMessage;
            this.engineIsLoaded = false;
            this.wasmModuleStartTimestamp = null;
            this.translationService = null;
            this.WasmEngineModule = null;
        }

        async loadTranslationEngine() {

            const itemURL = `${engineRegistryRootURL}${engineRegistry.bergamotTranslatorWasm.fileName}`;
            // first we load the wasm engine
            const wasmArrayBuffer = await this.getItemFromCacheOrWeb(
                itemURL,
                engineRegistry.bergamotTranslatorWasm.fileSize,
                engineRegistry.bergamotTranslatorWasm.sha256
            );
            const initialModule = {
                preRun: [
                    function() {
                        this.wasmModuleStartTimestamp = Date.now();
                    }.bind(this)
                ],
                onRuntimeInitialized: function() {

                    /*
                     * once we have the wasm engine module successfully
                     * initialized, we then load the language models
                     */
                    console.log(`Wasm Runtime initialized Successfully (preRun -> onRuntimeInitialized) in ${(Date.now() - this.wasmModuleStartTimestamp) / 1000} secs`);
                    this.loadLanguageModel();
                }.bind(this),
                wasmBinary: wasmArrayBuffer,
            };
            const { addOnPreMain, Module } = loadEmscriptenGlueCode(initialModule);
            this.WasmEngineModule = Module;

            // we finally set the flag to indicate the engine is loaded
            this.engineIsLoaded = true;
        }

        translate(message) {
            this.sourceLanguage = message.sourceLanguage;
            this.targetLanguage = message.targetLanguage;
            this.sourceParagraph = message.sourceParagraph;

            /*
             * if we don't have a fully working engine yet, we need to
             * initiate one
             */
            if (!this.engineIsLoaded) {
                this.loadTranslationEngine();
            }
        }

        async loadLanguageModel() {
            let start = Date.now();
            try {
              await this.constructTranslationService();
              await this.constructTranslationModel(this.sourceLanguage, this.targetLanguage);
              console.log(`Model '${this.sourceLanguage}${this.targetLanguage}' successfully constructed. Time taken: ${(Date.now() - start) / 1000} secs`);
            } catch (error) {
              console.log(`Model '${this.sourceLanguage}${this.targetLanguage}' construction failed: '${error.message} - ${error.stack}'`);
            }
            console.log(`loadLanguageModel command done, Posting message back to main script`);
        }

        // Instantiate the Translation Service
        async constructTranslationService() {
            if (!this.translationService) {
                let translationServiceConfig = {};
                console.log(`Creating Translation Service with config: ${translationServiceConfig}`);
                this.translationService = new this.WasmEngineModule.BlockingService(translationServiceConfig);
                console.log(`Translation Service created successfully`);
            }
        }

        async constructTranslationModel(from, to) {
            //delete all previously constructed translation models and clear the map
            this.translationModels.forEach((value, key) => {
                console.log(`Destructing model '${key}'`);
                value.delete();
            });
            this.translationModels.clear();

            /*
             * if none of the languages is English then construct multiple models with
             * English as a pivot language.
             */
            if (from !== "en" && to !== "en") {
                console.log(`Constructing model '${from}${to}' via pivoting: '${from}en' and 'en${to}'`);
                await Promise.all([
                    this.constructTranslationModelInvolvingEnglish(from, "en"),
                    this.constructTranslationModelInvolvingEnglish("en", to)
                ]);
            } else {
                console.log(`Constructing model '${from}${to}'`);
                await this.constructTranslationModelInvolvingEnglish(from, to);
            }
        }


        // eslint-disable-next-line max-lines-per-function
        async constructTranslationModelInvolvingEnglish(from, to) {
            const languagePair = `${from}${to}`;

            /*
             * for available configuration options,
             * please check: https://marian-nmt.github.io/docs/cmd/marian-decoder/
             * TODO: gemm-precision: int8shiftAlphaAll (for the models that support this)
             * DONOT CHANGE THE SPACES BETWEEN EACH ENTRY OF CONFIG
             */
            const modelConfig = `beam-size: 1
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
          gemm-precision: int8shiftAll
          `;

            const modelFile = `${modelRegistryRootURL}/${languagePair}/${modelRegistry[languagePair]["model"].name}`;
            const modelSize = modelRegistry[languagePair]["model"].size;
            const modelChecksum = modelRegistry[languagePair]["model"].expectedSha256Hash;

            const shortlistFile = `${modelRegistryRootURL}/${languagePair}/${modelRegistry[languagePair]["lex"].name}`;
            const shortlistSize = modelRegistry[languagePair]["lex"].size;
            const shortlistChecksum = modelRegistry[languagePair]["lex"].expectedSha256Hash;

            const vocabFile = `${modelRegistryRootURL}/${languagePair}/${modelRegistry[languagePair]["vocab"].name}`;
            const vocabFileSize = modelRegistry[languagePair]["vocab"].size;
            const vocabFileChecksum = modelRegistry[languagePair]["vocab"].expectedSha256Hash;

            // download the files as buffers from the given urls
            let start = Date.now();
            const downloadedBuffers = await Promise.all([
                this.getItemFromCacheOrWeb(modelFile, modelSize, modelChecksum),
                this.getItemFromCacheOrWeb(shortlistFile, shortlistSize, shortlistChecksum)
            ]);
            const modelBuffer = downloadedBuffers[0];
            const shortListBuffer = downloadedBuffers[1];

            console.log("vocabAsArrayBuffer antes");
            const downloadedVocabBuffers = [];
            const vocabAsArrayBuffer = await this.getItemFromCacheOrWeb(vocabFile, vocabFileSize, vocabFileChecksum);
            downloadedVocabBuffers.push(vocabAsArrayBuffer);
            console.log("vocabAsArrayBuffer depois");

            console.log(`Total Download time for all files of '${languagePair}': ${(Date.now() - start) / 1000} secs`);

            // cnstruct AlignedMemory objects with downloaded buffers
            let constructedAlignedMemories = await Promise.all([
                this.prepareAlignedMemoryFromBuffer(modelBuffer, 256),
                this.prepareAlignedMemoryFromBuffer(shortListBuffer, 64)
            ]);
            let alignedModelMemory = constructedAlignedMemories[0];
            let alignedShortlistMemory = constructedAlignedMemories[1];
            let alignedVocabsMemoryList = new this.WasmEngineModule.AlignedMemoryList();
            for (let item of downloadedVocabBuffers) {
              let alignedMemory = await this.prepareAlignedMemoryFromBuffer(item, 64);
              alignedVocabsMemoryList.push_back(alignedMemory);
            }
            for (let vocabs=0; vocabs < alignedVocabsMemoryList.size(); vocabs++) {
              console.log(`Aligned vocab memory${vocabs+1} size: ${alignedVocabsMemoryList.get(vocabs).size()}`);
            }
            console.log(`Aligned model memory size: ${alignedModelMemory.size()}`);
            console.log(`Aligned shortlist memory size: ${alignedShortlistMemory.size()}`);
            console.log(`Translation Model config: ${modelConfig}`);
            let translationModel;
            try {
                translationModel = new this.WasmEngineModule.TranslationModel(modelConfig, alignedModelMemory, alignedShortlistMemory, alignedVocabsMemoryList);
            } catch (exception) {
                console.log("exception here", exception);
            }
            if (translationModel) {
                this.translationModels.set(languagePair, translationModel);
            }
          }

        // eslint-disable-next-line max-lines-per-function
        async getItemFromCacheOrWeb(itemURL, fileSize, fileChecksum) {

            /*
             * there are two possible sources for the wasm modules: the Cache
             * API or the the network, so we check for their existence in the
             * former, and if it's not there, we download from the network and
             * save it in the cache
             */
            const cache = await caches.open(this.CACHE_NAME);
            let cache_match = await cache.match(itemURL);
            if (!cache_match) {

                /*
                 * no match for this object was found in the cache.
                 * we'll need to download it and inform the progress to the
                 * sender UI so it could display it to the user
                 */
                const response = await fetch(itemURL);
                if (response.status >= 200 && response.status < 300) {
                    await cache.put(itemURL, response.clone());
                    const reader = response.body.getReader();
                    const contentLength = fileSize;
                    let receivedLength = 0;
                    let chunks = [];
                    while (true) {
                        console.log(`Antes do reader.read ${receivedLength} of ${contentLength} ${itemURL}`);
                        const { done, value } = await reader.read();
                        if (done) {
                            break;
                        }
                        chunks.push(value);
                        receivedLength += value.length;
                        console.log(`Received ${receivedLength} of ${contentLength} ${itemURL} ${done}`);
                        if (receivedLength === contentLength) {
                            console.log(`Received ${receivedLength} of ${contentLength} ${itemURL} breaking`);
                            break;
                        }
                    }
                    let chunksAll = new Uint8Array(receivedLength);
                    let position = 0;
                    for (let chunk of chunks) {
                        chunksAll.set(chunk, position);
                        position += chunk.length;
                    }
                    console.log("stop here", itemURL);
                    cache_match = await cache.match(itemURL);
                    console.log("pass here", itemURL);
                } else {
                    console.log("TODO: ERROR DOWNLOADING ENGINE. REPORT TO UI");
                    return null;
                }
            }
            const arraybuffer = await cache_match.arrayBuffer();
            const sha256 = await this.digestSha256(arraybuffer);
            if (sha256 !== fileChecksum) {
                cache.delete(itemURL);
                console.log("TODO: CHECKSUM ERROR DOWNLOADING ENGINE. REPORT TO UI");
                return null;
            }
            return arraybuffer;
        }

        async digestSha256 (buffer) {
            // hash the message
            const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
            // convert buffer to byte array
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            // convert bytes to hex string
            return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        }

        // this function constructs and initializes the AlignedMemory from the array buffer and alignment size
        async prepareAlignedMemoryFromBuffer (buffer, alignmentSize) {
            var byteArray = new Int8Array(buffer);
            console.log(`Constructing Aligned memory. Size: ${byteArray.byteLength} bytes, Alignment: ${alignmentSize}`);
            var alignedMemory = new this.WasmEngineModule.AlignedMemory(byteArray.byteLength, alignmentSize);
            console.log("Aligned memory construction done");
            const alignedByteArrayView = alignedMemory.getByteArrayView();
            alignedByteArrayView.set(byteArray);
            console.log("Aligned memory initialized");
            return alignedMemory;
        }
}

const translationHelper = new TranslationHelper(postMessage);

onmessage = function(message) {

    switch (message.data[0]) {
        case "configEngine":
            importScripts(message.data[1].engineLocalPath);
            importScripts(message.data[1].engineRemoteRegistry);
            importScripts(message.data[1].modelRegistry);
            break;
        case "translate":

            translationHelper.translate(message.data[1]);

            /*
             *message.data[1].translatedParagraph = translationHelper.translatedParagraph;
             *postMessage([
             *    "translated",
             *    message.data[1]
             *]);
             */

            break;
        default:
            // ignore
      }
}