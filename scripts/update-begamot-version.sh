#!/bin/bash

echo "* Extracting the bergamot-translator version info to a separate file"
WORKER_DIR=extension/controller/translation

grep 'BERGAMOT_VERSION_FULL' < "${WORKER_DIR}/bergamot-translator-worker.js" \
  | sed 's+var BERGAMOT_VERSION_FULL+/* eslint-disable */\nconst BERGAMOT_VERSION_FULL+g' \
  > "${WORKER_DIR}/bergamotTranslatorVersion.js"
