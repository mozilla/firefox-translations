#!/bin/bash

# Run from repo root to regenerate telemetry json schema
# bash scripts/update-telemetry-schema.sh

pip install glean_parser

folder=extension/model/telemetry

# validate the new schema
glean_parser translate -f javascript -o /tmp ${folder}/pings.yaml
glean_parser translate -f javascript -o /tmp ${folder}/metrics.yaml

python scripts/update-telemetry-schema.py ${folder}