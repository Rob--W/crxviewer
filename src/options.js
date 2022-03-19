/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* jshint browser:true, devel:true */
/* globals chrome */
'use strict'; 

var storageArea = chrome.storage.sync;
var contextmenuPatternsInput = document.getElementById('contextmenuPatterns');
document.getElementById('contextmenu').onchange = function() {
    storageArea.set({showContextMenu: this.checked});
    contextmenuPatternsInput.disabled = !this.checked;
};

contextmenuPatternsInput.oninput = function() {
    var patterns = [];
    var errorMsg = '';
    this.value.split('\n').every(function(line, i) {
        line = line.trim();
        if (!line) {
            return;
        }
        if (!/^(\*|https?|ftp|file|data):\/\/\*?[^/*]*\//.test(line)) {
            errorMsg = 'Invalid URL pattern at line ' + (i + 1) + ': ' + line;
            errorMsg += '\nPatterns must look like a URL and may contain at most one * (wildcard) as a subdomain, and any number of * in the path.';
            return;
        }
        patterns.push(line);
        return true;
    });

    var contextmenuPatternsOutput = document.getElementById('contextmenuPatternsOutput');
    contextmenuPatternsOutput.style.color = 'red';
    if (errorMsg) {
        contextmenuPatternsOutput.textContent = 'URL patterns not applied; ' + errorMsg;
        return;
    }
    storageArea.set({contextmenuPatterns: patterns}, function() {
        if (chrome.runtime.lastError) {
            contextmenuPatternsOutput.textContent =
                'Failed to save URL patterns due to error: ' + chrome.runtime.lastError.message;
        } else {
            contextmenuPatternsOutput.style.color = '';
            contextmenuPatternsOutput.textContent =
                'Applied ' + patterns.length + ' URL patterns.';
        }
    });
};

storageArea.get({
    showContextMenu: true,
    contextmenuPatterns: [],
//#if FIREFOX
    showPageAction: true,
//#endif
}, function(items) {
    document.getElementById('contextmenu').checked = items.showContextMenu;
    contextmenuPatternsInput.disabled = !items.showContextMenu;
    contextmenuPatternsInput.value = items.contextmenuPatterns.join('\n');
//#if FIREFOX
    document.getElementById('pageaction').checked = items.showPageAction;
//#endif
});

//#if FIREFOX
document.getElementById('pageaction').onchange = function() {
    storageArea.set({showPageAction: this.checked});
};

//// May change via bg-contextmenu.js when the user toggles the option via the context menu.
chrome.storage.onChanged.addListener(function(items) {
    if (items.showPageAction) {
        document.getElementById('pageaction').checked = items.showPageAction.newValue;
    }
});
//#endif

if (location.hash !== '#optionsV2') {
    // A normal options page, open links in the same tab.
    document.querySelector('base').remove();
}
