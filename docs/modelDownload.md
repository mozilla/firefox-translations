# Message flow

This diagram shows a flow of messages and selected calls for specifically the remote language model down(loading) step.

`^` - web worker scripts,
`*` - background script

The rest are content scripts

```mermaid
sequenceDiagram
    participant b as backgroundScript*
    participant m as mediator
    participant t as Translation
    participant w as translationWorker^
    participant cache as Cache - Web API
    participant gcp as Mozilla's GCP
    m->>+t: translate
    t-)+w: translate
    w->>w: loadTranslationEngine()
    w->>w: getLanguageModels()
    w->>t: downloadLanguageModels
    t->>m: downloadLanguageModels
    m->>b: downloadLanguageModels
    b->>b: getLanguageModels()
    b->>b: getLanguageModel()
    b->>b: downloadFile()
    b->>b: getItemFromCacheOrWeb()
    b->>cache: cache.match(Model)
    alt cache match
        cache->>b: (Model as Blob)
    else cache not matched
        b->>b: getItemFromWeb()
        b->>gcp: Download Model
        gcp->>b: Model
        b->>b: digestSha256(Model as Arraybuffer)
        Note right of b: Validate Model's hash
        b->>cache: cache.put(Model as Blob)
        cache->>b: (Model as Blob)
    end
    b->>m: responseDownloadLanguageModels  (Model as Blob) 
    m->>t: sendDownloadedLanguageModels (Model as Blob)
    t->>w: responseDownloadLanguageModels  (Model as Blob)
    w->>w: loadLanguageModel(Model as Blob)
    w->>w: constructTranslationService()
    w->>w: constructTranslationModel()
    w->>w: constructTranslationModelHelper()
    w->>w: fetchFile()
    w->>w: Blob.arrayBuffer()
    w->>w: prepareAlignedMemoryFromBuffer(buffer, fileAlignment):alignedMemories
    w->>w: new WasmEngineModule.AlignedMemoryList(alignedMemories):alignedMemoryList
    w->>w: new WasmEngineModule.TranslationModel(alignedMemoryList)
    w->>w: consumeTranslationQueue()
