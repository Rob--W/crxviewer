/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */
var cws_url;

// Get CWS URL. On failure, close the popup
chrome.tabs.query({
    active: true,
    currentWindow: true
}, function(tabs) {
    cws_url = tabs[0].url;
    if (!cws_pattern.test(cws_url)) {
        chrome.pageAction.hide(tabs[0].id);
        window.close();
        return;
    }
    document.getElementById('download').onclick = doDownload;
    document.getElementById('view-source').onclick = doViewSource;
});

// In the functions below, cws_url is expected to be a string matching cws_pattern.
// This should always be true, because both methods are only bound as event
// listeners if the URL matches
if (typeof URL === 'undefined') window.URL = window.webkitURL;
var blob_url;
function showDownload() {
    var filename = get_extensionID(cws_url) + '.zip';
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
    x.open('GET', get_crx_url(cws_url));
    x.responseType = 'blob';
    x.onload = function() {
        if (!x.response) {
            console.log('Unexpected error: response is empty for ' + url);
            return;
        }
        blob_url = URL.createObjectURL(new Blob([x.response], {type: 'application/zip'}));
        x = null;
        showDownload();
    };
    x.onerror = function() {
        hasDownloadedOnce = false;
        console.log('Network error for ' + url);
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
        url: chrome.extension.getURL('crxviewer.html') + '?url=' + encodeURIComponent(cws_url),
        active: true
    });
}
