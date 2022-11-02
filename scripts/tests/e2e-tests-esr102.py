import os.path
from zipfile import ZipFile
import subprocess
from subprocess import PIPE, CalledProcessError
import shutil
import sys
import json
import glob

if not os.path.exists("scripts/tests/e2e-tests-esr102.py"):
    sys.exit("This script is intended to be executed from the root folder.")
root = os.getcwd()

# Remove old gecko
subprocess.call("rm -rf mozilla-esr102".split(), cwd=root)
# First we build the extension
subprocess.call("npm run build-test".split(), cwd=root)
# then we clone gecko
subprocess.call("git clone hg::https://hg.mozilla.org/mozilla-unified mozilla-esr102".split(), cwd=root)
subprocess.call("git checkout bookmarks/esr102".split(), cwd="mozilla-esr102")
# create the folder for the extension
subprocess.call("rm -rf mozilla-esr102/browser/extensions/translations/extension".split(), cwd=root)
# and extract the newly one built there
subprocess.call("unzip web-ext-artifacts/firefox_translations.xpi -d mozilla-esr102/browser/extensions/translations/extension/".split(), cwd=root)
# copy the tests
subprocess.call("mkdir -p mozilla-esr102/browser/extensions/translations/test/browser/".split(), cwd=root)
subprocess.call("cp scripts/tests/browser.ini mozilla-esr102/browser/extensions/translations/test/browser/".split(), cwd=root)
subprocess.call("cp scripts/tests/browser_translation_test.html mozilla-esr102/browser/extensions/translations/test/browser/".split(), cwd=root)
subprocess.call("cp scripts/tests/frame.html mozilla-esr102/browser/extensions/translations/test/browser/".split(), cwd=root)
subprocess.call("cp scripts/tests/browser_translation_test.js mozilla-esr102/browser/extensions/translations/test/browser/".split(), cwd=root)
subprocess.call("cp -r scripts/tests/esen/ mozilla-esr102/browser/extensions/translations/test/browser/esen/".split(), cwd=root)
subprocess.call("cp -r scripts/tests/enes/ mozilla-esr102/browser/extensions/translations/test/browser/enes/".split(), cwd=root)
with open('mozilla-esr102/browser/extensions/moz.build', 'a') as fp:
    fp.write('DIRS += [ \n')
    fp.write('    "translations", \n')
    fp.write('] \n')

# let's copy bergamot-translator's wasm artifacts at right place for tests
subprocess.call("cp -r mozilla-esr102/browser/extensions/translations/extension/model/static/translation/ mozilla-esr102/browser/extensions/translations/test/browser/".split(), cwd=root)

# patching BrowserGlue.jsm to add the extension's version so it could be loaded
f = open("extension/manifest.json")
data = json.load(f)
extension_version = data["version"]
f.close()

f = open("scripts/tests/BrowserGlue.jsm")
dataBrowserGlue = f.read()
dataBrowserGlue = dataBrowserGlue.replace("{version}", '"{version}"'.format(version=extension_version))
dataBrowserGlue = dataBrowserGlue.replace("_monitorTranslationsPref", "_monitorTranslationsPrefAddon")
dataBrowserGlue = dataBrowserGlue.replace("lazy.AddonManager", "AddonManager")
f.close()

fp = open("mozilla-esr102/browser/components/BrowserGlue.jsm")
Lines = fp.readlines()
fp.close()
count = 0
with open('mozilla-esr102/browser/components/BrowserGlue.jsm', 'w') as fp:
    for line in Lines:
        if len(Lines) > count + 1 and "_monitorWebcompatReporterPref() {" in Lines[count + 1]:
            fp.write(dataBrowserGlue + "\n")
        elif "this._monitorWebcompatReporterPref();" in line:
            fp.write(line)
            fp.write("      this._monitorTranslationsPrefAddon(); \n")
        else:
            fp.write(line)
        count += 1

# enable our test
with open('mozilla-esr102/mozconfig', 'w') as f:
    print('ac_add_options --enable-artifact-builds', file=f)

with open('mozilla-esr102/browser/extensions/translations/moz.build', 'a') as f:
    print('BROWSER_CHROME_MANIFESTS += [\"test/browser/browser.ini\"]', file=f)


print("****** Test with fallback gemm ******")

try:
    print("Building mozilla-esr102")
    subprocess.check_output("./mach build", stderr=subprocess.STDOUT, shell=True, universal_newlines=True, cwd="mozilla-esr102")
    print("Running test with fallback gemm")
    subprocess.check_output("./mach test --setpref=fxtranslations.running.mochitest=true browser/extensions/translations/test/browser/browser_translation_test.js", stderr=subprocess.STDOUT, shell=True, universal_newlines=True, cwd="mozilla-esr102")
    print("Test with fallback gemm Succeeded")
except CalledProcessError as cpe:
    print(cpe.output)
    sys.exit("Tests with fallback gemm failed")