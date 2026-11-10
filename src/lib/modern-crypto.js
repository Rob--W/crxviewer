/**
 * (c) 2017 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: MD5 is calculated with @noble/hashes
 * (lib/noble-md5.js, MIT license) instead of SparkMD5. */

'use strict';
/* globals console, crypto, NobleMD5, Uint8Array */
/**
 * Provides the implementation of common hash algorithms with minimal code.
 * Requires a modern browser that supports crypto.subtle.digest.
 * Md5 requires an external library.
 */

var ModernCrypto = {};
(function() {
    function binaryToHex(uint8Array) {
        var s = '';
        uint8Array.forEach(function(b) {
            if (b <= 0xF) s += '0';
            s += b.toString(16);
        });
        return s;
    }
    function subtleCryptoDigestFactory(algo) {
        try {
            crypto.subtle.digest(algo, new Uint8Array(0)).catch(function() {});
        } catch (e) {
            return function(uint8Array, callback) {
                console.error('crypto.subtle.digest not supported for ' + algo);
                callback('');
            };
        }
        return function(uint8Array, callback) {
            crypto.subtle.digest(algo, uint8Array).then(function(binaryHash) {
                callback(binaryToHex(new Uint8Array(binaryHash)));
            }, function(e) {
                console.error('crypto.subtle.digest failed for ' + algo, e);
                callback('');
            });
        };
    }
    ModernCrypto.md5 = function(uint8Array, callback) {
        callback(NobleMD5.hex(uint8Array));
    };
    ModernCrypto.sha1 = subtleCryptoDigestFactory('SHA-1');
    ModernCrypto.sha256 = subtleCryptoDigestFactory('SHA-256');
    ModernCrypto.sha384 = subtleCryptoDigestFactory('SHA-384');
    ModernCrypto.sha512 = subtleCryptoDigestFactory('SHA-512');
})();
