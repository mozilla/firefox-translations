# bergamot-translations
Bergamot Translations is a webextension that enables client side in-page translations for web browsers.

Bergamot Translations is a fork of [Firefox Translations](https://github.com/mozilla/firefox-translations) to experiment with an unprivileged translation plugin for browsers, and serve as a test platform for [bergamot-translator](https://github.com/browsermt/bergamot-translator). It misses many of the features Firefox Translations has.

# Instructions to run
- Install Firefox Nightly
- Clone this repo and run `npm install`
- Run `npm run once` and wait until Nightly starts
- Browse to a page in any of the supported languages (https://github.com/mozilla/firefox-translations-models/#currently-supported-languages) to have the translation option to appear

# Instructions for Native Messaging
Download the latest build from the [native messaging branch of TranslateLocally](https://github.com/XapaJIaMnu/translateLocally/actions?query=branch%3Anativemsg_cli) and start it once. This will register the native client with Firefox.

You can select TranslateLocally as your translation provider in the Preferences pane of the extension settings. Go to about://addons, click "Bergamot Translations", and click "Preferences".