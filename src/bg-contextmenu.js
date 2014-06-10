/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 */
/* jshint browser:true, devel:true */
/* globals chrome, cws_match_pattern, ows_match_pattern, get_crx_url */

'use strict';
(function() {
    var MENU_ID_LINK = 'nl.robwu.contextmenu.crxlink';
    var MENU_ID_PAGE = 'nl.robwu.contextmenu.crxpage';
    chrome.storage.onChanged.addListener(function(changes) {
        if (!changes.showContextMenu) return;
        if (changes.showContextMenu.newValue) show();
        else hide();
    });
    chrome.runtime.onInstalled.addListener(checkContextMenuPref);
    chrome.runtime.onStartup.addListener(checkContextMenuPref);
    function checkContextMenuPref() {
        chrome.storage.local.get({showContextMenu:true}, function(items) {
            if (items.showContextMenu) show();
        });
    }
    
    chrome.contextMenus.onClicked.addListener(function(info, tab) {
        var url = info.menuItemId == MENU_ID_PAGE ? info.pageUrl : info.linkUrl;
        url = get_crx_url(url);
        var params = 'crx=' + encodeURIComponent(url);

        chrome.tabs.create({
            url: chrome.extension.getURL('crxviewer.html') + '?' + params,
            active: true
        });
    });
    function show() {
        chrome.contextMenus.create({
            id: MENU_ID_LINK,
            title: 'View extension source',
            contexts: ['link'],
            targetUrlPatterns: [
                '*://*/*.crx*',
                '*://*/*.CRX*',
                '*://*/*.NEX*',
                '*://*/*.nex*',
                cws_match_pattern,
                ows_match_pattern
            ]
        });
        chrome.contextMenus.create({
            id: MENU_ID_PAGE,
            title: 'View extension source',
            contexts: ['all'],
            documentUrlPatterns: [
                cws_match_pattern,
                ows_match_pattern
            ]
        });
    }
    function hide() {
        chrome.contextMenus.removeAll();
    }
})();
