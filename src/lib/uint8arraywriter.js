/**
 * (c) 2017 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals Uint8Array, zip */
'use strict';

/**
 * A zip.Writer for zip.js to read an entry as a Uint8Array.
 */
function Uint8ArrayWriter() {
    this.chunks = [];
}
Uint8ArrayWriter.prototype = Object.create(zip.Writer.prototype);
Uint8ArrayWriter.prototype.init = function(callback) {
    this.chunks.length = [];
    callback();
};
Uint8ArrayWriter.prototype.writeUint8Array = function(chunk, callback) {
    this.chunks.push(chunk);
    callback();
};
Uint8ArrayWriter.prototype.getData = function(callback) {
    var chunks = this.chunks;
    if (chunks.length === 1) {
        callback(chunks[0]);
        return;
    }
    var length = chunks.reduce(function(total, chunk) {
        return total + chunk.length;
    }, 0);
    var data = new Uint8Array(length);
    var offset = 0;
    this.chunks.forEach(function(chunk) {
        data.set(chunk, offset);
        offset += chunk.length;
    });
    this.chunks.length = 1;
    this.chunks[0] = data;

    callback(data);
};
