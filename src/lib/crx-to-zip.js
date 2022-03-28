/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported openCRXasZip */
/* jshint browser:true, devel:true */
/* globals CryptoJS */ // For sha256 hash calculation
/* globals get_equivalent_download_url */
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
        if (view[0] !== 67 || view[1] !== 114 || view[2] !== 50 || view[3] !== 52) {
            if (isMaybeZipData(view)) {
                console.warn('Input is not a CRX file, but possibly a ZIP file.');
                callback(new Blob([arraybuffer], {type: 'application/zip'}), undefined);
                return;
            }
            errCallback('Invalid header: Does not start with Cr24.');
            return;
        }

        // 02 00 00 00
        // 03 00 00 00 CRX3
        if (view[4] !== 2 && view[4] !== 3 || view[5] || view[6] || view[7])
            return errCallback('Unexpected crx format version number.'), void 0;

        var zipStartOffset, publicKeyBase64;
        if (view[4] === 2) {
            var publicKeyLength = calcLength(view[ 8], view[ 9], view[10], view[11]);
            var signatureLength = calcLength(view[12], view[13], view[14], view[15]);
            // 16 = Magic number (4), CRX format version (4), lengths (2x4)
            zipStartOffset = 16 + publicKeyLength + signatureLength;

            // Public key
            publicKeyBase64 = btoa(getBinaryString(view, 16, 16 + publicKeyLength));
        } else { // view[4] === 3
            // CRX3 - https://cs.chromium.org/chromium/src/components/crx_file/crx3.proto
            var crx3HeaderLength = calcLength(view[ 8], view[ 9], view[10], view[11]);
            // 12 = Magic number (4), CRX format version (4), header length (4)
            zipStartOffset = 12 + crx3HeaderLength;

            // Public key
            publicKeyBase64 = getPublicKeyFromProtoBuf(view, 12, zipStartOffset);
        }

        // addons.opera.com creates CRX3 files by prepending the CRX3 header to the CRX2 data.
        if (
            // CRX3
            view[4] === 3 &&
            // 43 72 32 34 - Cr24 = CRX magic
            view[zipStartOffset + 0] === 67 &&
            view[zipStartOffset + 1] === 114 &&
            view[zipStartOffset + 2] === 50 &&
            view[zipStartOffset + 3] === 52
        ) {
            console.warn('Nested CRX: Expected zip data, but found another CRX file instead.');
            return CRXtoZIP(
                arraybuffer.slice(zipStartOffset),
                function(zipFragment, nestedKey) {
                    if (publicKeyBase64 != nestedKey) {
                        console.warn('Nested CRX: pubkey mismatch; found ' + nestedKey);
                    }
                    callback(zipFragment, publicKeyBase64, arraybuffer);
                },
                errCallback
            );
        }

        // Create a new view for the existing buffer, and wrap it in a Blob object.
        var zipFragment = new Blob([
            new Uint8Array(arraybuffer, zipStartOffset)
        ], {
            type: 'application/zip'
        });
        callback(zipFragment, publicKeyBase64, arraybuffer);
    }
    function calcLength(a, b, c, d) {
        var length = 0;
        length += a <<  0;
        length += b <<  8;
        length += c << 16;
        length += d << 24 >>> 0;
        return length;
    }
    function getBinaryString(bytesView, startOffset, endOffset) {
        var binaryString = '';
        for (var i = startOffset; i < endOffset; ++i) {
            binaryString += String.fromCharCode(bytesView[i]);
        }
        return binaryString;
    }
    function getPublicKeyFromProtoBuf(bytesView, startOffset, endOffset) {
        // Protobuf definition: https://cs.chromium.org/chromium/src/components/crx_file/crx3.proto
        // Wire format: https://developers.google.com/protocol-buffers/docs/encoding
        // The top-level CrxFileHeader message only contains length-delimited fields (type 2).
        // To find the public key:
        // 1. Look for CrxFileHeader.sha256_with_rsa (field number 2).
        // 2. Look for AsymmetricKeyProof.public_key (field number 1).
        // 3. Look for CrxFileHeader.signed_header_data (SignedData.crx_id).
        //    This has 16 bytes (128 bits). Verify that those match with the
        //    first 128 bits of the sha256 hash of the chosen public key.

        function getvarint() {
            // Note: We don't do bound checks (startOffset < endOffset) here,
            // because even if we read past the end of bytesView, then we get
            // the undefined value, which is converted to 0 when we do a
            // bitwise operation in JavaScript.
            var val = bytesView[startOffset] & 0x7F;
            if (bytesView[startOffset++] < 0x80) return val;
            val |= (bytesView[startOffset] & 0x7F) << 7;
            if (bytesView[startOffset++] < 0x80) return val;
            val |= (bytesView[startOffset] & 0x7F) << 14;
            if (bytesView[startOffset++] < 0x80) return val;
            val |= (bytesView[startOffset] & 0x7F) << 21;
            if (bytesView[startOffset++] < 0x80) return val;
            val = (val | (bytesView[startOffset] & 0xF) << 28) >>> 0;
            if (bytesView[startOffset++] & 0x80) console.warn('proto: not a uint32');
            return val;
        }

        var publicKeys = [];
        var crxIdBin;
        while (startOffset < endOffset) {
            var key = getvarint();
            var length = getvarint();
            if (key === 80002) { // This is ((10000 << 3) | 2) (signed_header_data).
                var sigdatakey = getvarint();
                var sigdatalen = getvarint();
                if (sigdatakey !== 0xA) {
                    console.warn('proto: Unexpected key in signed_header_data: ' + sigdatakey);
                } else if (sigdatalen !== 16) {
                    console.warn('proto: Unexpected signed_header_data length ' + length);
                } else if (crxIdBin) {
                    console.warn('proto: Unexpected duplicate signed_header_data');
                } else {
                    crxIdBin = bytesView.subarray(startOffset, startOffset + 16);
                }
                startOffset += sigdatalen;
                continue;
            }
            if (key !== 0x12) {
                // Likely 0x1a (sha256_with_ecdsa).
                if (key != 0x1a) {
                    console.warn('proto: Unexpected key: ' + key);
                }
                startOffset += length;
                continue;
            }
            // Found 0x12 (sha256_with_rsa); Look for 0xA (public_key).
            var keyproofend = startOffset + length;
            var keyproofkey = getvarint();
            var keyprooflength = getvarint();
            // AsymmetricKeyProof could contain 0xA (public_key) or 0x12 (signature).
            if (keyproofkey === 0x12) {
                startOffset += keyprooflength;
                if (startOffset >= keyproofend) {
                    // signature without public_key...? The protocol definition allows it...
                    continue;
                }
                keyproofkey = getvarint();
                keyprooflength = getvarint();
            }
            if (keyproofkey !== 0xA) {
                startOffset += keyprooflength;
                console.warn('proto: Unexpected key in AsymmetricKeyProof: ' + keyproofkey);
                continue;
            }
            if (startOffset + keyprooflength > endOffset) {
                console.warn('proto: size of public_key field is too large');
                break;
            }
            // Found 0xA (public_key).
            publicKeys.push(getBinaryString(bytesView, startOffset, startOffset + keyprooflength));
            startOffset = keyproofend;
        }
        if (!publicKeys.length) {
            console.warn('proto: Did not find any public key');
            return;
        }
        if (!crxIdBin) {
            console.warn('proto: Did not find crx_id');
            return;
        }
        var crxIdHex = CryptoJS.enc.Latin1.parse(getBinaryString(crxIdBin, 0, 16)).toString();
        for (var i = 0; i < publicKeys.length; ++i) {
            var sha256sum = CryptoJS.SHA256(CryptoJS.enc.Latin1.parse(publicKeys[i])).toString();
            if (sha256sum.slice(0, 32) === crxIdHex) {
                return btoa(publicKeys[i]);
            }
        }
        console.warn('proto: None of the public keys matched with crx_id');
    }
    function isMaybeZipData(view) {
        // Find EOCD (0xFFFF is the maximum size of an optional trailing comment).
        for (var i = view.length - 22, ii = Math.max(0, i - 0xFFFF); i >= ii; --i) {
            if (view[i] === 0x50 && view[i + 1] === 0x4b &&
                view[i + 2] === 0x05 && view[i + 3] === 0x06) {
                return true;
            }
        }

        return false;
    }
    return CRXtoZIP;
})();

/**
 * @param {string|Blob|File|ArrayBuffer|Uint8Array} crx_obj - CRX file data or URL
 * @param {function(Blob,string,arraybuffer)} callback -
 *   Zip file as blob,
 *   base64-encoded public key as string.
 *   original crx data as arraybuffer.
 * @param {function(string)} errCallback - Error callback
 * @param {function(event)} xhrProgressListener - Progress event listener.
 */
function openCRXasZip(crx_obj, callback, errCallback, xhrProgressListener) {
    if (!errCallback) errCallback = console.log.bind(console);
    if (crx_obj instanceof Blob) { // Blob or File
        openCRXasZip_blob(crx_obj, callback, errCallback, xhrProgressListener);
    } else if (typeof crx_obj == 'string') {
        openCRXasZip_url(crx_obj, callback, errCallback, xhrProgressListener);
    } else {
        // jshint newcap:false
        CRXtoZIP(crx_obj, callback, errCallback);
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
    var requestUrl = get_equivalent_download_url(url);
    var x = new XMLHttpRequest();
    x.open('GET', requestUrl);
//#if OPERA
    // Required for access to addons.opera.com, see get_equivalent_download_url
    if (requestUrl.startsWith('https://cors-anywhere.herokuapp.com/')) {
        x.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
    }
//#endif
    x.responseType = 'arraybuffer';
    x.onprogress = xhrProgressListener;
    x.onload = function() {
        if (!x.response) {
            errCallback('Unexpected error: no response for ' + url);
            return;
        }
        /* jshint newcap:false */
        CRXtoZIP(x.response, callback, function(err) {
            if (x.status >= 400) {
                err = 'Failed to load ' + url + '. Server responded with ' + x.status + ' ' + x.statusText;
            } else if (!x.response.byteLength) {
                err = 'Failed to load ' + url + '. Server did not send any response.';
            } else {
                var mimeType = x.getResponseHeader('Content-Type');
                if (!/^application\/(x-chrome-extension|x-navigator-extension|zip)/i.test(mimeType)) {
                    err += ' According to the server, the file type is ' + mimeType;
                }
            }
            errCallback(err);
        });
    };
    x.onerror = function() {
        errCallback('Network error for ' + url);
    };
    x.send();
}
