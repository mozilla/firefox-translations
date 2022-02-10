[![Build](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml/badge.svg)](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml) [![CodeQL](https://github.com/mozilla/firefox-translations/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/mozilla/firefox-translations/actions/workflows/codeql-analysis.yml)


# Firefox Translations
Firefox Translations is a webextension that enables client side in-page translations for web browsers.

# Instructions to run
- Install Firefox Nightly
- Clone this repo and run `npm install`
- Run `npm run once` and wait until Nightly starts
- Go to `about:config` and set `extensions.experiments.enabled` to true
- Browse to a page in any of the supported languages (https://github.com/mozilla/firefox-translations-models/#currently-supported-languages) to have the translation option to appear


# Development

## Updating telemetry schema

After adding new metrics to `extension/model/telemetry/metrics.yaml` or pings to `extension/model/telemetry/pings.yaml`, run 
```
python scripts/update-telemetry-schema.py
```
to regenerate JS telemetry schema.

## Updating bergamot-translator WASM module

After replacing `extension/controller/translation/bergamot-translation-worker.js`, run

```
bash scripts/update-bergamot-translator.sh
```

to regenerate JS version file. This version is reported in telemetry.

## Testing

### Preliminary builds

One can test preliminary versions of the extension in Firefox Nightly since an artifact is generated on every commit. In order to do that, go to [the Github Action](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml), click at the commit you wish to test, and then click to download the artifact as a zip file at the end of the page. With that:
- Download [Firefox Nightly](https://www.mozilla.org/en-US/firefox/all/#product-desktop-nightly)
- Type `about:addons` in the navigation bar, click on the gear to he right, then on `install from a file` and load the saved zip file.
- Type `about:config` in the navigation bar again, and switch the following preferences:
  * `extensions.translations.disabled` to `true`
  * `extensions.experiments.enabled` to `true` 
  * `javascript.options.wasm_simd_wormhole` to `true`
  * `xpinstall.signatures.required` to `false`

And then you should be able to use the extension. 
