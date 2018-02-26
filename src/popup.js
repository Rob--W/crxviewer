/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* jshint browser:true, devel:true */
/* globals chrome, get_crx_url, get_zip_name, is_crx_url, getParam, openCRXasZip */
/* globals encodeQueryString */
'use strict';
var cws_url;
var crx_url = getParam('crx');
var filename;

if (crx_url) {
    crx_url = get_crx_url(crx_url); // Normalize if needed.
    filename = get_zip_name(crx_url);
    ready();
} else {
    // Get CWS URL. On failure, close the popup
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, function(tabs) {
        cws_url = tabs[0].url;
        crx_url = get_crx_url(cws_url);
        filename = get_zip_name(crx_url);
        if (!is_crx_url(crx_url)) {
            chrome.pageAction.hide(tabs[0].id);
            window.close();
            return;
        }
        ready();
    });
}

function ready() {
    document.getElementById('download').onclick = doDownload;
    document.getElementById('view-source').onclick = doViewSource;
//#if OPERA
    document.getElementById('install-as-nex').onclick = doInstall;
//#endif
    if (getParam('doDownload')) {
        doDownload();
    }
}
var hasDownloadedOnce = false;
function doDownload() {
    if (hasDownloadedOnce) {
        console.log('Download is pending.');
        return;
    }
    openCRXasZip(crx_url, function(blob, publicKey) {
        tryTriggerDownload(blob, filename);
    }, function(errorMessage) {
        hasDownloadedOnce = false;
        document.getElementById('download').classList.toggle('downloading', hasDownloadedOnce);
        console.error(errorMessage);
        alert('Error in CRX Viewer:\n\n' + errorMessage);
    }, onXHRprogress.bind(null, document.getElementById('download')));
    hasDownloadedOnce = true;
    document.getElementById('download').classList.toggle('downloading', hasDownloadedOnce);
}
function doViewSource() {
    chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
    }, function(tabs) {
        chrome.tabs.create({
            url: chrome.extension.getURL('crxviewer.html') +
                '?' + encodeQueryString({crx: crx_url, zipname: filename}),
            active: true,
            index: tabs && tabs.length ? tabs[0].index + 1 : undefined,
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
//#if OPERA
var hasDownloadedCRX = false;
function doInstall() {
    var filename_nex = filename.replace(/\.zip$/, '.nex');

    if (hasDownloadedCRX) {
        console.log('Download is pending.');
        return;
    }
    var x = new XMLHttpRequest();
    x.open('GET', crx_url);
    x.responseType = 'blob';
    x.onprogress = onXHRprogress.bind(null, document.getElementById('install-as-nex'));
    x.onload = function() {
        var blob = x.response;
        if (!blob) {
            hasDownloadedCRX = false;
            alert('Unexpected error: no response for ' + crx_url);
            return;
        }
        if (blob.type !== 'application/x-navigator-extension' ||
            blob.type !== 'application/x-chrome-extension') {
            blob = new Blob([blob], {
                type: 'application/x-navigator-extension'
            });
        }
        tryTriggerDownload(blob, filename_nex);
    };
    x.onerror = function() {
        hasDownloadedCRX = false;
        alert('Network error for ' + crx_url);
    };
    x.onabort = function() {
        hasDownloadedCRX = false;
    };
    x.send();
    hasDownloadedCRX = true;
}
//#endif

// Delegate download to background page to make sure that the download dialog shows up.
function tryTriggerDownload(blob, filename) {
//#if FIREFOX
    if (!chrome.runtime.getBackgroundPage) {
        // For Firefox 45 (https://hg.mozilla.org/mozilla-central/rev/65f6e081ded8).
        chrome.runtime.getBackgroundPage = function(cb) {
            cb(chrome.extension.getBackgroundPage());
        };
    }
//#endif
    chrome.runtime.getBackgroundPage(function(bg) {
        bg.tryTriggerDownload(blob, filename);
        window.close();
    });
}
