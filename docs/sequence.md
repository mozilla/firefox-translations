# Message flow

This diagram shows a flow of messages and selected calls for the main translation events. It does not include telemetry, localization, status updates, quality estimation, automatic translation and other secondary functionality for simplicity.

`*` - background scripts,
`^` - web worker scripts,
the rest are content scripts

```mermaid
sequenceDiagram
    actor User
    participant m as mediator
    participant bg as backgroundScript*
    participant ld as LanguageDetection*
    participant tb as TranslationBar*
    participant nt as translation-notification*
    participant ntm as NotificationManager*
    participant t as Translation
    participant w as translationWorker^
    participant q as Queue^
    participant ipt as InPageTranslation
    participant obt as OutboundTranslation
    User->>+m: load page
    m-)+bg: monitorTabLoad
    deactivate m
    bg-)-m: responseMonitorTabLoad
    activate m
    m-)+bg: detectPageLanguage
    deactivate m
    bg->>+ld: detect language
    ld--)-bg: language detected
    bg-)-m: responseDetectPageLanguage
    activate m
    m-)+bg: displayTranslationBar
    bg-)+tb: show
    deactivate bg
    tb->>nt: init
    tb->>ntm: create
    deactivate tb
    m->>+t: create
    deactivate m
    t->>+w: load
    w->>+q: load
    deactivate q
    t->>w: config engine
    deactivate w
    deactivate t
    User->>+nt: enable translate of forms
    User->>nt: press "Translate" button
    nt->>+ntm: request translation
    deactivate nt
    ntm->>-bg: translationRequested
    activate bg
    bg-)-m: translationRequested
    activate m
    m->>+ipt: start
    ipt->>ipt: observe DOM
    deactivate m
    deactivate ipt
    activate ipt
    ipt->>+m: translate
    deactivate ipt
    m-)+bg: translate frame
    bg-)-m: pass to top frame
    m->>+t: translate
    deactivate m
    t-)+w: translate
    deactivate t
    w->>w: load engine
    w->>t: download models
    deactivate w
    t->>m: download models
    m->>+bg: download models
    bg->>bg: download models
    bg->>m: models
    deactivate bg
    m->>t: models
    t->>+w: load models
    w-)+t: displayOutboundTranslation
    t-)+m: displayOutboundTranslation
    deactivate t
    m-)+bg: displayOutboundTranslation
    bg-)-m: pass to all frames
    m->>+obt: start
    deactivate obt
    deactivate m
    w->>+q: enqueue
    w->>q: consume
    deactivate q
    w-)+t: translationComplete
    deactivate w
    t->>+m: translationComplete
    deactivate t
    m-)+bg: frame translationComplete
    bg-)-m: pass back to frame
    m->>+ipt: notify
    deactivate m
    ipt->>ipt: update DOM
    deactivate ipt
    User->>+obt: edit forms
    obt->>+m: translate
    deactivate obt
    deactivate m
    
    
    
    
```
