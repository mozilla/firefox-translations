[![Build](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml/badge.svg)](https://github.com/mozilla/firefox-translations/actions/workflows/build_main.yml) [![CodeQL](https://github.com/mozilla/firefox-translations/actions/workflows/codeql-analysis.yml/badge.svg)](https://github.com/mozilla/firefox-translations/actions/workflows/codeql-analysis.yml) [![End-to-End Tests](https://github.com/mozilla/firefox-translations/actions/workflows/e2etest.yml/badge.svg?branch=main)](https://github.com/mozilla/firefox-translations/actions/workflows/e2etest.yml)  [![Firefox Translations - Install Nightly](https://img.shields.io/badge/Firefox_Translations-Install_Nightly-2ea44f)](https://github.com/mozilla/firefox-translations/releases/download/nightly/firefox_translations.xpi)  [![CODE OF CONDUCT](https://img.shields.io/badge/Contributing-Code%20of%20Conduct-blue)](https://github.com/mozilla/firefox-translations/blob/master/CODE_OF_CONDUCT.md)  [![LICENSE](https://img.shields.io/badge/LICENSE-MPL-blue)](https://github.com/mozilla/firefox-translations/blob/master/LICENSE) [![Mozilla Add-on](https://img.shields.io/amo/v/firefox-translations.svg)](https://addons.mozilla.org/en-US/firefox/addon/firefox-translations/)

# Firefox Translations
Firefox Translations is a WebExtension that enables client side in-page translations for web browsers.

Firefox Translations was developed with The Bergamot Project Consortium, coordinated by the University of Edinburgh with partners Charles University in Prague, the University of Sheffield, University of Tartu, and Mozilla. This project has received funding from the European Union’s Horizon 2020 research and innovation programme under grant agreement No 825303. 🇪🇺

## Release version

### Desktop

The current release version is available for installation on Mozilla Add-ons

[![AMO](https://user-images.githubusercontent.com/973388/205550053-b529d916-afcf-489b-9b25-dda151f88eec.png)](https://addons.mozilla.org/firefox/addon/firefox-translations/)

### Android

Follow the steps below to install the extension on Firefox Nightly or Beta for Android:

- Apply the steps described on this [article](https://blog.mozilla.org/addons/2020/09/29/expanded-extension-support-in-firefox-for-android-nightly/), skipping the section `Create a collection on AMO` (we already provide a collection here) and starting from the section `Enable general extension support setting in Nightly` 
- On step 5, input `17436609` in the `Collection owner` field, and `fxt` in the `Collection name` field 
- Your browser should restart. 
- After restarting, click on the three dot menu and select `Add-ons`
- The Add-ons page should be displayed and Firefox Translations appear at the top of the list. Just click on the `+` icon to have it installed
- With that you should have the addon added to your browser. [Please refer to this video on how to use the extension.](#demo-1)
- You can then remove the `Custom Addon-on collection`, just by clicking at it and clearing the fields, so you could have the stock addons listed again. 

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
- Dutch

## Testing

### Nightly builds

#### Desktop
You can test nightly builds of the extension in Firefox Nightly or Developer Edition in one of the [supported languages](#supported-languages) by following the steps below:
- Type `about:config` in the navigation bar and set the following preferences:

```
    xpinstall.signatures.required to false
    extensions.experiments.enabled to true
```

- Then install the extension by clicking here  [![Firefox Translations - Install Nightly](https://img.shields.io/badge/Firefox_Translations-Install_Nightly-2ea44f)](https://github.com/mozilla/firefox-translations/releases/download/nightly/firefox_translations.xpi)
- You may need to restart your browser and Firefox Translations will be ready to use. Just browse to a website in one of the [supported languages](#supported-languages) and the option to translate should be displayed.

##### Demo

https://user-images.githubusercontent.com/973388/205549475-8036df98-d5b5-4baa-af8f-350f7962f18e.mov

#### Android

You can test the addon on Android by following the steps below: 

1. Clone this repo and execute `npm install`
2. [Install Firefox Nightly for Android in your phone](https://play.google.com/store/apps/details?id=org.mozilla.fenix&hl=en_US&gl=US)
3. Connect your phone to your computer via USB
4. [Follow these steps in order to setup your phone and browser to install the addon](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/#set-up-your-computer-and-android-emulator-or-device) 
5. You might need to execute `adb shell pm grant org.mozilla.fenix android.permission.READ_EXTERNAL_STORAGE` in your terminal so the addon could be pushed to your phone
6. Execute `adb devices` in your terminal, copy the device id, and replace the string `<device id from adb devices>` on package.json by it
7. Execute `npm run android -- --android-device=<ANDROID_DEVICE_ID>` in your terminal to install the addon in your phone and have the browser automatically started (or `npm run android-win -- --android-device=<ANDROID_DEVICE_ID>` if developing on a Windows system) 

That should be enough to have the addon installed on Firefox in your Android. Folow the steps in the video below to learn how to use it.

##### Demo

https://user-images.githubusercontent.com/973388/222513958-89a51f7c-985a-45ee-94f6-c78a31e20a2e.mp4

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

### Discussions
[Firefox translations channel on Matrix](https://matrix.to/#/#firefoxtranslations:mozilla.org)

