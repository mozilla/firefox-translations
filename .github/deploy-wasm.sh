#!/bin/bash
WASM_BASE=$1/bergamot-translator-worker
WASM_BIN=$WASM_BASE.wasm
WASM_JS=$WASM_BASE.js

{
	echo -e "function loadEmscriptenGlueCode(Module) {\n"
	sed -r 's/^(.+)$/    \1/g' < $WASM_JS | sed -e 's/[[:space:]]*$//'
	echo -n -e "\n\n  return { addOnPreMain, Module };\n}"
} > extension/controller/translation/bergamot-translator-worker.js

mv $WASM_BIN extension/controller/translation/bergamot-translator-worker.wasm