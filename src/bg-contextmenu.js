/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* jshint browser:true, devel:true */
/* globals chrome, cws_match_pattern, mea_match_pattern, ows_match_pattern, amo_match_patterns, amo_file_version_match_patterns, get_crx_url */
/* globals encodeQueryString */

'use strict';
(function() {
    var MENU_ID_LINK = 'nl.robwu.contextmenu.crxlink';
    var MENU_ID_PAGE = 'nl.robwu.contextmenu.crxpage';
    var MENU_ID_AMO_APPROVED_LINK = 'nl.robwu.contextmenu.amoapprovedlink';
    var MENU_ID_AMO_APPROVED_PAGE = 'nl.robwu.contextmenu.amoapprovedpage';
//#if FIREFOX
    var MENU_ID_PAGE_ACTION = 'nl.robwu.contextmenu.pageaction';
//#endif
    var MENU_ID_ACTION_MENU = 'nl.robwu.contextmenu.actionmenu.';
    var MENU_ID_ACTION_MENU_POPUP = MENU_ID_ACTION_MENU + 'popup';
    var MENU_ID_ACTION_MENU_VIEW_SOURCE = MENU_ID_ACTION_MENU + 'view-source';
    var MENU_ID_ACTION_MENU_DOWNLOAD = MENU_ID_ACTION_MENU + 'download';

    var DEFAULT_LINK_TARGET_URL_PATTERNS = [
        '*://*/*.crx*',
        '*://*/*.CRX*',
        '*://*/*.NEX*',
        '*://*/*.nex*',
        '*://*/*.XPI*',
        '*://*/*.xpi*',
        cws_match_pattern,
        mea_match_pattern,
        ows_match_pattern,
    ].concat(amo_file_version_match_patterns);

    chrome.storage.onChanged.addListener(function(changes) {
        if (changes.actionClickAction) {
            setActionClickAction(changes.actionClickAction.newValue);
            return;
        }
        if (changes.showContextMenu) {
            if (changes.showContextMenu.newValue) {
                show();
                chrome.storage.sync.get('contextmenuPatterns', function(items) {
                    updateLinkMenu(items.contextmenuPatterns, true);
                });
            } else {
                hide();
            }
            return;
        }
        if (changes.contextmenuPatterns) {
            // The options page only allows 'contextmenuPatterns' to be edited
            // if 'showContextMenu' is true, so assume that the menu is shown,
            // so we can just edit the menu item.
            updateLinkMenu(changes.contextmenuPatterns.newValue, false);
        }
    });
//#if !FIREFOX
    chrome.runtime.onInstalled.addListener(checkContextMenuPref);
    chrome.runtime.onStartup.addListener(checkContextMenuPref);
//#else
    chrome.contextMenus.removeAll(function() {
        checkContextMenuPref();
    });
//#endif
    function checkContextMenuPref() {
        var storageArea = chrome.storage.sync;
        storageArea.get({
            showContextMenu: true,
            actionClickAction: 'popup',
            contextmenuPatterns: [],
        }, function(items) {
            if (items.showContextMenu) {
                show();
                updateLinkMenu(items.contextmenuPatterns, false);
            }
            setActionClickAction(items.actionClickAction);
        });
//#if FIREFOX
        chrome.contextMenus.create({
            id: MENU_ID_PAGE_ACTION,
            title: 'Hide this button',
            contexts: ['page_action'],
        });
//#endif
        chrome.contextMenus.create({
            id: MENU_ID_ACTION_MENU,
            title: 'Primary action on click',
            contexts: ['page_action'],
        });
        chrome.contextMenus.create({
            id: MENU_ID_ACTION_MENU_POPUP,
            parentId: MENU_ID_ACTION_MENU,
            title: 'Show popup (default)',
            type: 'radio',
            checked: true,
            contexts: ['page_action'],
        });
        // Note: Keep the same order as in popup.html for consistency.
        chrome.contextMenus.create({
            id: MENU_ID_ACTION_MENU_DOWNLOAD,
            parentId: MENU_ID_ACTION_MENU,
            title: 'Download as zip',
            type: 'radio',
            contexts: ['page_action'],
        });
        chrome.contextMenus.create({
            id: MENU_ID_ACTION_MENU_VIEW_SOURCE,
            parentId: MENU_ID_ACTION_MENU,
            title: 'View source',
            type: 'radio',
            contexts: ['page_action'],
        });
    }

    function setActionClickAction(actionClickAction) {
        if (!actionClickAction) return;
        chrome.contextMenus.update(MENU_ID_ACTION_MENU + actionClickAction, {
            checked: true,
        });
    }
    
    function contextMenusOnClicked(info, tab) {
//#if FIREFOX
        if (info.menuItemId === MENU_ID_PAGE_ACTION) {
            // background.js will now pick up the storage change
            // and disable page actions.
            chrome.storage.sync.set({showPageAction: false});
            return;
        }
//#endif
        if (info.menuItemId.startsWith(MENU_ID_ACTION_MENU)) {
            var choice = info.menuItemId.slice(MENU_ID_ACTION_MENU.length);
            chrome.storage.sync.set({actionClickAction: choice});
            return;
        }
        var url = info.menuItemId == MENU_ID_PAGE ||
           info.menuItemId == MENU_ID_AMO_APPROVED_PAGE ? info.pageUrl : info.linkUrl;
        url = get_crx_url(url);
        var params = encodeQueryString({crx: url});

        chrome.tabs.create({
            url: chrome.extension.getURL('crxviewer.html') + '?' + params,
            active: true,
            index: tab ? tab.index + 1 : undefined,
        });
    }
    chrome.contextMenus.onClicked.addListener(contextMenusOnClicked);

    function updateLinkMenu(contextmenuPatterns, forceUpdate) {
        if (!contextmenuPatterns ||
            !contextmenuPatterns.length && !forceUpdate) {
            return;
        }
        // An error may be printed to the console if the pattern is malformed,
        // or the menu item does not exist (any more).
        chrome.contextMenus.update(MENU_ID_LINK, {
            targetUrlPatterns: DEFAULT_LINK_TARGET_URL_PATTERNS.concat(contextmenuPatterns),
        });
    }
    function show() {
        chrome.contextMenus.create({
            id: MENU_ID_LINK,
            title: 'View linked extension source',
            contexts: ['link'],
            targetUrlPatterns: DEFAULT_LINK_TARGET_URL_PATTERNS,
        });
        // AMO lists multiple versions, specifically state that this
        // is the latest approved version to avoid ambiguity.
        chrome.contextMenus.create({
            id: MENU_ID_AMO_APPROVED_LINK,
            title: 'View linked extension source (latest approved version)',
            contexts: ['link'],
            targetUrlPatterns: amo_match_patterns,
        });
        chrome.contextMenus.create({
            id: MENU_ID_PAGE,
            title: 'View extension source',
            contexts: ['all'],
            documentUrlPatterns: [
                cws_match_pattern,
                mea_match_pattern,
                ows_match_pattern,
            ].concat(amo_file_version_match_patterns),
        });
        // AMO lists multiple versions, specifically state that this
        // is the latest approved version to avoid ambiguity.
        chrome.contextMenus.create({
            id: MENU_ID_AMO_APPROVED_PAGE,
            title: 'View extension source (latest approved version)',
            contexts: ['page', 'frame', 'link'],
            documentUrlPatterns: amo_match_patterns,
        });
    }
    function hide() {
        function darkhole() {
            // jshint -W030
            chrome.runtime.lastError;  // Suppress any errors.
            // jshint +W030
        }
        chrome.contextMenus.remove(MENU_ID_LINK, darkhole);
        chrome.contextMenus.remove(MENU_ID_PAGE, darkhole);
        chrome.contextMenus.remove(MENU_ID_AMO_APPROVED_LINK, darkhole);
        chrome.contextMenus.remove(MENU_ID_AMO_APPROVED_PAGE, darkhole);
    }
})();
