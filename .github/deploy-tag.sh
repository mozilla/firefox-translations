#!/bin/bash
cd extension
mv manifest.json{,.bak}
< manifest.json.bak \
sed 's/"version": ".+"/"version": "'$(echo "$GITHUB_REF_NAME" | sed -r 's/v(.+)$/\1/')'"/'  \
sed 's/"version_name": ".+"/"version_name": "'"$GITHUB_SHA"'"/'  \
> manifest.json