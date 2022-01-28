#!/bin/bash
cd extension
mv manifest.json{,.bak}
sed 's/"version": ".+",/"version": "'$(echo "$1" | sed -r 's/.+\/v(.+)$/\1/')'",/' < manifest.json.bak > manifest.json