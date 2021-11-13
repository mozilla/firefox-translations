/* eslint-disable max-lines */

/* global engineRegistryRootURL, engineRegistry, loadEmscriptenGlueCode, Queue */
/* global modelRegistryRootURL, modelRegistry,importScripts */

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
            this.wasmModuleStartTimestamp = null;
            this.WasmEngineModule = null;
            this.engineState = this.ENGINE_STATE.LOAD_PENDING;
        }


        get ENGINE_STATE () {
            return {
                LOAD_PENDING: 0,
                LOADING: 1,
                LOADED: 2
              };
        }

        async loadTranslationEngine(sourceLanguage, targetLanguage) {
            postMessage([
                "updateProgress",
                "Loading Translation Engine"
            ]);
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
                    this.loadLanguageModel(sourceLanguage, targetLanguage);
                }.bind(this),
                wasmBinary: wasmArrayBuffer,
            };
            // eslint-disable-next-line no-unused-vars
            const { addOnPreMain, Module } = loadEmscriptenGlueCode(initialModule);
            this.WasmEngineModule = Module;
        }

        consumeTranslationQueue() {

            while (this.translationQueue.length() > 0) {
                const translationMessage = this.translationQueue.dequeue();
                Promise.resolve().then(function () {
                    // if there's a paragraph, then we translate
                    if (translationMessage.sourceParagraph) {
                        const translation = this.translate(
                            translationMessage.sourceLanguage,
                            translationMessage.targetLanguage,
                            translationMessage.sourceParagraph
                        );

                        // now that we have a translation, let's report to the mediator
                        translationMessage.translatedParagraph = translation;
                        postMessage([
                            "translationComplete",
                            translationMessage
                        ]);
                    }
                  }.bind(this));
            }
        }

        requestTranslation(message) {

            /*
             * there are three possible states to the engine:
             * INIT, LOADING, LOADED
             * the engine is put on LOAD_PENDING mode when the worker is constructed, on
             * LOADING when the first request is made and the engine is still on
             * LOAD_PENDING, and on LOADED when the langauge model is loaded
             */

            switch (this.engineState) {
                // if the engine hasn't loaded yet.
                case this.ENGINE_STATE.LOAD_PENDING:
                    this.translationQueue = new Queue();
                    // let's change the state to loading
                    this.engineState = this.ENGINE_STATE.LOADING;
                    // and load the module
                    this.loadTranslationEngine(
                        message.sourceLanguage,
                        message.targetLanguage
                    );
                    this.translationQueue.enqueue(message);
                    break;
                case this.ENGINE_STATE.LOADING:

                    /*
                     * if we get a translation request while the engine is
                     * being loaded, we just wait for it, so we break
                     */
                    this.translationQueue.enqueue(message);
                    break;

                case this.ENGINE_STATE.LOADED:

                    this.translationQueue.enqueue(message);
                    // engine and model are loaded, so let's consume
                    this.consumeTranslationQueue()
                    break;
                default:
            }
        }

        async loadOutboundTranslation(message) {

            /*
             * load the outbound translation model
             */
            let start = Date.now();
            try {
                await this.constructTranslationModel(message.from, message.to);
                console.log(`Outbound Model '${message.from}${message.to}' successfully constructed. Time taken: ${(Date.now() - start) / 1000} secs`);
                // model was lodaded properly, let's communicate the mediator and the UI
                postMessage([
                    "updateProgress",
                    "Automatic page and form translations loaded."
                ]);
                postMessage([
                    "displayOutboundTranslation",
                    null
                ]);
            } catch (error) {
              console.log(`Outbound Model '${message.from}${message.to}' construction failed: '${error.message} - ${error.stack}'`);
            }
        }

        async loadLanguageModel(sourceLanguage, targetLanguage) {

            /*
             * let's load the models and communicate to the caller (translation)
             * when we are finished
             */
            let start = Date.now();
            try {
              await this.constructTranslationService();
              await this.constructTranslationModel(sourceLanguage, targetLanguage);
              console.log(`Model '${sourceLanguage}${targetLanguage}' successfully constructed. Time taken: ${(Date.now() - start) / 1000} secs`);
            } catch (error) {
              console.log(`Model '${sourceLanguage}${targetLanguage}' construction failed: '${error.message} - ${error.stack}'`);
            }
            this.engineState = this.ENGINE_STATE.LOADED;
            postMessage([
                "updateProgress",
                "Automatic Translation enabled"
            ]);
            this.consumeTranslationQueue();
            console.log("loadLanguageModel function complete");
        }

        // instantiate the Translation Service
        constructTranslationService() {
            if (!this.translationService) {
                let translationServiceConfig = {};
                console.log(`Creating Translation Service with config: ${translationServiceConfig}`);
                this.translationService = new this.WasmEngineModule.BlockingService(translationServiceConfig);
                console.log("Translation Service created successfully");
            }
        }

        deleteModels() {
            // delete all previously constructed translation models and clear the map
            this.translationModels.forEach((value, key) => {
                console.log(`Destructing model '${key}'`);
                value.delete();
            });
            this.translationModels.clear();
        }

        async constructTranslationModel(from, to) {

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
            gemm-precision: int8shiftAll
            `;

            const modelFile = `${modelRegistryRootURL}/${languagePair}/${modelRegistry[languagePair].model.name}`;
            const modelSize = modelRegistry[languagePair].model.size;
            const modelChecksum = modelRegistry[languagePair].model.expectedSha256Hash;

            const shortlistFile = `${modelRegistryRootURL}/${languagePair}/${modelRegistry[languagePair].lex.name}`;
            const shortlistSize = modelRegistry[languagePair].lex.size;
            const shortlistChecksum = modelRegistry[languagePair].lex.expectedSha256Hash;

            const vocabFile = `${modelRegistryRootURL}/${languagePair}/${modelRegistry[languagePair].vocab.name}`;
            const vocabFileSize = modelRegistry[languagePair].vocab.size;
            const vocabFileChecksum = modelRegistry[languagePair].vocab.expectedSha256Hash;

            // download the files as buffers from the given urls
            let start = Date.now();
            const downloadedBuffers = await Promise.all([
                this.getItemFromCacheOrWeb(modelFile, modelSize, modelChecksum),
                this.getItemFromCacheOrWeb(shortlistFile, shortlistSize, shortlistChecksum)
            ]);
            const modelBuffer = downloadedBuffers[0];
            const shortListBuffer = downloadedBuffers[1];

            const downloadedVocabBuffers = [];
            const vocabAsArrayBuffer = await this.getItemFromCacheOrWeb(vocabFile, vocabFileSize, vocabFileChecksum);
            downloadedVocabBuffers.push(vocabAsArrayBuffer);

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
              // eslint-disable-next-line no-await-in-loop
              let alignedMemory = await this.prepareAlignedMemoryFromBuffer(item, 64);
              alignedVocabsMemoryList.push_back(alignedMemory);
            }
            for (let vocabs=0; vocabs < alignedVocabsMemoryList.size(); vocabs+=1) {
              console.log(`Aligned vocab memory${vocabs+1} size: ${alignedVocabsMemoryList.get(vocabs).size()}`);
            }
            console.log(`Aligned model memory size: ${alignedModelMemory.size()}`);
            console.log(`Aligned shortlist memory size: ${alignedShortlistMemory.size()}`);
            console.log(`Translation Model config: ${modelConfig}`);
            let translationModel;

            translationModel = new this.WasmEngineModule.TranslationModel(modelConfig, alignedModelMemory, alignedShortlistMemory, alignedVocabsMemoryList);
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
                    let doneReading = false;
                    let value = null;
                    while (!doneReading) {
                        // eslint-disable-next-line no-await-in-loop
                        ({ doneReading, value } = await reader.read());
                        chunks.push(value);
                        receivedLength += value.length;
                        postMessage([
                            "updateProgress",
                            `Downloaded ${receivedLength} of ${contentLength}`
                        ]);
                        console.log(`Received ${receivedLength} of ${contentLength} ${itemURL} ${doneReading}`);
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
                    cache_match = await cache.match(itemURL);
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
        prepareAlignedMemoryFromBuffer (buffer, alignmentSize) {
            var byteArray = new Int8Array(buffer);
            console.log(`Constructing Aligned memory. Size: ${byteArray.byteLength} bytes, Alignment: ${alignmentSize}`);
            var alignedMemory = new this.WasmEngineModule.AlignedMemory(byteArray.byteLength, alignmentSize);
            console.log("Aligned memory construction done");
            const alignedByteArrayView = alignedMemory.getByteArrayView();
            alignedByteArrayView.set(byteArray);
            console.log("Aligned memory initialized");
            return alignedMemory;
        }

        translate (from, to, paragraphs) {

            /*
             * if none of the languages is English then perform translation with
             * english as a pivot language.
             */
            if (from !== "en" && to !== "en") {
                let translatedParagraphsInEnglish = this.translateInvolvingEnglish(from, "en", paragraphs);
                return this.translateInvolvingEnglish("en", to, translatedParagraphsInEnglish);
            }
            return this.translateInvolvingEnglish(from, to, paragraphs);
        }

        translateInvolvingEnglish (from, to, paragraphs) {
            const languagePair = `${from}${to}`;
            if (!this.translationModels.has(languagePair)) {
                throw Error(`Please load translation model '${languagePair}' before translating`);
            }
            const translationModel = this.translationModels.get(languagePair);

            // instantiate the arguments of translate() API i.e. ResponseOptions and input (vector<string>)
            const responseOptions = new this.WasmEngineModule.ResponseOptions();
            let input = new this.WasmEngineModule.VectorString();

            // initialize the input
            let total_words = 0;
            paragraphs.forEach(paragraph => {
                // prevent empty paragraph - it breaks the translation
                if (paragraph.trim() === "") {
                    return;
                }
                input.push_back(paragraph);
                total_words += paragraph.trim().split(" ").length;
            })

            const t0 = performance.now();
            // translate the input, which is a vector<String>; the result is a vector<Response>
            let result = this.translationService.translate(translationModel, input, responseOptions);
            const timeElapsed = [total_words, performance.now() - t0];

            const translatedParagraphs = [];
            const translatedSentencesOfParagraphs = [];
            const sourceSentencesOfParagraphs = [];
            for (let i = 0; i < result.size(); i+=1) {
                translatedParagraphs.push(result.get(i).getTranslatedText());
                translatedSentencesOfParagraphs.push(this.getAllTranslatedSentencesOfParagraph(result.get(i)));
                sourceSentencesOfParagraphs.push(this.getAllSourceSentencesOfParagraph(result.get(i)));
            }

            responseOptions.delete();
            input.delete();
            return [translatedParagraphs, timeElapsed];
        }

        // this function extracts all the translated sentences from the Response and returns them.
        getAllTranslatedSentencesOfParagraph (response) {
            const sentences = [];
            const text = response.getTranslatedText();
            for (let sentenceIndex = 0; sentenceIndex < response.size(); sentenceIndex+=1) {
                const utf8SentenceByteRange = response.getTranslatedSentence(sentenceIndex);
                sentences.push(this._getSentenceFromByteRange(text, utf8SentenceByteRange));
            }
            return sentences;
        }

        // this function extracts all the source sentences from the Response and returns them.
        getAllSourceSentencesOfParagraph (response) {
            const sentences = [];
            const text = response.getOriginalText();
            for (let sentenceIndex = 0; sentenceIndex < response.size(); sentenceIndex+=1) {
                const utf8SentenceByteRange = response.getSourceSentence(sentenceIndex);
                sentences.push(this._getSentenceFromByteRange(text, utf8SentenceByteRange));
            }
            return sentences;
        }

        /*
         * this function returns a substring of text (a string). The substring is represented by
         * byteRange (begin and end endices) within the utf-8 encoded version of the text.
         */
        _getSentenceFromByteRange (text, byteRange) {
            const encoder = new TextEncoder(); // string to utf-8 converter
            const decoder = new TextDecoder(); // utf-8 to string converter
            const utf8BytesView = encoder.encode(text);
            const utf8SentenceBytes = utf8BytesView.subarray(byteRange.begin, byteRange.end);
            return decoder.decode(utf8SentenceBytes);
        }
}

const translationHelper = new TranslationHelper(postMessage);
onmessage = function(message) {

    switch (message.data[0]) {
        case "configEngine":
            importScripts("Queue.js");
            importScripts(message.data[1].engineLocalPath);
            importScripts(message.data[1].engineRemoteRegistry);
            importScripts(message.data[1].modelRegistry);
            break;
        case "translate":
            translationHelper.requestTranslation(message.data[1]);
            break;
        case "loadOutboundTranslation":
            translationHelper.loadOutboundTranslation(message.data[1]);
            break;
        default:
            // ignore
      }
}