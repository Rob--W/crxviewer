/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 */
/* jshint browser:true, devel:true */
/* globals chrome, cws_match_pattern, ows_match_pattern, amo_match_patterns, amo_file_version_match_pattern, get_crx_url */
/* globals encodeQueryString */

'use strict';
(function() {
    var MENU_ID_LINK = 'nl.robwu.contextmenu.crxlink';
    var MENU_ID_PAGE = 'nl.robwu.contextmenu.crxpage';
    var MENU_ID_AMO_APPROVED_LINK = 'nl.robwu.contextmenu.amoapprovedlink';
    var MENU_ID_AMO_APPROVED_PAGE = 'nl.robwu.contextmenu.amoapprovedpage';
    chrome.storage.onChanged.addListener(function(changes) {
        if (!changes.showContextMenu) return;
        if (changes.showContextMenu.newValue) show();
        else hide();
    });
//#if !FIREFOX
    chrome.runtime.onInstalled.addListener(checkContextMenuPref);
    chrome.runtime.onStartup.addListener(checkContextMenuPref);
//#else
    chrome.contextMenus.removeAll(function() {
        checkContextMenuPref();
    });
    // Work-around for bugzil.la/1287359
    addEventListener('unload', function() {
        chrome.contextMenus.removeAll();
    });
//#endif
    function checkContextMenuPref() {
        var storageArea = chrome.storage.sync;
        storageArea.get({showContextMenu:true}, function(items) {
            if (items.showContextMenu) show();
        });
    }
    
    function contextMenusOnClicked(info, tab) {
        var url = info.menuItemId == MENU_ID_PAGE ||
           info.menuItemId == MENU_ID_AMO_APPROVED_PAGE ? info.pageUrl : info.linkUrl;
        url = get_crx_url(url);
        var params = encodeQueryString({crx: url});

        chrome.tabs.create({
            url: chrome.extension.getURL('crxviewer.html') + '?' + params,
            active: true
        });
    }
//#if !FIREFOX
    chrome.contextMenus.onClicked.addListener(contextMenusOnClicked);
//#endif
    function show() {
        chrome.contextMenus.create({
            id: MENU_ID_LINK,
            title: 'View linked extension source',
            contexts: ['link'],
//#if FIREFOX
            onclick: contextMenusOnClicked,
//#endif
            targetUrlPatterns: [
                '*://*/*.crx*',
                '*://*/*.CRX*',
                '*://*/*.NEX*',
                '*://*/*.nex*',
                '*://*/*.XPI*',
                '*://*/*.xpi*',
                cws_match_pattern,
                ows_match_pattern,
                amo_file_version_match_pattern,
            ]
        });
        // AMO lists multiple versions, specifically state that this
        // is the latest approved version to avoid ambiguity.
        chrome.contextMenus.create({
            id: MENU_ID_AMO_APPROVED_LINK,
            title: 'View linked extension source (latest approved version)',
            contexts: ['link'],
//#if FIREFOX
            onclick: contextMenusOnClicked,
//#endif
            targetUrlPatterns: amo_match_patterns,
        });
//#if FIREFOX
        if (/Firefox\/4\d\./.test(navigator.userAgent)) {
            // documentUrlPatterns was not supported until 50, the menu is always hidden (bugzil.la/1275116).
            // Not returning causes a useless menu item to appear on every page in Firefox 46 and 47 (bugzil.la/1250685).
            return;
        }
//#endif
        chrome.contextMenus.create({
            id: MENU_ID_PAGE,
            title: 'View extension source',
            contexts: ['all'],
//#if FIREFOX
            onclick: contextMenusOnClicked,
//#endif
            documentUrlPatterns: [
                cws_match_pattern,
                ows_match_pattern,
                amo_file_version_match_pattern,
            ]
        });
        // AMO lists multiple versions, specifically state that this
        // is the latest approved version to avoid ambiguity.
        chrome.contextMenus.create({
            id: MENU_ID_AMO_APPROVED_PAGE,
            title: 'View extension source (latest approved version)',
            contexts: ['page', 'frame', 'link'],
//#if FIREFOX
            onclick: contextMenusOnClicked,
//#endif
            documentUrlPatterns: amo_match_patterns,
        });
    }
    function hide() {
        chrome.contextMenus.removeAll();
    }
})();
