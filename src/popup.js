/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */

/* jshint browser:true, devel:true */
/* globals chrome, get_crx_url, get_zip_name, is_crx_url, getParam, openCRXasZip, URL */
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
}
if (typeof URL === 'undefined') window.URL = window.webkitURL;
var blob_url;
function showDownload() {
    tryTriggerDownload(blob_url, filename);
}
var hasDownloadedOnce = false;
function doDownload() {
    if (hasDownloadedOnce) {
        if (blob_url) showDownload();
        else alert('Download is pending.');
        return;
    }
    openCRXasZip(crx_url, function(blob, publicKey) {
        blob_url = URL.createObjectURL(blob);
        showDownload();
    }, function(errorMessage) {
        hasDownloadedOnce = false;
        console.error(errorMessage);
        alert('Error in CRX Viewer:\n\n' + errorMessage);
    });
    hasDownloadedOnce = true;
}
window.addEventListener('unload', function() {
    if (blob_url) {
        URL.revokeObjectURL(blob_url);
    }
});
function doViewSource() {
    chrome.tabs.create({
        url: chrome.extension.getURL('crxviewer.html') +
            '?crx=' + encodeURIComponent(crx_url) +
            '&zipname=' + encodeURIComponent(filename),
        active: true
    });
}
//#if OPERA
function doInstall() {
    var name = filename.replace(/\.zip$/, '.nex');
    tryTriggerDownload(crx_url, name);
}
//#endif

// Try to download in the context of the current tab, such that the download
// continues even when the popup closed.
// In Opera, the Save As dialog almost falls off the screen because it's positioned relative
// to the upper-left corner of the (page action popup) viewport...
function tryTriggerDownload(url, filename) {
    chrome.tabs.executeScript({
        code: '(' + triggerDownload + '})(' + JSON.stringify(url) + ',' + JSON.stringify(filename) + ')'
    }, function(result) {
        if (!result) {
            // Access denied? Then try to save in the context of the popup
            triggerDownload(url, filename);
        }
    });
}
function triggerDownload(url, filename) {
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
}
