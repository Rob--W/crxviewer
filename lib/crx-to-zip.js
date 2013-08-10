/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */
/* jshint browser:true, devel:true */
/* globals zip */
'use strict';

// Strips CRX headers from zip
// Input: Anything that is accepted by the Uint8Array constructor.
// Output: Blob (to callback)
var CRXtoZIP = (function() {
    function CRXtoZIP(arraybuffer, callback) {
        // Definition of crx format: http://developer.chrome.com/extensions/crx.html
        var view = new Uint8Array(arraybuffer);

        // 43 72 32 34
        if (view[0] !== 67 || view[1] !== 114 || view[2] !== 50 || view[3] !== 52)
            throw new Error('Invalid header: Does not start with Cr24');

        // 02 00 00 00
        if (view[4] !== 2 || view[5] || view[6] || view[7])
            throw new Error('Unexpected crx format version number.');

        var publicKeyLength = calcLength(view[ 8], view[ 9], view[10], view[11]);
        var signatureLength = calcLength(view[12], view[13], view[14], view[15]);
        // 16 = Magic number (4), CRX format version (4), lengths (2x4)
        var startOffset = 16 + publicKeyLength + signatureLength;
        // Create a new view for the existing buffer, and wrap it in a Blob object.
        var zipFragment = new Blob([
            new Uint8Array(arraybuffer, startOffset)
        ], {
            type: 'application/zip'
        });
        callback(zipFragment);
    }
    function calcLength(a, b, c, d) {
        var length = 0;
        length += a;
        length += b <<  8;
        length += c << 16;
        length += d << 24;
        return length;
    }
    return CRXtoZIP;
})();
function openCRXasZip(url, callback, errCallback, xhrProgressListener) {
    if (!errCallback) errCallback = console.log.bind(console);
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
        CRXtoZIP(x.response, callback);
    };
    x.onerror = function() {
        errCallback('Network error for ' + url);
    };
    x.send();
}
