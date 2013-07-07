/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */

/* jshint browser:true, devel:true */
/* globals chrome, cws_pattern, ows_pattern, get_crx_url, get_zip_name,
    is_crx_url, getParam, URL */
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
}
if (typeof URL === 'undefined') window.URL = window.webkitURL;
var blob_url;
function showDownload() {
    var a = document.createElement('a');
    a.href = blob_url;
    a.download = filename;
    a.click();
}
var hasDownloadedOnce = false;
function doDownload() {
    if (hasDownloadedOnce) {
        if (blob_url) showDownload();
        else alert('Download is pending.');
        return;
    }
    var x = new XMLHttpRequest();
    x.open('GET', crx_url);
    x.responseType = 'blob';
    x.onload = function() {
        if (!x.response) {
            console.log('Unexpected error: response is empty for ' + crx_url);
            return;
        }
        blob_url = URL.createObjectURL(new Blob([x.response], {type: 'application/zip'}));
        x = null;
        showDownload();
    };
    x.onerror = function() {
        hasDownloadedOnce = false;
        console.log('Network error for ' + crx_url);
    };
    x.send();
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
