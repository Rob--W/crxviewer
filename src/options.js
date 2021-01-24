/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* jshint browser:true, devel:true */
/* globals chrome */
'use strict'; 
//#if CHROME
var permission = {
    origins: ['<all_urls>']
};
chrome.permissions.contains(permission, setHasPermission);
//// Assume that there is only one optional permission
chrome.permissions.onAdded.addListener(setHasPermission.bind(null, true));
chrome.permissions.onRemoved.addListener(setHasPermission.bind(null, false));

function setHasPermission(hasAccessToAllURLs) {
    document.getElementById('hasAccessToAllURLs').checked = hasAccessToAllURLs;
    console.log('Has access to all URLs = ' + hasAccessToAllURLs);
}

if (chrome.declarativeWebRequest) {
    document.getElementById('hasAccessToAllURLs').onchange = function() {
        if (this.checked) {
            chrome.permissions.request(permission, function(result) {
                if (!result) setHasPermission(false);
            });
        } else {
            chrome.permissions.remove(permission);
        }
    };
} else {
    document.getElementById('hasAccessToAllURLs').disabled = true;
    document.getElementById('hasAccessToAllURLs').parentNode.insertAdjacentHTML('beforeend',
        '<br><em>This option is only available for Chrome users on the ' +
        '<a href="https://www.google.com/landing/chrome/beta/">Beta channel</a></em>.'
    );
}
//#endif

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
}, function(items) {
    document.getElementById('contextmenu').checked = items.showContextMenu;
    contextmenuPatternsInput.disabled = !items.showContextMenu;
    contextmenuPatternsInput.value = items.contextmenuPatterns.join('\n');
});

if (location.hash !== '#optionsV2') {
    // A normal options page, open links in the same tab.
    document.querySelector('base').remove();
}
