/**
 * (c) 2017 Rob Wu <rob@robwu.nl> (https://robwu.nl)
 * A polyfill for chrome.storage.sync in extensions.
 *
 * This polyfill allows you to use chrome.storage.sync without having to worry
 * about whether chrome.storage.sync is defined and functional. If the sync
 * storage area is empty, data will automatically be copied from storage.local
 * to storage.sync.
 *
 * Firefox added storage.sync in Firefox 52 (https://bugzil.la/1253740), but the
 * API was not functional until Firefox 53 (https://bugzil.la/1331467).
 */
/* globals chrome */
'use strict';

(function() {
    var storageAreaLocal = chrome.storage.local;
    var storageAreaSync = chrome.storage.sync;
    if (!storageAreaSync) {
        chrome.storage.sync = storageAreaLocal;
        return;
    }
    var syncGet = storageAreaSync.get;
    var syncSet = storageAreaSync.set;
    var syncRemove = storageAreaSync.remove;
    var syncClear = storageAreaSync.clear;

    var isNotSupportedForSure = false;

    storageAreaSync.get(null, function(items) {
        if (chrome.runtime.lastError) {
            // API call failed, it does probably not work.
            isNotSupportedForSure = true;
            chrome.storage.sync = storageAreaLocal;
            return;
        }
        // API call succeeded, so it probably works.
        storageAreaSync.get = syncGet;
        storageAreaSync.set = syncSet;
        storageAreaSync.remove = syncRemove;
        storageAreaSync.clear = syncClear;
        if (Object.keys(items).length) {
            return;  // Already migrated.
        }
        storageAreaLocal.get(null, function(items) {
            if (Object.keys(items).length) {
                syncSet(items);
                // Note: storage.local is not cleared, just in case.
            }
        });
    });

    [
        'get',
        'set',
        'clear',
        'remove',
    ].forEach(function(methodName) {
        var originalSyncMethod = storageAreaSync[methodName];
        storageAreaSync[methodName] = function methodWithFallback(items, callback) {
            if (!callback && methodName === 'get') {
                throw new Error('storage.sync.get requires a callback');
            }
            originalSyncMethod.call(storageAreaSync, items, function() {
                if (isNotSupportedForSure && chrome.runtime.lastError) {
                    storageAreaLocal[methodName](items, callback);
                } else if (callback) {
                    callback.apply(null, arguments);
                }
            });
        };
    });
})();
