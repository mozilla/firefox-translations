# Components

## content-script
Entrypoint: mediator.js

Responsibilities:
- Maintaining the translation state (described below)
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
- Maintain one instance of the translation engine and manage its queues
- Manage downloading & loading of translation models on demand
- Language detection on given samples

# States
This is a list of all possible states a page (or the mediator) can be in.

Todo: Not covered is a way to return to the untranslated page. Might be tricky to implement if we're doing swapping DOM nodes and all that magic. For now I'll assume the user can just reload the page to get the untranslated page back.

## PAGE_LOADING
Page is still in a loading state. Initial state.

Next state:
- content-script will sample some text from the page once it has loaded and switch states to PAGE_LOADED.

## PAGE_LOADED
Page is loaded.

Fields:
- text-sample

Next state:
- background-script will notice PAGE_LOADED and attempt language detection. Once it identified a language, it will switch state to LANGUAGE_DETECTED

## LANGUAGE_DETECTED
Language detector detected the language

Fields:
- languages (list of ISO codes and their probability)

Next state:
- background-script checks whether there is a translation path available from the detected language to the navigator's language. (or future: the last used target language)

## TRANSLATION_NOT_AVAILABLE
There is no translation model available to translate this page from the detected language to the navigator's language.

Next state:
- None

## TRANSLATION_AVAILABLE
There is a translation path available.

Fields:
- language-from
- language-to
- available-languages-from
- available-languages-to

Actions:
- background-script tells page action icon to show

Next state:
- page-action popup can be opened to select language and trigger translation, which will switch to TRANSLATION_IN_PROGRESS

## TRANSLATION_IN_PROGRESS

Fields:
- language-from
- language-to
- chunks-queued
- chunks-total
- words-per-second

Action:
- popup will show progress bar based on chunks-queued and chunks-total. unless chunks-queued is 0, then it will show "done" or something?
- content-script will start submitting chunks of HTML or text to background-script for translation

Message format for these translation requests:
- tab-id
- request-id
- lang-from: str
- lang-to: str
- html: bool
- body: str (text or html)

Next state:
- background-script will switch to TRANSLATION_IN_PROGRESS (but with updated fields) while it is handling translation requests
- background-script can switch to TRANSLATION_ERROR when an an (irrecoverable) error occurs during translation

## Not used: TRANSLATION_ERROR

Fields:
- language-from
- language-to
- error-message (if available)

## Not used: TRANSLATION_FINISHED

Fields:
- language-from
- language-to
- total-chunks
- words-per-second
