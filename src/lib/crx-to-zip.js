/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */
/* jshint browser:true, devel:true */
'use strict';

// Strips CRX headers from zip
// Input: Anything that is accepted by the Uint8Array constructor.
// Output: Blob (to callback)
var CRXtoZIP = (function() {
    function CRXtoZIP(arraybuffer, callback, errCallback) {
        // Definition of crx format: http://developer.chrome.com/extensions/crx.html
        var view = new Uint8Array(arraybuffer);

        // 50 4b 03 04
        if (view[0] === 80 && view[1] === 75 && view[2] === 3 && view[3] === 4) {
            console.warn('Input is not a CRX file, but a ZIP file.');
            callback(new Blob([arraybuffer], {type: 'application/zip'}), undefined);
            return;
        }

        // 43 72 32 34
        if (view[0] !== 67 || view[1] !== 114 || view[2] !== 50 || view[3] !== 52)
            return errCallback('Invalid header: Does not start with Cr24'), void 0;

        // 02 00 00 00
        if (view[4] !== 2 || view[5] || view[6] || view[7])
            return errCallback('Unexpected crx format version number.'), void 0;

        var publicKeyLength = calcLength(view[ 8], view[ 9], view[10], view[11]);
        var signatureLength = calcLength(view[12], view[13], view[14], view[15]);
        // 16 = Magic number (4), CRX format version (4), lengths (2x4)
        var zipStartOffset = 16 + publicKeyLength + signatureLength;

        // Public key
        var publicKeyBase64 = getAsBase64(view, 16, 16 + publicKeyLength);

        // Create a new view for the existing buffer, and wrap it in a Blob object.
        var zipFragment = new Blob([
            new Uint8Array(arraybuffer, zipStartOffset)
        ], {
            type: 'application/zip'
        });
        callback(zipFragment, publicKeyBase64);
    }
    function calcLength(a, b, c, d) {
        var length = 0;
        length += a;
        length += b <<  8;
        length += c << 16;
        length += d << 24;
        return length;
    }
    function getAsBase64(bytesView, startOffset, endOffset) {
        var binaryString = '';
        for (var i = startOffset; i < endOffset; ++i) {
            binaryString += String.fromCharCode(bytesView[i]);
        }
        return btoa(binaryString);
    }
    return CRXtoZIP;
})();

/// Input: string, Blob or File object
function openCRXasZip(url_or_blob, callback, errCallback, xhrProgressListener) {
    if (!errCallback) errCallback = console.log.bind(console);
    if (typeof url_or_blob === 'object' && url_or_blob) {
        // Object? Assume Blob or File object...
        openCRXasZip_blob(url_or_blob, callback, errCallback, xhrProgressListener);
    } else {
        openCRXasZip_url(url_or_blob, callback, errCallback, xhrProgressListener);
    }
}
function openCRXasZip_blob(blob, callback, errCallback, frProgressListener) {
    var fr = new FileReader();
    fr.onprogress = frProgressListener;
    fr.onload = function() {
        /* jshint newcap:false */
        CRXtoZIP(fr.result, callback, errCallback);
    };
    fr.onerror = function() {
        errCallback('Unexpected error while reading ' + (blob.name || 'the blob'));
    };
    fr.readAsArrayBuffer(blob);
}
function openCRXasZip_url(url, callback, errCallback, xhrProgressListener) {
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = 'arraybuffer';
    x.onprogress = xhrProgressListener;
    x.onload = function() {
        if (!x.response) {
            errCallback('Unexpected error: no response for ' + url);
            return;
        }
        /* jshint newcap:false */
        CRXtoZIP(x.response, callback, errCallback);
    };
    x.onerror = function() {
        errCallback('Network error for ' + url);
    };
    x.send();
}
