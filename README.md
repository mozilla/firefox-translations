# bergamot-translations
Bergamot Translations is a webextension that enables client side in-page translations for web browsers.

Bergamot Translations is a fork of [Firefox Translations](https://github.com/mozilla/firefox-translations) to experiment with an unprivileged translation plugin for browsers, and serve as a test platform for [bergamot-translator](https://github.com/browsermt/bergamot-translator). It misses many of the features Firefox Translations has.

# Instructions to run
- Install Firefox Nightly
- Clone this repo and run `npm install`
- Run `npm run once` and wait until Nightly starts
- Browse to a page in any of the supported languages (https://github.com/mozilla/firefox-translations-models/#currently-supported-languages) to have the translation option to appear

# Instructions for Native Messaging
Place this in a file called `translateLocally.json`:
- macOS: `~/Library/Application Support/Mozilla/NativeMessagingHosts/<name>.json`
- Linux: `~/.mozilla/native-messaging-hosts/<name>.json`
- Windows: more complicated, see [native manifest location docs](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_manifests#manifest_location).

You'll want to update the path to reflect wherever you have translateLocally build or installed. The extension ID has to match what is in `manifest.json` in this repo.

```json
{
  "name": "translateLocally",
  "description": "Example host for native messaging",
  "path": "/absolute/path/to/translateLocally/build/translateLocally",
  "type": "stdio",
  "allowed_extensions": [ "{c9cdf885-0431-4eed-8e18-967b1758c951}" ]
}
```