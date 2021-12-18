[![Build](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml/badge.svg)](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml) [![CodeQL](https://github.com/mozilla/firefox-translations/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/mozilla/firefox-translations/actions/workflows/codeql-analysis.yml)


# firefox-translations
Firefox Translations is a webextension that enables client side in-page translations for web browsers.

# Instructions to run
- Install Firefox Nightly
- Clone this repo and run `npm install`
- Run `npm run once` and wait until Nightly starts
- Go to `about:config` and set `extensions.experiments.enabled` to true
- Browse to a page in any of the supported languages (https://github.com/mozilla/firefox-translations-models/#currently-supported-languages) to have the translation option to appear