# Components

## content-script
Entrypoint: contentScript.js

Responsibilities:
- Text sample extraction
- In-page translation processing

## page-action popup
Entrypoint: static/popup.html

Responsibilities:
- UI to trigger translation
- UI to update on translation progress

Notes:
- Does not have state, popup will reset every time it closes or loses focus.

## background-script
Entrypoint: controller/backgroundScript.js

Responsibilities:
- Maintaining the translation state per tab
- Maintain one instance of the translation engine and manage its queues
- Manage downloading & loading of translation models on demand
- Language detection on given samples

Tab state:
```
{
	id: Number, // tab id
	from: String, // BCP47
	to: String, // BCP47
	models: [
		{
			from: String, // BCP47
			to: String // BCP47
		}
	], // All available from->to pairs, sorted by relevance
	frames: {
		[Number]: Port
	}
}
```

# States
This is a list of all possible states a page (or the mediator) can be in.

Todo: Not covered is a way to return to the untranslated page. Might be tricky to implement if we're doing swapping DOM nodes and all that magic. For now I'll assume the user can just reload the page to get the untranslated page back.

## PAGE_LOADING
Page is still in a loading state. Initial state.

Next state:
- content-script will sample some text from the page once it has loaded and switch states to PAGE_LOADED.

## PAGE_LOADED
Page is loaded.

Actions:
- content-script will connect with background-script
- content-script will send sample to background-script

Next state:
- background-script will switch to TRANSLATION_AVAILABLE or TRANSLATION_NOT_AVAILABLE based on the languages detected in the sample and available translation models.

## TRANSLATION_AVAILABLE
Language detector detected the language

Fields: {
	from: String, // BCP47, detected from language
	to: String, // BCP47, navigator target language)
	models: [
		{
			from: String, // BCP47
			to: String // BCP47
		}
	] // All available from->to pairs, sorted by relevance
}

Actions:
- background-script tells page action icon to show

Next state:
- page-action popup can be opened to select language and trigger translation, which will switch to TRANSLATION_IN_PROGRESS

## TRANSLATION_NOT_AVAILABLE
There is no translation model available to translate this page from the detected language to the navigator's language.

Next state:
- None

## TRANSLATION_IN_PROGRESS

Action:
- popup will show progress bar based on chunks-queued and chunks-total. unless chunks-queued is 0, then it will show "done" or something?
- content-script will start submitting chunks of HTML or text to background-script for translation

Next state:
- background-script will switch to TRANSLATION_IN_PROGRESS (but with updated fields) while it is handling translation requests
- background-script can switch to TRANSLATION_ERROR when an an (irrecoverable) error occurs during translation

## Not used: TRANSLATION_ERROR

## Not used: TRANSLATION_FINISHED

# TranslationHelper & Co

Translations are done by Marian, wrapped in bergamot-translator, which is compiled to WASM. bergamot-translator exposes a `BlockingService` which you can give a bunch of sentences and a translation model, and it will start crunching.

Couple of things to take into account:

- BlockingService blocks while crunching, so it needs to be put in a WebWorker to not block up the current thread.
- BlockingService needs a bunch of text to translate to reach peak performance. If you give it too little chunks, it will run slow.
- It does not do threads (in WASM at least, yet?)

TranslationHelper puts those limitations in a nice interface:

- It provides a simple `translate()` method that you give some text, a source and target language, and it will give you a promise of a translation back.
- It has the option to cancel and prioritize translation requests. You can use these features to optimise for latency like TranslateLocally does!
- It does the grouping of translation requests for you
- It handles downloading translation model data, initialisation, etc. You just need to worry about calling `translate()` and waiting a bit.
- It can use multiple TranslationWorkers in parallel (threads!)

TranslationWorker provides an interface for TranslationHelper to work with the bergamot-translator WASM binary through a message passing interface. It translates the weird emscripten pointer types in native JavaScript types that can be shared through message passing, and takes care of loading and initialisation of the bergamot-translator-native types.

