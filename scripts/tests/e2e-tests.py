import os.path
from zipfile import ZipFile
import subprocess
from subprocess import PIPE, CalledProcessError
import shutil
import sys
import json

if not os.path.exists("scripts/tests/e2e-tests.py"):
    sys.exit("This script is intended to be executed from the root folder.")
root = os.getcwd()

# Remove old gecko
subprocess.call("rm -rf gecko".split(), cwd=root)
# First we build the extension
subprocess.call("npm run build-test".split(), cwd=root)
# then we clone gecko
subprocess.call("git clone hg::https://hg.mozilla.org/mozilla-central gecko".split(), cwd=root)
# We then remove the old extension
subprocess.call("mkdir -p gecko/browser/extensions/translations/extension".split(), cwd=root)
# and extract the newly one built there
subprocess.call("unzip web-ext-artifacts/firefox_translations.xpi -d gecko/browser/extensions/translations/extension/".split(), cwd=root)
# copy the tests
subprocess.call("mkdir -p gecko/browser/extensions/translations/test/browser/".split(), cwd=root)
subprocess.call("cp scripts/tests/browser.ini gecko/browser/extensions/translations/test/browser/".split(), cwd=root)
subprocess.call("cp scripts/tests/browser_translation_test.html gecko/browser/extensions/translations/test/browser/".split(), cwd=root)
subprocess.call("cp scripts/tests/frame.html gecko/browser/extensions/translations/test/browser/".split(), cwd=root)
subprocess.call("cp scripts/tests/browser_translation_test.js gecko/browser/extensions/translations/test/browser/".split(), cwd=root)
subprocess.call("cp -r scripts/tests/esen/ gecko/browser/extensions/translations/test/browser/esen/".split(), cwd=root)
subprocess.call("cp -r scripts/tests/enes/ gecko/browser/extensions/translations/test/browser/enes/".split(), cwd=root)
subprocess.call("cp scripts/tests/jar.mn gecko/browser/extensions/translations/".split(), cwd=root)
with open('gecko/browser/extensions/moz.build', 'a') as fp:
    fp.write('if CONFIG["NIGHTLY_BUILD"]: \n')
    fp.write('  DIRS += [ \n')
    fp.write('      "translations", \n')
    fp.write('  ] \n')

# let's copy bergamot-translator's wasm artifacts at right place for tests
subprocess.call("cp -r gecko/browser/extensions/translations/extension/model/static/translation/ gecko/browser/extensions/translations/test/browser/".split(), cwd=root)

# patching BrowserGlue.jsm to add the extension's version so it could be loaded
f = open("extension/manifest.json")
data = json.load(f)
extension_version = data["version"]
f.close()

f = open("scripts/tests/BrowserGlue.jsm")
dataBrowserGlue = f.read()
dataBrowserGlue = dataBrowserGlue.replace("{version}", extension_version)
f.close()

fp = open("gecko/browser/components/BrowserGlue.jsm")
Lines = fp.readlines()
fp.close()
count = 0
with open('gecko/browser/components/BrowserGlue.jsm', 'w') as fp:
    for line in Lines:
        if len(Lines) > count + 1 and "async _setupSearchDetection() {" in Lines[count + 1]:
            fp.write(dataBrowserGlue + "\n")
        elif "this._setupSearchDetection();" in line:
            fp.write(line)
            fp.write("      this._monitorTranslationsPref(); \n")
        else:
            fp.write(line)
        count += 1

# enable our test
with open('gecko/mozconfig', 'w') as f:
    print('ac_add_options --enable-artifact-builds', file=f)

with open('gecko/browser/extensions/translations/moz.build', 'a') as f:
    print('with Files("**"):', file=f)
    print(' BUG_COMPONENT = ("Firefox", "Translations")', file=f)
    print('JAR_MANIFESTS += ["jar.mn"]', file=f)
    print('BROWSER_CHROME_MANIFESTS += [\"test/browser/browser.ini\"]', file=f)

# build and run our test
print("****** Test with faster gemm ******")
try:
    print("Building gecko")
    subprocess.check_output("./mach build", stderr=subprocess.STDOUT, shell=True, universal_newlines=True, cwd="gecko")
    print("Running test with faster gemm")
    subprocess.check_output("./mach test --setpref=fxtranslations.running.mochitest=true browser/extensions/translations/test/browser/browser_translation_test.js", stderr=subprocess.STDOUT, shell=True, universal_newlines=True, cwd="gecko")
    print("Test with faster gemm Succeeded")
except CalledProcessError as cpe:
    print(cpe.output)
    sys.exit("Tests with faster gemm failed")

def disable_faster_gemm(engine_js_artifact_name):
    FASTER_GEMM = "mozIntGemm"
    DISABLE_FASTER_GEMM = "DISABLE_" + FASTER_GEMM
    ENGINE_JS_ARTIFACT = "gecko/browser/extensions/translations/extension/controller/translation/" + engine_js_artifact_name

    with open(ENGINE_JS_ARTIFACT, "rt") as f:
        x = f.read()
    with open(ENGINE_JS_ARTIFACT, "wt") as f:
        x = x.replace(FASTER_GEMM, DISABLE_FASTER_GEMM)
        f.write(x)

def enable_arm_platform():
    PLATFORM_DETECTION_FILE = "gecko/browser/extensions/translations/extension/controller/backgroundScript.js"

    with open(PLATFORM_DETECTION_FILE, "rt") as f:
        x = f.read()
    with open(PLATFORM_DETECTION_FILE, "wt") as f:
        x = x.replace("platformInfo = await browser.runtime.getPlatformInfo();", "platformInfo = await browser.runtime.getPlatformInfo(); platformInfo.arch = \"arm\";")
        f.write(x)

# build and run test for wormhole fallback gemm
print("****** Test with wormhole fallback gemm ******")
print("Disabling faster gemm")
disable_faster_gemm("bergamot-translator-worker.js")

try:
    print("Building gecko")
    subprocess.check_output("./mach build", stderr=subprocess.STDOUT, shell=True, universal_newlines=True, cwd="gecko")
    print("Running test with fallback gemm")
    subprocess.check_output("./mach test --setpref=fxtranslations.running.mochitest=true browser/extensions/translations/test/browser/browser_translation_test.js", stderr=subprocess.STDOUT, shell=True, universal_newlines=True, cwd="gecko")
    print("Test with fallback gemm Succeeded")
except CalledProcessError as cpe:
    print(cpe.output)
    sys.exit("Tests with fallback gemm failed")

# build and run test for non-wormhole fallback gemm
print("****** Test with non-wormhole fallback gemm ******")
print("Disabling faster gemm")
disable_faster_gemm("bergamot-translator-worker-without-wormhole.js")
print("Hardcoding platform detected as arm")
enable_arm_platform()

try:
    print("Building gecko")
    subprocess.check_output("./mach build", stderr=subprocess.STDOUT, shell=True, universal_newlines=True, cwd="gecko")
    print("Running test with non-wormhole fallback gemm")
    subprocess.check_output("./mach test --setpref=fxtranslations.running.mochitest=true browser/extensions/translations/test/browser/browser_translation_test.js", stderr=subprocess.STDOUT, shell=True, universal_newlines=True, cwd="gecko")
    print("Test with non-wormhole fallback gemm Succeeded")
except CalledProcessError as cpe:
    print(cpe.output)
    sys.exit("Tests with non-wormhole fallback gemm failed")