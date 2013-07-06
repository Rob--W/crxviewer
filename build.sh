#!/bin/bash
cd "$(dirname "${BASH_SOURCE[0]}" )"
emkdir() {
    [ ! -d "$1" ] && mkdir -p "$1"
}
ecp() {
    cp -ravf $1 dist/$2
}

emkdir dist
emkdir dist/icons
emkdir dist/lib

ecp manifest.json

ecp cws_pattern.js
ecp background.js
ecp bg-contextmenu.js

ecp popup.html
ecp popup.js

ecp options.html
ecp options.js

ecp crxviewer.html
ecp crxviewer.css
ecp crxviewer.js

ecp icons/\*.png icons/

ecp lib/beautify/ lib/
ecp lib/crx-to-zip.js lib/
ecp lib/google-code-prettify/ lib/
ecp lib/zip.js/ lib/

cd dist
7z u ../crxviewer.zip *
