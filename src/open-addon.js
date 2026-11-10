/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: replaces lib/crx-to-zip.js. Firefox add-ons
 * (XPI) are plain zip files, so the Chrome CRX header parsing was removed; this
 * file only loads the add-on and checks that it is a zip file. */

/* exported openAddonAsZip */
/* jshint browser:true, devel:true */
'use strict';

// Whether the data looks like a zip file: it starts with a local file header
// ("PK\3\4"), or has an end of central directory record near the end.
function isZipData(arraybuffer) {
    var view = new Uint8Array(arraybuffer);
    if (view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04) {
        return true;
    }
    // 0xFFFF is the maximum size of an optional trailing comment.
    for (var i = view.length - 22, ii = Math.max(0, i - 0xFFFF); i >= ii; --i) {
        if (view[i] === 0x50 && view[i + 1] === 0x4b &&
            view[i + 2] === 0x05 && view[i + 3] === 0x06) {
            return true;
        }
    }
    return false;
}

function arrayBufferToZip(arraybuffer, callback, errCallback) {
    if (!isZipData(arraybuffer)) {
        errCallback('This is not a Firefox add-on (XPI) or zip file.');
        return;
    }
    callback(new Blob([arraybuffer], {type: 'application/zip'}));
}

/**
 * @param {string|Blob|File|ArrayBuffer} source - Add-on file data or URL.
 * @param {function(Blob)} callback - Receives the zip file as a Blob.
 * @param {function(string)} errCallback - Receives an error message.
 * @param {function(ProgressEvent)} progressListener - Download/read progress.
 */
function openAddonAsZip(source, callback, errCallback, progressListener) {
    if (!errCallback) errCallback = console.log.bind(console);
    if (source instanceof Blob) { // Blob or File
        var fr = new FileReader();
        fr.onprogress = progressListener;
        fr.onload = function() {
            arrayBufferToZip(fr.result, callback, errCallback);
        };
        fr.onerror = function() {
            errCallback('Unexpected error while reading ' + (source.name || 'the file'));
        };
        fr.readAsArrayBuffer(source);
    } else if (typeof source == 'string') {
        openAddonUrlAsZip(source, callback, errCallback, progressListener);
    } else {
        arrayBufferToZip(source, callback, errCallback);
    }
}

function openAddonUrlAsZip(url, callback, errCallback, progressListener) {
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = 'arraybuffer';
    x.onprogress = progressListener;
    x.onload = function() {
        if (x.status >= 400) {
            errCallback('Failed to load ' + url + '. Server responded with ' + x.status + ' ' + x.statusText);
            return;
        }
        if (!x.response || !x.response.byteLength) {
            errCallback('Failed to load ' + url + '. Server did not send any response.');
            return;
        }
        arrayBufferToZip(x.response, callback, function(err) {
            var mimeType = x.getResponseHeader('Content-Type');
            if (mimeType) {
                err += ' According to the server, the file type is ' + mimeType;
            }
            errCallback(err);
        });
    };
    x.onerror = function() {
        errCallback('Network error for ' + url);
    };
    x.send();
}
