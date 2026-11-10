/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: reduced to Firefox only (removed Chrome, Opera and web-demo code,
 * and Chrome/Edge/Opera CRX support). */

/* jshint browser:true, devel:true */
/* globals chrome, get_addon_download_url, get_zip_name, can_view_addon_url, openAddonAsZip */
/* globals encodeQueryString */
'use strict';
var page_url;
var addon_url;
var filename;

// See bg-contextmenu for potential values, at MENU_ID_ACTION_MENU.
var gActionClickAction = 'popup';

initialize();

function initialize() {
    var storageIsReady = false;

    // Get the URL of the add-on page. On failure, close the popup
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, function(tabs) {
        page_url = tabs[0].url;
        addon_url = get_addon_download_url(page_url);
        filename = get_zip_name(addon_url);
        if (!can_view_addon_url(addon_url)) {
            chrome.pageAction.hide(tabs[0].id);
            window.close();
            return;
        }
        ready();
        if (storageIsReady) {
            ready2();
        }
    });
    chrome.storage.sync.get({
        actionClickAction: gActionClickAction,
    }, function(items) {
        gActionClickAction = items && items.actionClickAction || gActionClickAction;
        storageIsReady = true;
        if (addon_url) {
            ready2();
        }
    });
}

function ready() {
    document.getElementById('download').onclick = doDownload;
    document.getElementById('view-source').onclick = doViewSource;
    // When the settings have been read, ready2 will run to finish.
}
function ready2() {
    if (gActionClickAction == 'popup') {
        // Default action is keeping this popup open.
        // Nothing else left to do.
    } else if (gActionClickAction == 'download') {
        doDownload();
    } else if (gActionClickAction == 'view-source') {
        doViewSource();
        return;
    }
    showPermissionPromptIfMissingHostPermission();
}
function showPermissionPromptIfMissingHostPermission() {
    if (!addon_url.startsWith('http')) {
        return; // Permissions only needed and available for http(s).
    }
    var hostPermission = new URL(addon_url).origin + '/*';
    chrome.permissions.contains({ origins: [hostPermission] }, function(ok) {
        // The API will report OK if the user accepted the full permission
        // request, or manually specified a subset.
        if (!ok) {
            showPermissionPrompt();
        }
    });
}
function showPermissionPrompt() {
    var form = document.getElementById('permission_missing_form');
    form.hidden = false;
    form.onsubmit = function(e) {
        e.preventDefault();
        var permission = {
            origins: ['*://*/*']
        };
        chrome.permissions.request(permission, function(hasAccess) {
            if (hasAccess) {
                form.hidden = true;
            }
        });
    };
    form.onreset = function(e) {
        form.hidden = true;
    };
}
function alert(msg) {
    var dialog = document.createElement('dialog');
    dialog.style.whiteSpace = 'pre-wrap';
    dialog.style.wordBreak = 'break-all';
    dialog.textContent = msg;
    dialog.onclose = function() {
        dialog.remove();
    };
    var closeButton = document.createElement('button');
    closeButton.onclick = function() {
        dialog.close();
    };
    closeButton.textContent = 'OK';
    dialog.append(closeButton);
    document.body.append(dialog);
    dialog.showModal();
    showPermissionPromptIfMissingHostPermission();
}
var hasDownloadedOnce = false;
function doDownload() {
    if (hasDownloadedOnce) {
        console.log('Download is pending.');
        return;
    }
    openAddonAsZip(addon_url, function(blob) {
        tryTriggerDownload(blob, filename);
    }, function(errorMessage) {
        hasDownloadedOnce = false;
        document.getElementById('download').classList.toggle('downloading', hasDownloadedOnce);
        console.error(errorMessage);
        alert('Error in Zen Source Viewer:\n\n' + errorMessage);
    }, onXHRprogress.bind(null, document.getElementById('download')));
    hasDownloadedOnce = true;
    document.getElementById('download').classList.toggle('downloading', hasDownloadedOnce);
}
function doViewSource() {
    chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
    }, function(tabs) {
        var tab = tabs && tabs[0];
        chrome.tabs.create({
            url: chrome.runtime.getURL('viewer.html') +
                '?' + encodeQueryString({url: addon_url, zipname: filename}),
            active: true,
            windowId: tab ? tab.windowId : undefined,
            index: tab ? tab.index + 1 : undefined,
            cookieStoreId: tab && tab.cookieStoreId,
        }, function() {
            window.close();
        });
    });
}
function onXHRprogress(progressContainer, xhrProgressEvent) {
    var progressBar = progressContainer.querySelector('progress');
    if (!progressBar) {
        progressBar = document.createElement('progress');
        progressContainer.appendChild(progressBar);
    }
    if (xhrProgressEvent.lengthComputable) {
        progressBar.max = xhrProgressEvent.total;
        progressBar.value = xhrProgressEvent.loaded;
    } else {
        progressBar.removeAttribute('value');
    }
}

function tryTriggerDownload(blob, filename) {
    // Use background to trigger download to avoid blob:-URL invalidation when
    // the popup is closed, see https://bugzil.la/2005952
    chrome.runtime.sendMessage({
        action: "downloadBlob",
        blob,
        incognito: chrome.extension.inIncognitoContext,
        filename: filename,
    }, function() {
        // The popup should have closed already, but if not, do it now.
        window.close();
    });
}
