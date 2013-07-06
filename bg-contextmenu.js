/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */
/* jshint browser:true, devel:true */
/* globals chrome, cws_match_pattern */

'use strict';
(function() {
    var MENU_ID = 'nl.robwu.contextmenu.crxlink';
    chrome.storage.onChanged.addListener(function(changes) {
        if (!changes.showContextMenu) return;
        if (changes.showContextMenu.newValue) show();
        else hide();
    });
    chrome.runtime.onInstalled.addListener(function() {
        chrome.storage.local.get({showContextMenu:true}, function(items) {
            if (items.showContextMenu) show();
        });
    });
    
    chrome.contextMenus.onClicked.addListener(function(info, tab) {
        var crx_url = info.linkUrl;
        chrome.tabs.create({
            url: chrome.extension.getURL('crxviewer.html') + '?crx=' + encodeURIComponent(crx_url),
            active: true
        });
    });
    function show() {
        chrome.contextMenus.create({
            id: MENU_ID,
            title: 'View extension source',
            contexts: ['link'],
            targetUrlPatterns: [
                '*://*/*.crx*',
                '*://*/*.CRX*',
                '*://*/*.NEX*',
                '*://*/*.nex*',
                cws_match_pattern,
                '*://addons.opera.com/extensions/download/*'
            ]
        }, function() {
            if (chrome.runtime.lastError)
                console.error(chrome.runtime.lastError.message);
            else
                console.log('Created contextmenu item.');
        });
    }
    function hide() {
        chrome.contextMenus.removeAll();
    }
})();
