/* jshint worker:true */
/* globals Uint8Array, TextEncoder, setTimeout, zip */
'use strict';

importScripts('lib/zip.js/zip.js', 'lib/zip.js/inflate.js');
zip.useWebWorkers = false; // No nested workers please.

// The file names in the zip file, sorted by file size (smallest first).
var allFilenames = [];

// File name to entry
var fileEntries = null;
// File name to Uint8Array
var dataMap = {};

var currentSearchTerm = '';

// When not all data is available yet, the search job is suspended and stored here.
// It will be resumed when new data is available.
var pendingSearch = null;

// TODO(robwu): Cache results
// var cachedResults = {};


self.onmessage = function(event) {
    var message = event.data;
    if (message.zipBlob) {
        loadFromZip(message.zipBlob);
        return;
    }
    if (message.searchTerm === currentSearchTerm) {
        return;
    }
    currentSearchTerm = message.searchTerm;
    if (!fileEntries) {
        return;
    }
    // For now just search through all files.
    // In the future I may restrict to the visible files.
    var filenames = allFilenames.slice();
    if (pendingSearch) {
        pendingSearch.cancel();
    }
    new SearchTask(filenames, message.searchTerm).next();
};

function loadFromZip(zipBlob) {
    if (fileEntries) {
        // For now let's support only one zip file.
        throw new Error('Cannot load another file');
    }
    zip.createReader(new zip.BlobReader(zipBlob), function(zipReader) {
        zipReader.getEntries(function(entries) {
            fileEntries = {};
            entries = entries.filter(function(entry) {
                return !entry.directory;
            });
            // Sort from low file size to big file size to get quicker results.
            entries.sort(function(a, b) {
                return a.uncompressedSize - b.uncompressedSize;
            });
            entries.forEach(function(entry) {
                fileEntries[entry.filename] = entry;
                allFilenames.push(entry.filename);
            });
            if (currentSearchTerm) {
                // TODO: If I ever want to add file filtering, then I should change this logic as
                // well.
                new SearchTask(allFilenames.slice(), currentSearchTerm).next();
            }
        });
    }, function(e) {
        throw e;
    });
}

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

function getFileData(filename) {
    var data = dataMap[filename];
    if (data) {
        return data;
    }
    var entry = fileEntries[filename];
    delete fileEntries[filename];
    if (!entry) {
        return null; // Already opening...
    }
    entry.getData(new Uint8ArrayWriter(), function(uint8Array) {
        dataMap[filename] = uint8Array;
        if (pendingSearch) {
            pendingSearch.resume();
        }
    });
    return null;
}

function SearchTask(filenames, searchTerm) {
    this.filenames = filenames;
    this.searchTerm = searchTerm;
    this.paused = true;
    // Temporarily save the results until it's flushed in a batch to minimize the overhead of
    // continuously updating the UI in separate messages.
    this.found = [];
    this.notfound = [];
    this.querytime = 0;
    pendingSearch = this;
}
SearchTask.prototype.next = function() {
    if (!this.filenames.length || pendingSearch !== this) {
        // Either done or search task changed.
        return;
    }
    var startTime = Date.now();
    do {
        var dataIndex;
        var data;
        var filename;
        // Note that the files are sorted by size, so the first files should be processed asap.
        for (data = null, dataIndex = 0; dataIndex < this.filenames.length; ++dataIndex) {
            filename = this.filenames[dataIndex];
            data = getFileData(filename);
            if (data) {
                this.filenames.splice(dataIndex, 1);
                break;
            }
        }
        if (!data) {
            this.paused = true;
            // Callers will call resume() if needed when data becomes available.
            break;
        }

        var needle = new TextEncoder().encode(this.searchTerm);
        var needleLength = needle.length;
        var found = false;
        outerloop: for (var i = 0, ii = data.length - needleLength; i <= ii; ++i) {
            for (var j = 0, jj = needleLength; j < jj; ++j) {
                if (data[i + j] !== needle[j]) {
                    continue outerloop;
                }
            }
            found = true;
            break;
        }
        if (found) {
            this.found.push(filename);
        } else {
            this.notfound.push(filename);
        }
    } while ((Date.now() - startTime) < 500);
    // ^ Do not work too much

    // Keep track of the time spent in the loop to measure the impact of search algorithm changes
    // on the runtime. If existent, retrieving the file data has minimal overhead so clocking the
    // loop gives an accurate representation of time.
    this.querytime += Date.now() - startTime;

    this.sendResults();

    if (this.paused) {
        return;
    }

    // Allow message events to flush, to update the search query if needed.
    var task = this;
    setTimeout(function() {
        task.next();
    }, 0);
};
SearchTask.prototype.resume = function() {
    if (this.paused) {
        this.paused = false;
        this.next();
    }
};
SearchTask.prototype.cancel = function() {
    this.filenames.length = 0;
};
SearchTask.prototype.sendResults = function() {
    if (!this.found.length && !this.notfound.length) return;
    self.postMessage({
        found: this.found,
        notfound: this.notfound,
        searchTerm: this.searchTerm,
        remaining: this.filenames.length,
        querytime: this.querytime,
    });
    this.found.length = 0;
    this.notfound.length = 0;
};
