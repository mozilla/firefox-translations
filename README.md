[![Build](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml/badge.svg)](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml) [![CodeQL](https://github.com/mozilla/firefox-translations/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/mozilla/firefox-translations/actions/workflows/codeql-analysis.yml) [![End-to-End Tests](https://github.com/mozilla/firefox-translations/actions/workflows/e2etest.yml/badge.svg?branch=main&event=push)](https://github.com/mozilla/firefox-translations/actions/workflows/e2etest.yml)  [![Firefox Translations - Install Nightly](https://img.shields.io/badge/Firefox_Translations-Install_Nightly-2ea44f)](https://github.com/mozilla/firefox-translations/releases/download/nightly/firefox_translations.xpi)


# Firefox Translations
Firefox Translations is a WebExtension that enables client side in-page translations for web browsers.

## Testing

### Nightly builds

You can test nightly builds of the extension in Firefox Nightly or Developer Edition in one of the [langauges supported](https://pontoon.mozilla.org/projects/firefox-translations-add-on/) by following the steps below:
- Type `about:config` in the navigation bar and set the following preferences:

```
    xpinstall.signatures.required to false
    extensions.experiments.enabled to true
```

- Then install the extension by clicking here  [![Firefox Translations - Install Nightly](https://img.shields.io/badge/Firefox_Translations-Install_Nightly-2ea44f)](https://github.com/mozilla/firefox-translations/releases/download/nightly/firefox_translations.xpi)
- You may need to restart your browser and Firefox Translations will be ready to use. Just browse to a website in one of the [languages supported](https://pontoon.mozilla.org/projects/firefox-translations-add-on/) and the option to translate should be displayed.

## Development

### How to run
- Install Firefox Nightly
- Clone this repo and run `npm install`
- Run `npm run once` and wait until Nightly starts
- Go to `about:config` and set `extensions.experiments.enabled` to true
- Browse to a page in any of the supported languages (https://github.com/mozilla/firefox-translations-models/#currently-supported-languages) to have the translation option to appear


### Updating telemetry schema

After adding new metrics to `extension/model/telemetry/metrics.yaml` or pings to `extension/model/telemetry/pings.yaml`, run
```
bash scripts/update-telemetry-schema.sh
```
to regenerate JS telemetry schema.

### Updating bergamot-translator WASM module

After replacing `extension/controller/translation/bergamot-translation-worker.js`, run

```
bash scripts/update-bergamot-translator.sh
```

to regenerate JS version file. This version is reported in telemetry.
