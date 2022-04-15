# Message flow

This diagram shows a flow of messages and selected calls for specifically the remote language model down(loading) step.

`^` - web worker scripts,
the rest are content scripts

```mermaid
sequenceDiagram
    participant m as mediator
    participant t as Translation
    participant w as translationWorker^
    participant cache as Cache - Web API
    participant gcp as Mozilla's GCP
    m->>+t: translate
    t-)+w: translate
    w->>w: loadTranslationEngine()
    w->>w: loadLanguageModel()
    w->>w: constructTranslationService()
    w->>w: constructTranslationModel()
    w->>w: constructTranslationModelHelper()
    w->>w: downloadFiles()
    w->>w: getItemFromCacheOrWeb()
    w->>cache: cache.match(Model)
    alt cache match
        cache->>w: (Model as ArrayBuffer)
    else cache not matched
        cache->>gcp: Download model
        cache->>w: (Model as ArrayBuffer)
    end
    w->>w: this.digestSha256(arraybuffer)
    Note right of w: Validate model's hash
    w->>w: prepareAlignedMemoryFromBuffer(buffer, fileAlignment):alignedMemories
    w->>w: new WasmEngineModule.AlignedMemoryList(alignedMemories):alignedMemoryList
    w->>w: new WasmEngineModule.TranslationModel(alignedMemoryList)
    w->>w: consumeTranslationQueue()
