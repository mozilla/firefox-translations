# Firefox Translations Changelog

Firefox Translations is a webextension developed by Mozilla that enables client side in-page translation for Firefox.

You can send suggestions or report issues to the team via any of the channels below:

- [Github](https://github.com/mozilla/firefox-translations/)
- [Matrix](https://matrix.to/#/#firefoxtranslations:mozilla.org)
- [Email us at fx-translations@mozilla.com](mailto:fx-translations@mozilla.com)

[You can also rate and leave us a comment on Mozilla Addons.](https://addons.mozilla.org/en-US/firefox/addon/firefox-translations/)

## [[v1.1.4]](https://github.com/mozilla/firefox-translations/tree/v1.1.4) - 2022-07-28
### Added
- Full Dutch support

### Changed
- Fixed caching of assets across updates that was breaking updates.
- Fixed changelog issues
- Remove obsolete key (applications) from manifest
- Fixed issues where editable elements were being translated and breaking sites like Twitter

## [[1.1.3]](https://github.com/mozilla/firefox-translations/tree/v1.1.3) - 2022-07-14
### Added
- Ukrainian models
- French models
- Polish models
- English to Dutch model
- Changelog (this page!)

### Changed
- Improved language detection that now takes into account the language set in the page's markup
- UI is now responsive which fix issues that was extrapolating and cutting the window and breaking Firefox controls.
- "Translation Preferences" in the options button now redirects to the Firefox Translations panel in about:preferences
-  Fixed the stopgap solution of translating in permanent private browsing mode
- New high resolution icon
- "Never translate this site" in the options button is now a checkbox
- PageAction icon is now white
- Restrict minimum version to what's compatible with the wasm engine
- Fixes crypto uuid issues preventing telemetry from being submitted on Fx earlier than 93
- Makes translation bar compatible with Fx versions earlier than 95
- Improved in-page translation
- Issues when translation of forms is incompatible with the page are fixed
- Properly display errors when the tab contains incompatible documents
- Translation bar is now displayed when the tab is dragged or moved between windows
- Minor user interface improvements

### Removed
- Survey button.
- Womrhole artifacts

## [[1.1.2]](https://github.com/mozilla/firefox-translations/tree/v1.1.2) - 2022-05-20
### Added
- Support for private browsing mode
- Public release on Mozilla Addons
### Changed
- Improved in-page translations
- Improved language detection

## [[1.1.1]](https://github.com/mozilla/firefox-translations/tree/v1.1.1) - 2022-05-06
### Added
- Telemetry
- Bulgarian models
- Icelandic models
- Norwegian Bokmål models
- Norwegian Nynorsk
- Persian models
- Localization of user interface
- Intrinsics for native matmul acceleration in Nightly
- Error highlighting
- PageAction to trigger the translation bar
- Survey button
- Support for non x86 architecture
- Auto-translate as browse
- Error reporting using Sentry

### Changed
- Improved language detection
- Improved translation of forms
- Improved in-page translations
- Improved error handling
- Fixes and improvements on user interface
- Improved translation worker
- Improved translation engine
- Improved portuguese models
- Improved italian models
- Improved translation of frames
- Ship translation engine instead of download it

### Removed
- Translation cache

## [[0.5.0]](https://github.com/mozilla/firefox-translations/tree/v0.5.0) - 2022-01-15
### Added
- Release of the first developer version.
- Translation of forms
- In-Page translations
- Dynamic download of models and engine
- Translation pivoting
- New User Interface
- Refactoring of the legacy version
- Stats mode
- Incorporation
- Italian models
- Portuguese models
- English models
- Russian models
- Czech models
- German models
- Spanish models
- Estonian models