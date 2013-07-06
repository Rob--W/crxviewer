/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */

/* jshint browser:true, devel:true */
/* globals chrome, cws_pattern, get_extensionID, get_crx_url, getParam, URL */
'use strict';
var cws_url;
var crx_url = getParam('crx');
var filename;

if (crx_url) {
    filename = crx_url.match(/([^\/]+?)\/*$/)[1].replace(/\.(zip|nex)$/i, '') + '.zip';
    ready();
} else {
    // Get CWS URL. On failure, close the popup
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, function(tabs) {
        cws_url = tabs[0].url;
        crx_url = get_crx_url(cws_url);
        filename = get_extensionID(cws_url) + '.zip';
        if (!cws_pattern.test(cws_url)) {
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
        url: chrome.extension.getURL('crxviewer.html') + '?crx=' + encodeURIComponent(crx_url),
        active: true
    });
}
