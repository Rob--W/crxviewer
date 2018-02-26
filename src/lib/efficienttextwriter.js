/**
 * (c) 2016 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals TextDecoder, zip */
'use strict';

/**
 * A modern version of zip.TextWriter with less overhead and better performance.
 */
function EfficientTextWriter(encoding) {
    this.chunks = [];
    this.decoder = new TextDecoder(encoding);
}
EfficientTextWriter.prototype = Object.create(zip.Writer.prototype);
EfficientTextWriter.prototype.init = function(callback) {
    this.chunks.length = [];
    callback();
};
EfficientTextWriter.prototype.writeUint8Array = function(chunk, callback) {
    var text = this.decoder.decode(chunk, {stream: true});
    this.chunks.push(text);
    callback();
};
EfficientTextWriter.prototype.getData = function(callback) {
    this.chunks.push(this.decoder.decode());
    callback(this.chunks.join(''));
};

if (typeof TextDecoder != 'function') {
    // Fall back in case TextDecoder is not supported.
    /* jshint -W021 */
    EfficientTextWriter = zip.TextWriter;
    /* jshint +W021 */
}
