/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */
/* jshint browser:true, devel:true */
/* globals chrome */
'use strict'; 
//#if CHROME
var permission = {
    origins: ['<all_urls>']
};
chrome.permissions.contains(permission, setHasPermission);
// Assume only one optional permission
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

document.getElementById('contextmenu').onchange = function() {
    chrome.storage.local.set({showContextMenu: this.checked});
};
chrome.storage.local.get({showContextMenu:true}, function(items) {
    document.getElementById('contextmenu').checked = items.showContextMenu;
});
