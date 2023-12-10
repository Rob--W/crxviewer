/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* jshint browser:true, devel:true, esversion:6 */
/* globals chrome, cws_match_patterns, mea_match_pattern, ows_match_pattern, amo_match_patterns, atn_match_patterns, get_crx_url */
/* globals encodeQueryString */
/* globals getPlatformInfoAsync */

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
        ...cws_match_patterns,
        mea_match_pattern,
        ows_match_pattern,
    ];

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
    // contextMenus are supposed to be stored once from onInstalled.
    // We cannot only use a top-level onInstalled because it has these issues:
    // - In Chrome, onInstalled does not fire in incognito - crbug.com/264963
    // - In Chrome, in incognito mode the menus are tied to that session and
    //   become unavailable when the last incognito context unloads.
    //   When the incognito window is opened, the extension service worker wakes
    //   up again (MV3). This does not happen with event pages (MV2)...
    // - onInstalled does not fire if updated while disabled -
    //   crbug.com/388231 & bugzil.la/1700797
    // - In Firefox, menu items disappear upon disabling, and coupled with the
    //   above lack of onInstalled, the menus are gone - bugzil.la/1817287
    // - In Firefox 105 and earlier, menus did not persist in event pages.
    // As a work-around, register the menus unconditionally (once on startup).
    // To avoid too many contextMenus.create() calls, we only reset the menus
    // if it has not been registered before. We do so by using a dummy menu
    // item that never appears anywhere.
    var MENU_ID_DUMMY_NEVER_SHOWN = 'MENU_ID_DUMMY_NEVER_SHOWN';
    function isMenuRegistrationCompleted(callback) {
        // A relatively inexpensive check to see if the menu items have been
        // registered. Should certainly be less expensive than repeatedly
        // calling contextMenus.create unconditionally.
        // In Chrome: contextMenus.update fails if the menu item already exists.
//#if FIREFOX
        // In Firefox: contextMenus.update returns early without further
        // validation if the menu item does not exist. If the menu item exists,
        // validation is performed, including verifying that parentId is valid.
        // parentId is invalid when it points to itself.
        chrome.contextMenus.update(MENU_ID_DUMMY_NEVER_SHOWN, {
            parentId: MENU_ID_DUMMY_NEVER_SHOWN,
        }, function() {
            // No error = menu does not exist, so it was not persisted before.
            var hasPersistedMenu = !!chrome.runtime.lastError;
            callback(hasPersistedMenu);
        });
//#else
        chrome.contextMenus.update(MENU_ID_DUMMY_NEVER_SHOWN, {}, function() {
            // Error = menu does not exist, so it was not persisted before.
            var hasPersistedMenu = !chrome.runtime.lastError;
            callback(hasPersistedMenu);
        });
//#endif
    }
    function markMenuRegistrationCompleted() {
        // Create an invisible menu item. This persists across browser
        // restarts, but is cleared on extension updates.
        // Chrome: also cleared when the incognito session ends.
        // Firefox: cleared if extension is disabled and re-enabled.
        var createProps = {
            id: MENU_ID_DUMMY_NEVER_SHOWN,
            title: 'dummy',
            visible: false,
            contexts: ['audio'], // <-- Chosen for rarity.
            targetUrlPatterns: ['https://0.0.0.0/'], // Unresolvable URL.
        };
        try {
            chrome.contextMenus.create(createProps);
        } catch (e) {
            // Firefox 62- doesn't support visible: bugzil.la/1482529
            delete createProps.visible;
            chrome.contextMenus.create(createProps);
        }
    }

    isMenuRegistrationCompleted(function(hasPersistedMenu) {
        if (hasPersistedMenu) {
            // All menus have already been registered before, do nothing.
            return;
        }
        chrome.contextMenus.removeAll(function() {
            checkContextMenuPref();
        });
    });
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
            markMenuRegistrationCompleted();
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
        getPlatformInfoAsync(function() {
            url = get_crx_url(url);
            openCrxViewerRelatedToTab(url, tab);
        });
    }
    function openCrxViewerRelatedToTab(url, tab) {
        var params = encodeQueryString({crx: url});

        chrome.tabs.create({
            url: chrome.runtime.getURL('crxviewer.html') + '?' + params,
            active: true,
            index: tab ? tab.index + 1 : undefined,
//#if FIREFOX
            cookieStoreId: tab ? tab.cookieStoreId : undefined,
//#endif
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
            targetUrlPatterns: amo_match_patterns.concat(atn_match_patterns),
        });
        chrome.contextMenus.create({
            id: MENU_ID_PAGE,
            title: 'View extension source',
            contexts: ['all'],
            documentUrlPatterns: [
                ...cws_match_patterns,
                mea_match_pattern,
                ows_match_pattern,
            ],
        });
        // AMO lists multiple versions, specifically state that this
        // is the latest approved version to avoid ambiguity.
        chrome.contextMenus.create({
            id: MENU_ID_AMO_APPROVED_PAGE,
            title: 'View extension source (latest approved version)',
            contexts: ['page', 'frame', 'link'],
            documentUrlPatterns: amo_match_patterns.concat(atn_match_patterns),
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
