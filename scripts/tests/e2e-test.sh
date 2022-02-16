#!/bin/sh

# First we build the extension
npm run build
# the nwe clone gecko
git clone hg::https://hg.mozilla.org/mozilla-unified gecko
# We then remove the old extension
rm -rf gecko/browser/extensions/translations/extension
# and extract the new one there
unzip web-ext-artifacts/firefox_translations.xpi -d gecko/browser/extensions/translations/extension/
# copy the tests
mkdir -p gecko/browser/extensions/translations/test/browser/
cp scripts/tests/browser_translation_test.html gecko/browser/extensions/translations/test/browser/
cp scripts/tests/browser_translation_test.js gecko/browser/extensions/translations/test/browser/
cp -r scripts/tests/esen/ gecko/browser/extensions/translations/test/browser/esen/

# download bergamot-translator-worker-with-wormhole.wasm and save in
# gecko/browser/extensions/translations/test/browser/. REad from the engineRegistry.js
curl -o gecko/browser/extensions/translations/test/browser/bergamot-translator-worker-with-wormhole.wasm https://github.com/mozilla/bergamot-translator/releases/download/0.3.1%2B793d132/bergamot-translator-worker-with-wormhole.wasm

# patching BrowserGlue.jsm
#with open("../../components/BrowserGlue.jsm") as fp:
#    count = 0
#    Lines = fp.readlines()
#    for line in Lines:
#        if "resource://builtin-addons/translations/" in line:
#            Lines[count - 1] = '            "{}",\n'.format(extension_version)
#            with open("../../components/BrowserGlue.jsm", "w") as outfile:
#                outfile.write("".join(Lines))
#            break
#        count += 1

# we then update the version into
cd gecko
# Let's tell the builder to download the compiled C++ components
echo "ac_add_options --enable-artifact-builds" > mozconfig
echo 'BROWSER_CHROME_MANIFESTS += ["test/browser/browser.ini"]' >> browser/extensions/translations/moz.build
./mach build
./mach test browser/extensions/translations/test/browser/browser_translation_test.js