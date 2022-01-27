#!/bin/bash
WASM_BASE=$1/bergamot-translator-worker
WASM_BIN=$WASM_BASE.wasm
WASM_JS=$WASM_BASE.js

SHA256_SUM=`sha256sum $WASM_BIN | cut -d' ' -f1`
FILESIZE=`stat -c%s $WASM_BIN`

{
	echo -e "function loadEmscriptenGlueCode(Module) {\n"
	sed -r 's/^(.+)$/    \1/g' < $WASM_JS | sed -e 's/[[:space:]]*$//'
	echo -n -e "\n\n  return { addOnPreMain, Module };\n}"
} > extension/controller/translation/bergamot-translator-worker.js

cat > extension/model/engineRegistry.js <<EOF
/* eslint-disable no-unused-vars */

let engineRegistryRootURL = "https://github.com/${GITHUB_REPOSITORY}/releases/download/${GITHUB_REF_NAME}/";
const engineRegistryRootURLTest = "https://example.com/browser/browser/extensions/translations/test/browser/";

const engineRegistry = {
    bergamotTranslatorWasm: {
        fileName: "bergamot-translator-worker.wasm",
        fileSize: ${FILESIZE},
        sha256: "${SHA256_SUM}"
    }
}
EOF
