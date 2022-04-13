/* eslint-disable no-global-assign */
/* eslint-disable no-native-reassign */
/* eslint-disable max-lines */

/* global loadEmscriptenGlueCode, Queue */
/* global modelRegistryRootURL, modelRegistryRootURLTest, modelRegistry,importScripts, Sentry, settings */


let engineWasmLocalPath;

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

            // a map of language-pair to TranslationModel object
            this.translationModels = new Map();
            this.CACHE_NAME = "fxtranslations";
            this.postMessage = postMessage;
            this.wasmModuleStartTimestamp = null;
            this.WasmEngineModule = null;
            this.engineState = this.ENGINE_STATE.LOAD_PENDING;
            this.PIVOT_LANGUAGE = "en";
            this.totalPendingElements = 0;
            // alignment for each file type, file type strings should be same as in the model registry
            this.modelFileAlignments = {
                "model": 256,
                "lex": 64,
                "vocab": 64,
                "qualityModel": 64,
            }
        }

        get ENGINE_STATE () {
            return {
                LOAD_PENDING: 0,
                LOADING: 1,
                LOADED: 2
              };
        }

        async loadTranslationEngine(sourceLanguage, targetLanguage, withOutboundTranslation, withQualityEstimation) {
            postMessage([
                "updateProgress",
                "loadingTranslationEngine"
            ]);
            // first we load the wasm engine
            const response = await fetch(engineWasmLocalPath);
            if (!response.ok) {
                postMessage(["reportError", "engine_download"]);
                console.log("Error loading engine as buffer.");
                return;
            }
            const wasmArrayBuffer = await response.arrayBuffer();
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
                    this.loadLanguageModel(sourceLanguage, targetLanguage, withOutboundTranslation, withQualityEstimation);
                }.bind(this),
                wasmBinary: wasmArrayBuffer,
            };
            try {
                // eslint-disable-next-line no-unused-vars
                const { addOnPreMain, Module } = loadEmscriptenGlueCode(initialModule);
                this.WasmEngineModule = Module;
            } catch (e) {
                console.log("Error loading wasm module:", e);
                postMessage(["reportError", "engine_load"]);
                postMessage(["updateProgress", "errorLoadingWasm"]);
            }
        }

        translateOutboundTranslation(message) {
            Promise.resolve().then(function () {
                let total_words = message[0].sourceParagraph.replace(/(<([^>]+)>)/gi, "").trim()
                                    .split(/\s+/).length;
                const t0 = performance.now();

                /*
                 * quality scores are not required for outbound translation. So we set the
                 * corresponding flag to false before calling translate api and restore
                 * its value after the api call is complete.
                 */
                let originalQualityEstimation = message[0].withQualityEstimation;
                message[0].withQualityEstimation = false;
                const translationResultBatch = this.translate(message);
                message[0].withQualityEstimation = originalQualityEstimation;
                const timeElapsed = [total_words, performance.now() - t0];

                message[0].translatedParagraph = translationResultBatch[0];
                // and then report to the mediator
                postMessage([
                    "translationComplete",
                    message,
                    timeElapsed
                ]);
            }.bind(this));
        }

        // eslint-disable-next-line max-lines-per-function
        consumeTranslationQueue() {

            while (this.translationQueue.length() > 0) {
                const translationMessagesBatch = this.translationQueue.dequeue();
                this.totalPendingElements += translationMessagesBatch.length;
                postMessage([
                    "updateProgress",
                    ["translationProgress", [`${this.totalPendingElements}`]]
                ]);
                // eslint-disable-next-line max-lines-per-function
                Promise.resolve().then(function () {
                    if (translationMessagesBatch && translationMessagesBatch.length > 0) {
                        try {
                            let total_words = 0;
                            translationMessagesBatch.forEach(message => {
                                let words = message.sourceParagraph.replace(/(<([^>]+)>)/gi, "").trim()
                                                .split(/\s+/);
                                total_words += words.length;
                            });

                            /*
                             * engine doesn't return QE scores for the translation of Non-HTML source
                             * messages. Therefore, always encode and pass source messages as HTML to the
                             * engine and restore them afterwards to their original form.
                             */
                            const non_html_qe_messages = new Map();
                            translationMessagesBatch.forEach((message, index) => {
                                if (message.withQualityEstimation && !message.isHTML) {
                                    console.log(`Plain text received to translate with QE: "${message.sourceParagraph}"`);
                                    non_html_qe_messages.set(index, message.sourceParagraph);
                                    const div = document.createElement("div");
                                    div.appendChild(document.createTextNode(message.sourceParagraph));
                                    message.sourceParagraph = div.innerHTML;
                                    message.isHTML = true;
                                }
                            });

                            const t0 = performance.now();
                            const translationResultBatch = this.translate(translationMessagesBatch);
                            const timeElapsed = [total_words, performance.now() - t0];

                            /*
                             * restore Non-HTML source messages that were encoded to HTML before being sent to
                             * engine to get the QE scores for their translations. The translations are not
                             * required to be decoded back to non-HTML form because QE scores are embedded in
                             * the translation via html attribute.
                             */
                            non_html_qe_messages.forEach((value, key) => {
                                console.log("Restoring back source text and html flag");
                                translationMessagesBatch[key].sourceParagraph = value;
                                translationMessagesBatch[key].isHTML = false;
                            });

                            /*
                             * now that we have the paragraphs back, let's reconstruct them.
                             * we trust the engine will return the paragraphs always in the same order
                             * we requested
                             */
                            translationResultBatch.forEach((result, index) => {
                                translationMessagesBatch[index].translatedParagraph = result;
                            });
                            // and then report to the mediator
                            postMessage([
                                "translationComplete",
                                translationMessagesBatch,
                                timeElapsed
                            ]);
                            this.totalPendingElements -= translationMessagesBatch.length;
                            postMessage([
                                "updateProgress",
                                ["translationProgress", [`${this.totalPendingElements}`]]
                            ]);
                        } catch (e) {
                            postMessage(["reportError", "translation"]);
                            postMessage(["updateProgress", "translationLoadedWithErrors"]);
                            console.error("Translation error: ", e)
                            Sentry.captureException(e);
                            throw e;
                        }
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
                    this.engineState = this.ENGINE_STATE.LOADING;
                    this.loadTranslationEngine(
                        message[0].sourceLanguage,
                        message[0].targetLanguage,
                        message[0].withOutboundTranslation,
                        message[0].withQualityEstimation
                    );

                    this.translationQueue.enqueue(message);
                    break;
                case this.ENGINE_STATE.LOADING:

                    /*
                     * if we get a translation request while the engine is
                     * being loaded, we enqueue the messae and break
                     */
                    this.translationQueue.enqueue(message);
                    break;

                case this.ENGINE_STATE.LOADED:
                    if (message[0] && message[0].type === "outbound") {

                        /*
                         * we skip the line if the message is from ot.
                         * and since we know this is OT, there's only one msg
                         */
                        this.translateOutboundTranslation([message[0]]);
                    } else {
                        this.translationQueue.enqueue(message);
                        this.consumeTranslationQueue()
                    }
                    break;
                default:
            }
        }

    // eslint-disable-next-line max-lines-per-function
        async loadLanguageModel(sourceLanguage, targetLanguage, withOutboundTranslation, withQualityEstimation) {

            /*
             * let's load the models and communicate to the caller (translation)
             * when we are finished
             */
            let start = Date.now();
            let isReversedModelLoadingFailed = false;
            try {
              this.constructTranslationService();
              await this.constructTranslationModel(sourceLanguage, targetLanguage, withQualityEstimation);

              if (withOutboundTranslation) {
                  try {
                    // the Outbound Translation doesn't require supporting Quality Estimation
                    await this.constructTranslationModel(targetLanguage, sourceLanguage, /* withQualityEstimation=*/false);
                    postMessage([
                        "displayOutboundTranslation",
                        null
                    ]);
                  } catch (ex) {
                      console.warn("Error while constructing a reversed model for outbound translation. It might be not supported.", ex)
                      isReversedModelLoadingFailed = true;
                  }
              }
              let finish = Date.now();
              console.log(`Model '${sourceLanguage}${targetLanguage}' successfully constructed. Time taken: ${(finish - start) / 1000} secs`);
              postMessage([
                "reportPerformanceTimespan",
                "model_load_time_num",
                finish-start
              ]);

            } catch (error) {
              console.log(`Model '${sourceLanguage}${targetLanguage}' construction failed: '${error.message} - ${error.stack}'`);
              postMessage(["reportError", "model_load"]);
              postMessage(["updateProgress", "errorLoadingWasm"]);
              return;
            }
            this.engineState = this.ENGINE_STATE.LOADED;
            if (isReversedModelLoadingFailed) {
                postMessage(["updateProgress","translationEnabledNoOT"]);
            } else {
                postMessage(["updateProgress","translationEnabled"]);
            }

            this.consumeTranslationQueue();
            console.log("loadLanguageModel function complete");
        }

        // instantiate the Translation Service
        constructTranslationService() {
            if (!this.translationService) {
                let translationServiceConfig = { cacheSize: 10 };
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

        async constructTranslationModel(from, to, withQualityEstimation) {
            if (this._isPivotingRequired(from, to)) {
                // pivoting requires 2 translation models to be constructed
                const languagePairSrcToPivot = this._getLanguagePair(from, this.PIVOT_LANGUAGE);
                const languagePairPivotToTarget = this._getLanguagePair(this.PIVOT_LANGUAGE, to);
                await Promise.all([
                    this.constructTranslationModelHelper(languagePairSrcToPivot, withQualityEstimation),
                    this.constructTranslationModelHelper(languagePairPivotToTarget, withQualityEstimation)
                ]);
            } else {
                // non-pivoting case requires only 1 translation model
                await this.constructTranslationModelHelper(this._getLanguagePair(from, to), withQualityEstimation);
            }
        }

        // eslint-disable-next-line max-lines-per-function
        async constructTranslationModelHelper(languagePair, withQualityEstimation) {
            console.log(`Constructing translation model ${languagePair}`);
            const modelConfigQualityEstimation = !withQualityEstimation;

            /*
             * for available configuration options,
             * please check: https://marian-nmt.github.io/docs/cmd/marian-decoder/
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
            skip-cost: ${modelConfigQualityEstimation}
            cpu-threads: 0
            quiet: true
            quiet-translation: true
            gemm-precision: int8shiftAlphaAll
            alignment: soft
            `;

            // download files into buffers
            let start = Date.now();

            let donwloadedBuffersPromises = [];
            Object.entries(this.modelFileAlignments)
                .filter(([fileType]) => fileType !== "qualityModel" || withQualityEstimation)
                .filter(([fileType]) => Reflect.apply(Object.prototype.hasOwnProperty, modelRegistry[languagePair], [fileType]))
                .map(([fileType, fileAlignment]) => donwloadedBuffersPromises.push(this.downloadFiles(fileType, fileAlignment, languagePair)));

            let donwloadedBuffers = await Promise.all(donwloadedBuffersPromises);

            let finish = Date.now();
            console.log(`Total Download time for all files of '${languagePair}': ${(finish - start) / 1000} secs`);
            postMessage([
                "reportPerformanceTimespan",
                "model_download_time_num",
                finish-start
            ]);

            // prepare aligned memories from buffers
            let alignedMemories = [];
            donwloadedBuffers.forEach(entry => alignedMemories.push(this.prepareAlignedMemoryFromBuffer(entry.buffer, entry.fileAlignment)));

            const alignedModelMemory = alignedMemories[0];
            const alignedShortlistMemory = alignedMemories[1];
            const alignedVocabMemoryList = new this.WasmEngineModule.AlignedMemoryList();
            alignedVocabMemoryList.push_back(alignedMemories[2]);
            let alignedQEMemory = null;
            let alignedMemoryLogMessage = `Aligned memory sizes: Model:${alignedModelMemory.size()}, Shortlist:${alignedShortlistMemory.size()}, Vocab:${alignedMemories[2].size()}, `;
            if (alignedMemories.length === Object.entries(this.modelFileAlignments).length) {
                alignedQEMemory = alignedMemories[3];
                alignedMemoryLogMessage += `QualityModel: ${alignedQEMemory.size()}`;
            }
            console.log(`Translation Model config: ${modelConfig}`);
            console.log(alignedMemoryLogMessage);

            // construct model
            let translationModel = new this.WasmEngineModule.TranslationModel(modelConfig, alignedModelMemory, alignedShortlistMemory, alignedVocabMemoryList, alignedQEMemory);
            this.translationModels.set(languagePair, translationModel);

            // report metric about supervised/non-supervised qe model only if qe feature is on
            if (withQualityEstimation) {
                let isSuperVised = alignedQEMemory !== null;
                postMessage([
                    "reportQeIsSupervised",
                    isSuperVised
                ]);
            }
        }

        _isPivotingRequired(from, to) {
            return from !== this.PIVOT_LANGUAGE && to !== this.PIVOT_LANGUAGE;
        }

        _getLanguagePair(from, to) {
            return `${from}${to}`;
        }

        // download files as buffers from given urls
        async downloadFiles(fileType, fileAlignment, languagePair) {
            const fileName = `${modelRegistryRootURL}/${languagePair}/${modelRegistry[languagePair][fileType].name}`;
            const fileSize = modelRegistry[languagePair][fileType].size;
            const fileChecksum = modelRegistry[languagePair][fileType].expectedSha256Hash;
            const buffer = await this.getItemFromCacheOrWeb(fileName, fileSize, fileChecksum);
            if (!buffer) {
                console.error(`Error loading models from cache or web ("${fileType}")`);
                postMessage(["onError", "model_download"]);
                throw new Error(`Error loading models from cache or web ("${fileType}")`);
            }
            return {
                buffer,
                fileAlignment,
                fileType,
            };
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
            const MAX_DOWNLOAD_TIME = 60000;
            if (!cache_match) {

                /*
                 * no match for this object was found in the cache.
                 * we'll need to download it and inform the progress to the
                 * sender UI so it could display it to the user
                 */
                console.log("no cache match. downloading");
                let response = null;
                try {
                    response = await fetch(itemURL);
                } catch (exception) {
                    console.log(`Error downloading translation modules. (${itemURL} not found)`);
                    postMessage([
                        "updateProgress",
                        "notfoundErrorsDownloadingEngine"
                    ]);
                    return null;
                }

                if (response.status >= 200 && response.status < 300) {
                    await cache.put(itemURL, response.clone());
                    const reader = response.body.getReader();
                    const contentLength = fileSize;
                    let receivedLength = 0;
                    let chunks = [];
                    let doneReading = false;
                    let value = null;
                    const tDownloadStart = performance.now();
                    let elapsedTime = 0;
                    while (!doneReading) {
                        console.log(`elapsedTime after doneReading ${elapsedTime}`);
                        if (elapsedTime > MAX_DOWNLOAD_TIME) {
                            console.log("timeout");
                            cache.delete(itemURL);
                            postMessage([
                                "updateProgress",
                                "timeoutDownloadingEngine"
                            ]);
                            return null;
                        }
                        // eslint-disable-next-line no-await-in-loop
                        const response = await reader.read();
                        doneReading = response.done;
                        value = response.value;
                        console.log(`elapsedTime after reader.read ${elapsedTime} - doneReading ${doneReading}`);
                        elapsedTime = performance.now() - tDownloadStart;

                        if (doneReading) {
                            break;
                        }

                        if (value) {
                            chunks.push(value);
                            receivedLength += value.length;
                            console.log(`Received ${receivedLength} of ${contentLength} ${itemURL}.`);
                            postMessage([
                                "updateProgress",
                                ["downloadProgress", [`${receivedLength}`,`${contentLength}`]]
                            ]);
                        } else {
                            cache.delete(itemURL);
                            postMessage([
                                "updateProgress",
                                "nodataDownloadingEngine"
                            ]);
                            return null;
                        }

                        if (receivedLength === contentLength) {
                            doneReading = true;
                        }
                    }
                    console.log("wasm saved to cache");
                    cache_match = await cache.match(itemURL);
                } else {
                    cache.delete(itemURL);
                    postMessage([
                        "updateProgress",
                        "notfoundErrorsDownloadingEngine"
                    ]);
                    return null;
                }
            }
            const arraybuffer = await cache_match.arrayBuffer();
            const sha256 = await this.digestSha256(arraybuffer);
            if (!sha256) {
                postMessage([
                    "updateProgress",
                    "tlsIncompatibility"
                ]);
                return null;
            }

            if (sha256 !== fileChecksum) {
                cache.delete(itemURL);
                postMessage([
                    "updateProgress",
                    "checksumErrorsDownloadingEngine"
                ]);
                return null;
            }
            return arraybuffer;
        }

        async digestSha256 (buffer) {
            // hash the message
            if (!crypto.subtle) return null;
            const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
            // convert buffer to byte array
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            // convert bytes to hex string
            return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
        }

        // this function constructs and initializes the AlignedMemory from the array buffer and alignment size
        prepareAlignedMemoryFromBuffer (buffer, alignmentSize) {
            let byteArray = new Int8Array(buffer);
            let alignedMemory = new this.WasmEngineModule.AlignedMemory(byteArray.byteLength, alignmentSize);
            const alignedByteArrayView = alignedMemory.getByteArrayView();
            alignedByteArrayView.set(byteArray);
            return alignedMemory;
        }

        // eslint-disable-next-line max-lines-per-function
        translate (messages) {
            const from = messages[0].sourceLanguage;
            const to = messages[0].targetLanguage;

            /*
             * vectorResponseOptions, vectorSourceText are the arguments of translate API
             * and vectorResponse is the result where each of its item corresponds to an item
             * of vectorSourceText in the same order.
             */
            let vectorResponse, vectorResponseOptions, vectorSourceText;
            try {
                vectorResponseOptions = this._prepareResponseOptions(messages);
                vectorSourceText = this._prepareSourceText(messages);

                if (this._isPivotingRequired(from, to)) {
                    // translate via pivoting
                    const translationModelSrcToPivot = this._getLoadedTranslationModel(from, this.PIVOT_LANGUAGE);
                    const translationModelPivotToTarget = this._getLoadedTranslationModel(this.PIVOT_LANGUAGE, to);
                    vectorResponse = this.translationService.translateViaPivoting(translationModelSrcToPivot, translationModelPivotToTarget, vectorSourceText, vectorResponseOptions);
                } else {
                    // translate without pivoting
                    const translationModel = this._getLoadedTranslationModel(from, to);
                    vectorResponse = this.translationService.translate(translationModel, vectorSourceText, vectorResponseOptions);
                }

                // parse all relevant information from vectorResponse
                const listTranslatedText = this._parseTranslatedText(vectorResponse);
                return listTranslatedText;
            } catch (e) {
                console.error("Error in translation engine ", e)
                postMessage(["reportError", "marian"]);
                postMessage(["updateProgress", "translationLoadedWithErrors"]);
                throw e; // to do: Should we re-throw?
            } finally {
                // necessary clean up
                if (typeof vectorSourceText !== "undefined") vectorSourceText.delete();
                if (typeof vectorResponseOptions !== "undefined") vectorResponseOptions.delete();
                if (typeof vectorResponse !== "undefined") vectorResponse.delete();
            }
        }

        _getLoadedTranslationModel(from, to) {
            const languagePair = this._getLanguagePair(from, to);
            if (!this.translationModels.has(languagePair)) {
                throw Error(`Translation model '${languagePair}' not loaded`);
            }
            return this.translationModels.get(languagePair);
        }

        _prepareResponseOptions(messages) {
            const vectorResponseOptions = new this.WasmEngineModule.VectorResponseOptions();
            // eslint-disable-next-line no-unused-vars
            messages.forEach(message => {
                vectorResponseOptions.push_back({
                    qualityScores: message.withQualityEstimation,
                    alignment: true,
                    html: message.isHTML,
                });
            });
            if (vectorResponseOptions.size() === 0) {
                vectorResponseOptions.delete();
                throw Error("No Translation Options provided");
            }
            return vectorResponseOptions;
        }

        _prepareSourceText(messages) {
            let vectorSourceText = new this.WasmEngineModule.VectorString();
            messages.forEach(message => {
                const sourceParagraph = message.sourceParagraph;
                // prevent empty paragraph - it breaks the translation
                if (sourceParagraph.trim() === "") return;
                vectorSourceText.push_back(sourceParagraph);
            })
            if (vectorSourceText.size() === 0) {
                vectorSourceText.delete();
                throw Error("No text provided to translate");
            }
            return vectorSourceText;
          }

        _parseTranslatedText(vectorResponse) {
            const result = [];
            for (let i = 0; i < vectorResponse.size(); i+=1) {
              const response = vectorResponse.get(i);
              result.push(response.getTranslatedText());
            }
            return result;
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
            importScripts("/model/Queue.js");
            importScripts(message.data[1].engineScriptLocalPath);
            engineWasmLocalPath = message.data[1].engineWasmLocalPath;
            importScripts(message.data[1].modelRegistry);
            importScripts(message.data[1].sentryScript);
            importScripts(message.data[1].settingsScript);
            if (message.data[1].isMochitest){
                // running tests. let's setup the proper tests endpoints
                // eslint-disable-next-line no-global-assign
                modelRegistryRootURL = modelRegistryRootURLTest;
            }
            Sentry.init({
                dsn: settings.sentryDsn,
              tracesSampleRate: 1.0,
              debug: settings.sentryDebug,
              release: `firefox-translations@${message.data[1].version}`
            });
            break;
        case "translate":
            Sentry.wrap(() => translationHelper.requestTranslation(message.data[1]));
            break;
        default:
            // ignore
      }
}