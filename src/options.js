/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 */
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

var storageArea = chrome.storage.sync || chrome.storage.local;
document.getElementById('contextmenu').onchange = function() {
    storageArea.set({showContextMenu: this.checked});
};
storageArea.get({showContextMenu:true}, function(items) {
    document.getElementById('contextmenu').checked = items.showContextMenu;
});

//#if FIREFOX
if (/Firefox\/4\d\./.test(navigator.userAgent)) {
    document.getElementById('contextmenu').parentNode.insertAdjacentHTML('beforeend',
        '<em>Because of a <a href="https://bugzil.la/1275126">bug in Firefox</a>, ' +
       'the menu item appears on all links (instead of just the addon links). ' +
       'This bug has been fixed in Firefox 50.</em>');
    // ^ If not done by someone else I will submit a patch, hence that statement must be true.
}
//#endif

if (location.hash !== '#optionsV2') {
    // A normal options page, open links in the same tab.
    document.querySelector('base').remove();
}
