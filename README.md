# bergamot-translations
Bergamot Translations is a webextension that enables client side in-page translations for web browsers.

Bergamot Translations is a fork of [Firefox Translations](https://github.com/mozilla/firefox-translations) to experiment with an unprivileged translation plugin for browsers, and serve as a test platform for [bergamot-translator](https://github.com/browsermt/bergamot-translator). It misses many of the features Firefox Translations has.

# Instructions to run
- Install Firefox (Nightly for better performance when using WASM)
- Clone this repo and run `npm install`
- Run `npm run once:firefox` and wait until Firefox starts
- Browse to a page in any of the supported languages (https://github.com/mozilla/firefox-translations-models/#currently-supported-languages) to have the translation option to appear

# Instructions for Native Messaging
Download the latest release from the [TranslateLocally](https://github.com/XapaJIaMnu/translateLocally/releases) and start it once. This will register the native client with Firefox.

You can select TranslateLocally as your translation provider in the Preferences pane of the extension settings. Go to about://addons, click "Bergamot Translations", and click "Preferences".

# Google Chrome / Chromium
This branch has experimental support for Google Chrome, including native messaging. However, setup is a bit of a pita at the moment:

1. Clone or download this repository
2. Open Google Chrome, go to chrome://extensions/, and turn on developer mode (the toggle in top right corner)
3. Click _Load Unpacked_
4. Select the _extension_ folder in your local copy of this repository
5. Get & build [this branch of translateLocally](https://github.com/XapaJIaMnu/translateLocally/pull/101)
6. Once you have a binary of translateLocally, run `./translateLocally --allow-client AABBCC` where `AABBCC` is the extension _ID_ Chrome assigned to your installed version of this extension.
7. (Restart Chrome? Not sure this is necessary)
8. Go to the _Extension options_ page of this extension and select _TranslateLocally_ as translation provider.
