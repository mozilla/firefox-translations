#!/bin/bash
cd src
mv manifest.json{,.bak}
< manifest.json.bak \
sed -r 's/"version": ".+"/"version": "'$(echo "$GITHUB_REF_NAME" | sed -r 's/^(.+\/)?v(.+)$/\2/')'"/' \
| sed 's/"version_name": ".+"/"version_name": "'"$GITHUB_SHA"'"/' \
> manifest.json