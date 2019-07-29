/**
 * (c) 2019 Peter Wu <peter@lekensteyn.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// jshint esversion:6
/* globals TextDecoder, module, console */
/* exported parseMozCOSE */
'use strict';

const CBOR_MT_INT = 0;
const CBOR_MT_NEGATIVE = 1;
const CBOR_MT_BYTES = 2;
const CBOR_MT_STRING = 3;
const CBOR_MT_ARRAY = 4;
const CBOR_MT_MAP = 5;
const CBOR_MT_TAG = 6;
const CBOR_MT_INDEFINITE = 7;

const CBOR_VALUE_NULL = 22;

function decodeInitial(buffer) {
    if (buffer.length < 1) {
        throw new Error('Buffer too small for initial byte');
    }
    let majorType = buffer[0] >> 5;
    let additionalInfo = buffer[0] & 0x1f;
    let valueLength = 0;
    let value = additionalInfo & 0x1f;
    switch (additionalInfo) {
        case 24:    // 1 byte unsigned integer follows
        case 25:    // 2 byte unsigned integer follows
        case 26:    // 4 byte unsigned integer follows
            valueLength = 1 << (additionalInfo - 24);
            if (buffer.length < 1 + valueLength) {
                throw new Error('Buffer too small for value');
            }
            value = 0;
            for (let i = 0; i < valueLength; i++) {
                value = (value << 8) | buffer[1 + i];
            }
            // Treat as unsigned integer.
            value >>>= 0;
            break;

        case 27:    // 8 byte unsigned integer follows
            throw new Error('Unsupported 8 byte unsigned integer');

        case 28:    // reserved
        case 29:    // reserved
        case 30:    // reserved
            throw new Error('Unsupported reserved additionalInfo value');
    }

    let offset = 1 + valueLength;
    switch (majorType) {
        case 1:     // negative integer
            value = -1 - value;
            break;
        case CBOR_MT_BYTES:
        case CBOR_MT_STRING:
            if (buffer.length < offset + value) {
                throw new Error(`Buffer too small for string: ${buffer.length} < ${offset} + ${value}`);
            }
            let content = buffer.slice(offset, offset + value);
            offset += value;
            if (majorType === CBOR_MT_STRING) {
                content = new TextDecoder().decode(content);
            }
            value = content;
            break;

        case CBOR_MT_INDEFINITE:
            switch (value) {
                case CBOR_VALUE_NULL:
                    break;
                default:
                    throw new Error('Unsupported stop code, float or other simple type');
            }
    }

    return [majorType, value, buffer.slice(offset)];
}

function decodeValue(data, majorType, expected) {
    let [actualMajorType, value, nextData] = decodeInitial(data);
    if (actualMajorType !== majorType) {
        throw new Error(`Expected majorType ${majorType}, found ${actualMajorType}`);
    }
    if (expected !== undefined && expected !== value) {
        throw new Error(`Expected value ${expected}, found ${value}`);
    }
    return [value, nextData];
}

/**
 * Parse a DER-encoded signing certificate from a COSE signature.
 *
 * @param {Uint8Array|Buffer} data - An array of bytes.
 * @returns {Uint8Array|Buffer} The slice representing the DER-encoded
 * certificate that is used for signing.
 * @throws {Error} If the data was invalid.
 */
function parseMozCOSE(data) {
    // Parses Mozilla's dialect of COSE as described at
    // https://github.com/franziskuskiefer/cose-rust/issues/60
    let arrLen, mapData, mapSize;
    // Expect cose-sign (CBOR Tag 98);
    [, data] = decodeValue(data, CBOR_MT_TAG, 98);
    // Expected: an array with four elements:
    //  / protected /       bytes
    //  / unprotected /     map (assume empty)
    //  / payload /         null
    //  / signatures /      array (non-empty)
    [, data] = decodeValue(data, CBOR_MT_ARRAY, 4);
    [, data] = decodeValue(data, CBOR_MT_BYTES);
    [, data] = decodeValue(data, CBOR_MT_MAP, 0);
    [, data] = decodeValue(data, CBOR_MT_INDEFINITE, CBOR_VALUE_NULL);
    [arrLen, data] = decodeValue(data, CBOR_MT_ARRAY);
    // One signature for every signing certificate.
    for (let i = 0; i < arrLen; i++) {
        // Expected: an array with three elements:
        //  / protected /       bytes
        //  / unprotected /     map (assume empty)
        //  / signature /       bytes
        [, data] = decodeValue(data, CBOR_MT_ARRAY, 3);
        [mapData, data] = decodeValue(data, CBOR_MT_BYTES);
        [, data] = decodeValue(data, CBOR_MT_MAP, 0);
        [, data] = decodeValue(data, CBOR_MT_BYTES);

        // unexpected is an encoded map, look for key KID.
        [mapSize, mapData] = decodeValue(mapData, CBOR_MT_MAP);
        for (let j = 0; j < mapSize; j++) {
            let majorType, key, value;
            // Expected: label (int / tstr); value
            [majorType, key, mapData] = decodeInitial(mapData);
            if (![CBOR_MT_INT, CBOR_MT_NEGATIVE].includes(majorType)) {
                throw new Error(`Expected integer, found majorType ${majorType}`);
            }
            [majorType, value, mapData] = decodeInitial(mapData);
            if (key === 4) {        // kid => DER encoded bytes
                return value;
            }
        }
    }
    throw new Error('Certificate not found');
}

if (typeof module !== 'undefined') {
    module.exports = {
        parseMozCOSE,
    };
}
