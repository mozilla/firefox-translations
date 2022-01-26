#!/bin/bash
WASM_BASE=../bergamot-translator/build-wasm/bergamot-translator-worker
WASM_BIN=$WASM_BASE.wasm
WASM_JS=$WASM_BASE.js
REMOTE=ikhoefgeen.nl:www/ikhoefgeen.nl/translate/

SHA256_SUM=`sha256sum $WASM_BIN | cut -d' ' -f1`
FILESIZE=`stat $WASM_BIN | cut -d' ' -f8`

scp $WASM_BIN $REMOTE/bergamot-translator-worker-${SHA256_SUM:0:8}.wasm

{
	echo -e "function loadEmscriptenGlueCode(Module) {\n"
	sed -r 's/^(.+)$/    \1/g' < $WASM_JS | sed -e 's/[[:space:]]*$//'
	echo -n -e "\n\n  return { addOnPreMain, Module };\n}"
} > extension/controller/translation/bergamot-translator-worker.js

cat > extension/model/engineRegistry.js <<EOF
/* eslint-disable no-unused-vars */

let engineRegistryRootURL = "https://translate.ikhoefgeen.nl/";
const engineRegistryRootURLTest = "https://example.com/browser/browser/extensions/translations/test/browser/";

const engineRegistry = {
    bergamotTranslatorWasm: {
        fileName: "bergamot-translator-worker-${SHA256_SUM:0:8}.wasm",
        fileSize: ${FILESIZE},
        sha256: "${SHA256_SUM}"
    }
}
EOF
