/**
 * (c) 2016 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* jshint worker:true */
/* globals EfficientTextWriter, setTimeout, zip, beautify */
'use strict';

importScripts(
    'lib/zip.js/zip.js',
    'lib/zip.js/inflate.js',
    'lib/efficienttextwriter.js',
    'lib/beautify/beautify.js'
);
zip.useWebWorkers = false; // No nested workers please.

// The file names in the zip file, sorted by file size (smallest first).
var allFilenames = [];

// File name to entry
var fileEntries = null;
// File name to string[] representing the file content and optionally beautified file content.
var dataMap = {};
var dataMapLowerCase = {};

var currentSearchTerm = '';
var lowPrioFilenames = [];

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
    // Note: The main thread should only send a message if
    // the results are expected to be modified, i.e.
    // either message.searchTerm !== currentSearchTerm,
    // or message.lowPrioFilenames differs from lowPrioFilenames.

    currentSearchTerm = message.searchTerm;
    lowPrioFilenames = message.lowPrioFilenames;
    if (!fileEntries || !currentSearchTerm) {
        return;
    }
    var filenames = prioritizedFilenames(allFilenames);
    if (pendingSearch) {
        pendingSearch.cancel();
        pendingSearch = null;
    }
    new SearchTask(filenames, message.searchTerm).next();
};

function prioritizedFilenames(filenames) {
    filenames = filenames.slice();
    // Optimize for minimal overhead by removing low-priority file names.
    // In the past, low-priority files were pushed to the end, but that
    // results in unnecessary CPU and memory usage for situations where
    // one searches for a pattern in specific files only.
    lowPrioFilenames.forEach(function(filename) {
        var i = filenames.indexOf(filename);
        if (i === -1) throw new Error("Unknown file: " + filename);
        filenames.splice(i, 1);
    });
    return filenames;
}

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
                new SearchTask(prioritizedFilenames(allFilenames), currentSearchTerm).next();
            }
        });
    }, function(e) {
        throw e;
    });
}

function isValidFileData(data) {
    return Array.isArray(data);
}
function getFileData(filename) {
    var data = dataMap[filename];
    if (isValidFileData(data)) {
        return data;
    }
    var entry = fileEntries[filename];
    delete fileEntries[filename];
    if (!entry) {
        return null; // Already opening...
    }
    entry.getData(new EfficientTextWriter(), function(data) {
        beautify({
            text: data,
            type: beautify.getType(filename),
        }, function(beautifiedData) {
            if (data === beautifiedData) {
                dataMap[filename] = [data];
            } else {
                dataMap[filename] = [data, beautifiedData];
            }
            if (pendingSearch) {
                pendingSearch.resume();
            }
        });
    });
    return null;
}

function normalizeTextForSearch(text) {
    return text.toLocaleLowerCase();
}

function SearchTask(filenames, searchTerm) {
    this.filenames = filenames;
    // The exact input search query. This will be used by the calling thread to
    // determine whether the search result still matches the search query.
    this.searchTerm = searchTerm;
    // Keep this search term parsing logic in sync with
    // TextSearchEngine.prototype.getCurrentSearchTerm.
    // "iregexp:" is case-insensitive, "regexp:" is case-sensitive.
    var searchTermAsRegExp = /^(i?)regexp:(.*)$/.exec(searchTerm);
    if (searchTermAsRegExp) {
        // Callers should have validated that the regexp is valid.
        this.searchTermRegExp = new RegExp(searchTermAsRegExp[2], searchTermAsRegExp[1]);
    } else {
        // "case:" is case-sensitive; otherwise the query is case-insensitive.
        this.searchTermCaseSensitive = searchTerm.lastIndexOf('case:', 0) === 0;
        if (this.searchTermCaseSensitive) {
            this.searchTermNormalized = searchTerm.slice(5);
        } else {
            this.searchTermNormalized = normalizeTextForSearch(searchTerm);
        }
        this.searchTermRegExp = null;
    }
    this.paused = true;
    // Temporarily save the results until it's flushed in a batch to minimize the overhead of
    // continuously updating the UI in separate messages.
    this.found = [];
    this.notfound = [];
    this.querytime = 0;
    pendingSearch = this;
}
SearchTask.prototype.next = function() {
    if (pendingSearch !== this) { // Search task changed.
        return;
    }
    if (!this.filenames.length) { // Done.
        this.sendResults(true);
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
            if (isValidFileData(data)) {
                this.filenames.splice(dataIndex, 1);
                break;
            }
        }
        if (!isValidFileData(data)) {
            this.paused = true;
            // Callers will call resume() if needed when data becomes available.
            break;
        }

        if (!this.searchTermRegExp && !this.searchTermCaseSensitive) {
            // The result is cached instead of calculated on the fly to avoid pressure on GC
            // because it is expected that the query is frequently repeated.
            data = dataMapLowerCase[filename] ||
                (dataMapLowerCase[filename] = data.map(normalizeTextForSearch));
        }
        if (data.some(this.matchesSearchTerm, this)) {
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
SearchTask.prototype.matchesSearchTerm = function(text) {
    if (this.searchTermRegExp) {
        return this.searchTermRegExp.test(text);
    }
    return text.indexOf(this.searchTermNormalized) !== -1;
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
SearchTask.prototype.sendResults = function(forceSend) {
    if (!this.found.length && !this.notfound.length && !forceSend) return;
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
