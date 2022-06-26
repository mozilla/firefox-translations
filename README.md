[![Build](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml/badge.svg)](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml) [![CodeQL](https://github.com/mozilla/firefox-translations/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/mozilla/firefox-translations/actions/workflows/codeql-analysis.yml) [![End-to-End Tests](https://github.com/mozilla/firefox-translations/actions/workflows/e2etest.yml/badge.svg?branch=main&event=push)](https://github.com/mozilla/firefox-translations/actions/workflows/e2etest.yml)  [![Firefox Translations - Install Nightly](https://img.shields.io/badge/Firefox_Translations-Install_Nightly-2ea44f)](https://github.com/mozilla/firefox-translations/releases/download/nightly/firefox_translations.xpi)  [![CODE OF CONDUCT](https://img.shields.io/badge/Contributing-Code%20of%20Conduct-blue)](https://github.com/mozilla/firefox-translations/blob/master/CODE_OF_CONDUCT.md)  [![LICENSE](https://img.shields.io/badge/LICENSE-MPL-blue)](https://github.com/mozilla/firefox-translations/blob/master/LICENSE)


# Firefox Translations
Firefox Translations is a WebExtension that enables client side in-page translations for web browsers.

Firefox Translations was developed with The Bergamot Project Consortium, coordinated by the University of Edinburgh with partners Charles University in Prague, the University of Sheffield, University of Tartu, and Mozilla. This project has received funding from the European Union’s Horizon 2020 research and innovation programme under grant agreement No 825303.

## Release version

The current release version is available for installation on Mozilla Add-ons

[![AMO](https://ffp4g1ylyit3jdyti1hqcvtb-wpengine.netdna-ssl.com/addons/files/2015/11/get-the-addon-small.png)](https://addons.mozilla.org/firefox/addon/firefox-translations/)

## Supported languages

#### Production
- Spanish
- Estonian
- English
- German
- Czech
- Bulgarian
- Portuguese
- Italian
- French
- Polish

#### Development
- Russian
- Persian (Farsi)
- Icelandic
- Norwegian Nynorsk
- Norwegian Bokmål
- Ukrainian

## Testing

### Nightly builds

You can test nightly builds of the extension in Firefox Nightly or Developer Edition in one of the [supported languages](#supported-languages) by following the steps below:
- Type `about:config` in the navigation bar and set the following preferences:

```
    xpinstall.signatures.required to false
    extensions.experiments.enabled to true
```

- Then install the extension by clicking here  [![Firefox Translations - Install Nightly](https://img.shields.io/badge/Firefox_Translations-Install_Nightly-2ea44f)](https://github.com/mozilla/firefox-translations/releases/download/nightly/firefox_translations.xpi)
- You may need to restart your browser and Firefox Translations will be ready to use. Just browse to a website in one of the [supported languages](#supported-languages) and the option to translate should be displayed.

## Development

### 3rd party dependencies

The extension does not utilize any npm modules, and the only vendored dependencies within are:

- Bergamot Translator

    - A WebAssembly wrapper around the actual Neural Machine Translator, [Marian](https://github.com/marian-nmt/marian-dev/). The code to build the WASM module can be found on its [repository](https://github.com/mozilla/bergamot-translator#build-wasm)

- Fasttext
    - We bundle the WebAssembly port of fasttext along its [compressed model](https://fasttext.cc/docs/en/language-identification.html) in order to detect the page's language. Instructions to build the WebAssembly module can be [found here](https://fasttext.cc/docs/en/webassembly-module.html)

- Sentry
    - We bundle [Sentry Javascript's SDK](https://github.com/getsentry/sentry-javascript) for error reporting.

- serialize-error
  - code of [serialize-error npm package](https://github.com/sindresorhus/serialize-error) is bundled for serialization of exceptions to
    report errors from content scripts to background script

### How to run
- Install Firefox Nightly
- Clone this repo and run `npm install`
- Run `npm run once` and wait until Nightly starts
- Go to `about:config` and set `extensions.experiments.enabled` to true
- Browse to a page in any of the [supported languages](#supported-languages) to have the translation option to appear


### Updating telemetry schema

After adding new metrics to `extension/model/telemetry/metrics.yaml` or pings to `extension/model/telemetry/pings.yaml`, run
```
bash scripts/update-telemetry-schema.sh
```
to regenerate JS telemetry schema.

### Updating bergamot-translator WASM module

Replace
- `extension/controller/translation/bergamot-translation-worker.js`
- `extension/model/static/translation/bergamot-translator-worker.wasm`

with the new artifacts and then execute:

```
bash scripts/update-bergamot-translator.sh
```

to regenerate JS version file. This version is reported in telemetry.
