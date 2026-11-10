/**
 * (c) 2026 Subham Mahesh
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Entry point for zip.js (@zip.js/zip.js, BSD-3-Clause license).
 * Bundled by `node make.js bundles` into src/lib/zip.js/zip.js, which exposes
 * the global `zip` (in pages and in workers).
 *
 * The viewer was written for the callback-based API of zip.js 1.x. This file
 * provides that API (the parts used by this add-on) on top of zip.js 2.x:
 * - zip.createReader(reader, callback, onerror) -> reader.getEntries(callback),
 *   reader.close(callback), entry.getData(writer, onend)
 * - zip.createWriter(writer, callback, onerror) -> writer.add(name, reader, onend),
 *   writer.close(callback)
 * - zip.BlobReader, zip.TextReader, zip.Writer, zip.BlobWriter, zip.TextWriter,
 *   zip.Data64URIWriter, zip.getMimeType
 * Compression uses the browser's built-in CompressionStream and DecompressionStream.
 */

import {
    ZipReader, ZipWriter, BlobReader, TextReader, BlobWriter, Uint8ArrayWriter,
    configure,
} from '@zip.js/zip.js/lib/zip-native.js';
// The full table of file types (the core entry only knows a default type).
import {getMimeType} from '@zip.js/zip.js/mime-types';

// Web workers are not needed: the viewer already runs heavy work (search) in
// its own worker, and the extension's content security policy does not allow
// the blob: workers that zip.js would create.
configure({useWebWorkers: false});

// ---- Readers: wrap the data, converted to a zip.js 2.x reader when used.
function CompatBlobReader(blob) {
    this.blob = blob;
    this.size = blob.size;
}
CompatBlobReader.prototype.toReader = function() {
    return new BlobReader(this.blob);
};
function CompatTextReader(text) {
    this.text = text;
}
CompatTextReader.prototype.toReader = function() {
    return new TextReader(this.text);
};
function toReader(reader) {
    return reader && reader.toReader ? reader.toReader() : reader;
}

// ---- Writers (zip.js 1.x interface): init(callback),
// writeUint8Array(array, callback), getData(callback).
function Writer() {}
Writer.prototype.init = function(callback) {
    callback();
};
Writer.prototype.writeUint8Array = function(array, callback) {
    callback();
};
Writer.prototype.getData = function(callback) {
    callback();
};

function ChunkWriter() {
    this.chunks = [];
}
ChunkWriter.prototype = Object.create(Writer.prototype);
ChunkWriter.prototype.init = function(callback) {
    this.chunks = [];
    callback();
};
ChunkWriter.prototype.writeUint8Array = function(array, callback) {
    this.chunks.push(array);
    callback();
};

function CompatBlobWriter(contentType) {
    ChunkWriter.call(this);
    this.contentType = contentType || '';
}
CompatBlobWriter.prototype = Object.create(ChunkWriter.prototype);
CompatBlobWriter.prototype.getData = function(callback) {
    callback(new Blob(this.chunks, {type: this.contentType}));
};

function CompatTextWriter(encoding) {
    ChunkWriter.call(this);
    this.encoding = encoding || 'utf-8';
}
CompatTextWriter.prototype = Object.create(ChunkWriter.prototype);
CompatTextWriter.prototype.getData = function(callback) {
    var decoder = new TextDecoder(this.encoding);
    var text = '';
    this.chunks.forEach(function(chunk) {
        text += decoder.decode(chunk, {stream: true});
    });
    callback(text + decoder.decode());
};

function CompatData64URIWriter(contentType) {
    CompatBlobWriter.call(this, contentType);
}
CompatData64URIWriter.prototype = Object.create(CompatBlobWriter.prototype);
CompatData64URIWriter.prototype.getData = function(callback) {
    var reader = new FileReader();
    reader.onload = function() {
        callback(reader.result);
    };
    reader.readAsDataURL(new Blob(this.chunks, {type: this.contentType || 'application/octet-stream'}));
};

// Feeds the bytes to a zip.js 1.x writer and calls onend with its result.
function writeToCompatWriter(writer, bytes, onend, onerror) {
    try {
        writer.init(function() {
            writer.writeUint8Array(bytes, function() {
                writer.getData(onend);
            }, onerror);
        }, onerror);
    } catch (e) {
        onerror(e);
    }
}

function reportError(onerror, error) {
    console.error('zip.js:', error);
    if (onerror) onerror(error && error.message || String(error));
}

// ---- Reading
function wrapEntry(entry, onerror) {
    return {
        filename: entry.filename,
        directory: entry.directory,
        compressedSize: entry.compressedSize,
        uncompressedSize: entry.uncompressedSize,
        lastModDate: entry.lastModDate,
        comment: entry.comment,
        // onprogress and checkCrc32 (zip.js 1.x) are not used by the viewer.
        getData: function(writer, onend) {
            entry.getData(new Uint8ArrayWriter()).then(function(bytes) {
                writeToCompatWriter(writer, bytes, onend, reportError.bind(null, onerror));
            }, reportError.bind(null, onerror));
        },
    };
}

function createReader(reader, callback, onerror) {
    var zipReader = new ZipReader(toReader(reader));
    // Read the list of files now, so that invalid zip files are reported to
    // onerror, like zip.js 1.x did.
    zipReader.getEntries().then(function(entries) {
        var wrapped = entries.map(function(entry) {
            return wrapEntry(entry, onerror);
        });
        callback({
            getEntries: function(cb) {
                cb(wrapped);
            },
            close: function(cb) {
                zipReader.close().then(function() {
                    if (cb) cb();
                }, function() {
                    if (cb) cb();
                });
            },
        });
    }, reportError.bind(null, onerror));
}

// ---- Writing
function createWriter(writer, callback, onerror) {
    var zipWriter = new ZipWriter(new BlobWriter(writer && writer.contentType || 'application/zip'));
    callback({
        add: function(name, reader, onend, onprogress, options) {
            zipWriter.add(name, toReader(reader), options && options.directory ? {directory: true} : undefined)
                .then(function() {
                    if (onend) onend();
                }, reportError.bind(null, onerror));
        },
        close: function(cb) {
            zipWriter.close().then(function(blob) {
                if (!writer || writer instanceof CompatBlobWriter && !(writer instanceof CompatData64URIWriter)) {
                    cb(blob);
                    return;
                }
                blob.arrayBuffer().then(function(buffer) {
                    writeToCompatWriter(writer, new Uint8Array(buffer), cb, reportError.bind(null, onerror));
                });
            }, reportError.bind(null, onerror));
        },
    });
}

self.zip = {
    Writer: Writer,
    BlobReader: CompatBlobReader,
    TextReader: CompatTextReader,
    BlobWriter: CompatBlobWriter,
    TextWriter: CompatTextWriter,
    Data64URIWriter: CompatData64URIWriter,
    createReader: createReader,
    createWriter: createWriter,
    getMimeType: getMimeType,
    // zip.js 1.x settings. They have no effect: web workers are never used.
    useWebWorkers: false,
    workerScriptsPath: null,
};
