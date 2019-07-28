/**
 * (c) 2019 Peter Wu <peter@lekensteyn.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// jshint esversion:6
/* globals TextDecoder */
/* exported parseCertificate, parseDERTLVs, tlvInfo */
'use strict';

const TAG_CLASS_UNIVERSAL = 0;
const TAG_CLASS_CONTEXT = 2;
const TAG_NUMBER_SEQUENCE = 16;
const TAG_NUMBER_SET = 17;

const TYPE_OBJECT_IDENTIFIER = 6;
const TYPE_UTF8STRING = 12;
const TYPE_T61String = 20;

// { joint-iso-ccitt(2) ds(5) 4 }
const OID_ID_AT = [2, 5, 4];
// { id-at 3 }
const OID_ID_AT_COMMONNAME = OID_ID_AT.concat([3]);

const universalTypes = [
    "reserved for BER",
    "BOOLEAN",
    "INTEGER",
    "BIT STRING",
    "OCTET STRING",
    "NULL",
    "OBJECT IDENTIFIER",
    "ObjectDescriptor",
    "EXTERNAL, INSTANCE OF",
    "REAL",
    "ENUMERATED",
    "EMBEDDED PDV",
    "UTF8String",
    "RELATIVE-OID",
    "reserved for future use",
    "reserved for future use",
    "SEQUENCE, SEQUENCE OF",
    "SET, SET OF",
    "NumericString",
    "PrintableString",
    "TeletexString, T61String",
    "VideotexString",
    "IA5String",
    "UTCTime",
    "GeneralizedTime",
    "GraphicString",
    "VisibleString, ISO646String",
    "GeneralString",
    "UniversalString",
    "CHARACTER STRING",
    "BMPString",
    "reserved for future use"
];

function parseDERTLV(buffer) {
    // T: any class, either P/C, any type
    // L: always definite length.
    // V: ...
    if (buffer.length < 2) {
        throw new Error('Buffer too small for tag and length');
    }
    let tagClass = buffer[0] >> 6;
    let tagConstructed = (buffer[0] >> 5) & 1;
    let tagNumber = buffer[0] & 0x1f;
    let offset = 1;
    if (tagNumber === 0x1f) {
        // Tag number is the concatenation of the 7 LSB. Last octet has MSB=0.
        tagNumber = 0;
        do {
            if (buffer.length < offset + 1) {
                throw new Error(`Buffer too small for tag and length: ${buffer.length} < ${offset} + 1`);
            }
            tagNumber = (tagNumber << 7) | (buffer[offset] & 0x7f);
        } while (buffer[offset++] & 0x80);
    }

    // L: if MSB is 0, the next 7 bits store the length.
    // L: if MSB is 1, the next 7 bits store the number of length octets (> 0).
    let length = buffer[offset];
    ++offset;
    if (length & 0x80) {
        let lengthOctets = length & 0x7f;
        if (lengthOctets === 0) {
            throw new Error('Indefinite length is illegal in DER');
        }
        if (buffer.length < offset + lengthOctets) {
            throw new Error(`Buffer too small for length: ${buffer.length} < ${offset} + ${lengthOctets}`);
        }
        length = 0;
        for (let i = 0; i < lengthOctets; i++) {
            length = (length << 8) | buffer[offset + i];
            if (length > 0xffffff) {
                throw new Error('Length is too long (unsupported)');
            }
            if (length === 0) {
                throw new Error('Length encoding must be minimal in DER');
            }
        }
        offset += lengthOctets;
    }
    if (buffer.length < offset + length) {
        throw new Error(`Buffer too small for value: ${buffer.length} < ${offset} + ${length}`);
    }
    return {
        tagClass,
        tagConstructed,
        tagNumber,
        value: buffer.slice(offset, offset + length),
        size: offset + length, // size of whole TLV (not just the value)
    };
}

/**
 * Callback for a parsed TLV.
 *
 * @callback tlvCallback
 * @param {object} tlv - A TLV from parseDERTLV.
 * @param {number} depth - The tree depth, starting at zero and increasing for
 * sequence or set types.
 * @param {number} tlvOffset - The absolute offset within the original buffer.
 */

/**
 * Parses the a series of DER-encoded TLVs.
 *
 * @param {Uint8Array|Buffer} data - An array of bytes.
 * @param {tlvCallback} cb - The callback that is called for every TLV.
 */
function parseDERTLVs(data, cb, depth = 0, originalOffset = 0) {
    for (let offset = 0; offset < data.length;) {
        let tlv = parseDERTLV(data.slice(offset));
        let headerLength = tlv.size - tlv.value.length;
        let tlvOffset = originalOffset + offset;
        let valueOffset = tlvOffset + headerLength;
        cb(tlv, depth, tlvOffset);
        if (tlv.tagClass === TAG_CLASS_UNIVERSAL) {
            if (tlv.tagNumber === TAG_NUMBER_SEQUENCE ||
                tlv.tagNumber === TAG_NUMBER_SET) {
                parseDERTLVs(tlv.value, cb, depth + 1, valueOffset);
            }
        } else if (tlv.tagClass === TAG_CLASS_CONTEXT) {
            parseDERTLVs(tlv.value, cb, depth + 1, valueOffset);
        }
        offset += tlv.size;
    }
}

/**
 * Parses an OID from a TLV.
 *
 * @param {object} tlv - A TLV from parseDERTLV.
 * @returns {null|number[]} An array of integers representing the OID or
 * null if the TLV is not an OID type.
 */
function parseOID(tlv) {
    if (tlv.tagClass !== TAG_CLASS_UNIVERSAL || tlv.tagNumber !== TYPE_OBJECT_IDENTIFIER) {
        return null;
    }
    let d = tlv.value;
    let oid = [(d[0] / 40) >> 0, d[0] % 40];
    let v = 0;
    for (let i = 1; i < d.length; i++) {
        v = ((v << 7) | (d[i] & 0x7f)) >>> 0;
        if (!(d[i] & 0x80)) {
            oid.push(v);
            v = 0;
        }
    }
    return oid;
}

/**
 * Parses a string from a TLV.
 *
 * @param {object} tlv - A TLV from parseDERTLV.
 * @returns {null|string} A string if the TLV is a supported string type or null
 * otherwise.
 * @throws {Error} The type is recognized, but contains unsupported characters.
 */
function parseString(tlv) {
    if (tlv.tagClass !== TAG_CLASS_UNIVERSAL) {
        return null;
    }
    let value = tlv.value;
    switch (tlv.tagNumber) {
        case TYPE_UTF8STRING:
            return new TextDecoder().decode(value);
        case TYPE_T61String:
            for (let i = 0; i < value.length; i++) {
                let c = value[0];
                if (!(c >= 0x20 && c <= 0x7e)) {
                    throw new Error(`Unsupported character in T61String: ${c}`);
                }
            }
            return new TextDecoder().decode(value);
        default:
            return null;
    }
}

/**
 * Generate debug output, similar to 'openssl asn1parse'. For use with
 * parseDERTLVs.
 */
function tlvInfo(tlv, depth, tlvOffset) {
    let headerLength = tlv.size - tlv.value.length;
    let valueOffset = tlvOffset + headerLength;
    console.log(
        `${tlvOffset.toString().padStart(5)}:d=${depth} `,
        `hl=${headerLength}`,
        `l=${tlv.value.length.toString().padStart(4)}`,
        (tlv.tagConstructed ? 'cons:' : 'prim:') +
        ' '.repeat(depth),
        tlv.tagClass === TAG_CLASS_UNIVERSAL ? universalTypes[tlv.tagNumber] :
        (tlv.tagClass === TAG_CLASS_CONTEXT ? `cont [ ${tlv.tagNumber} ]` :
        `class ${tlv.tagClass} [ ${tlv.tagNumber} ]`)
    );
}

/**
 * Parses the Subject commonName from a given DER-encoded certificate.
 *
 * @param {Uint8Array|Buffer} data - An array of bytes.
 * @returns {string} The Subject commonName.
 * @throws {Error} If the data was invalid.
 */
function parseCertificate(data) {
    // A Certificate has a commonName field in the Issuer and Subject fields.
    // Look for the second commonName OID and obtain the next string value.
    let commonNameCount = 0;
    let foundKey = false;
    let value;
    let tlvCallback = (tlv) => {
        if (value) {
            return;
        }
        if (foundKey) {
            value = tlv;
            return;
        }
        let oid = parseOID(tlv);
        if (!oid || oid.toString() !== OID_ID_AT_COMMONNAME.toString()) {
            return;
        }
        commonNameCount++;
        foundKey = commonNameCount === 2;
    };
    parseDERTLVs(data, tlvCallback);
    if (!value) {
        throw new Error('Could not find second commonName');
    }
    let name = parseString(value);
    if (!name) {
        throw new Error(`Failed to parse commonName: ${JSON.stringify(value)}`);
    }
    return name;
}

if (typeof require !== 'undefined') {
    // jshint node:true
    if (require.main === module) {
        let fs = require('fs');
        let der_file = process.argv[2];
        fs.readFile(der_file, (err, data) => {
            if (err) {
                console.log('Failed to read file:', err);
                return;
            }
            console.log('Input:', data);
            parseDERTLVs(data, tlvInfo);
            let name = parseCertificate(data);
            console.log(`commonName: ${name}`);
        });
    } else {
        module.exports = {
            parseCertificate,
            parseDERTLVs,
            tlvInfo,
        };
    }
}
