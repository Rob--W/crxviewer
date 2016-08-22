/* jshint worker:true */
/* globals Uint8Array, TextEncoder */
'use strict';

/**
 * Receives messages:
 * - required identifier dataId
 * - optional Array<Uint8Array> dataChunks
 * - optional string searchTerm
 *
 * Sends messages:
 * - required identifier dataId
 * - result: true, false, null.
 *   true = found
 *   false = not found
 *   null = unknown because of missing data
 */

var dataMap = {};

// TODO(robwu): Cache results
// var cachedResults = {};

self.onmessage = function(event) {
    var message = event.data;
    var dataId = message.dataId;
    if (!dataMap[dataId]) {
        if (!message.dataChunks) {
            self.postMessage({
                dataId: dataId,
                found: null,
            });
            return;
        }
        cacheData(dataId, message.dataChunks);
    }
    doSearch(dataId, message.searchTerm);
};

// |data| is a list of Uint8Array objects.
function cacheData(dataId, dataChunks) {
    var data;
    if (dataChunks.length === 1) {
        data = dataChunks[0];
    } else {
        var length = dataChunks.reduce(function(total, chunk) {
            return total + chunk.length;
        }, 0);
        data = new Uint8Array(length);
        var offset = 0;
        dataChunks.forEach(function(chunk) {
            data.set(chunk, offset);
            offset += chunk.length;
        });
    }
    dataMap[dataId] = data;
}

function doSearch(dataId, searchTerm) {
    if (!searchTerm) {
        self.postMessage({
            dataId: dataId,
            searchTerm: searchTerm,
            found: true,
        });
        return;
    }

    // Naive search
    var data = dataMap[dataId];

    var needle = new TextEncoder().encode(searchTerm);
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
    self.postMessage({
        dataId: dataId,
        searchTerm: searchTerm,
        found: found,
    });
}
