#!/bin/bash
cd "$(dirname "${BASH_SOURCE[0]}" )"

rsync -rav \
    manifest.json \
    *.js \
    *.html \
    *.css \
    lib \
    icons \
    --exclude=*.svg \
    dist/

cd dist
7z u ../crxviewer.zip * -tzip
