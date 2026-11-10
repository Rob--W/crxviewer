/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: reduced to Firefox only (removed Chrome, Opera and web-demo code,
 * and Chrome/Edge/Opera CRX links and add-on sites). */

/* jshint browser:true, devel:true, esversion:6 */
/* globals chrome, amo_match_patterns, atn_match_patterns, get_addon_download_url */
/* globals encodeQueryString */

'use strict';
(function() {
    var MENU_ID_LINK = 'nl.robwu.contextmenu.addonlink';
    var MENU_ID_AMO_APPROVED_LINK = 'nl.robwu.contextmenu.amoapprovedlink';
    var MENU_ID_AMO_APPROVED_PAGE = 'nl.robwu.contextmenu.amoapprovedpage';
    var MENU_ID_PAGE_ACTION = 'nl.robwu.contextmenu.pageaction';
    var MENU_ID_ACTION_MENU = 'nl.robwu.contextmenu.actionmenu.';
    var MENU_ID_ACTION_MENU_POPUP = MENU_ID_ACTION_MENU + 'popup';
    var MENU_ID_ACTION_MENU_VIEW_SOURCE = MENU_ID_ACTION_MENU + 'view-source';
    var MENU_ID_ACTION_MENU_DOWNLOAD = MENU_ID_ACTION_MENU + 'download';

    var DEFAULT_LINK_TARGET_URL_PATTERNS = [
        '*://*/*.XPI*',
        '*://*/*.xpi*',
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
            updateLinkMenu(changes.contextmenuPatterns.newValue, true);
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
    // - In Firefox 127 and earlier, menu items disappear upon disabling
    //   (bugzil.la/1771328 - fixed in Firefox 128). This bug coupled with the
    //   above lack of onInstalled, the menus are gone - bugzil.la/1817287
    // As a work-around, register the menus unconditionally (once on startup).
    // To avoid too many contextMenus.create() calls, we only reset the menus
    // if it has not been registered before. We do so by using a dummy menu
    // item that never appears anywhere.
    var MENU_ID_DUMMY_NEVER_SHOWN = 'MENU_ID_DUMMY_NEVER_SHOWN';
    function isMenuRegistrationCompleted(callback) {
        // A relatively inexpensive check to see if the menu items have been
        // registered. Should certainly be less expensive than repeatedly
        // calling contextMenus.create unconditionally.
        // In Chrome and Firefox 136+: contextMenus.update() raises an error if
        // the menu item already exists.
        // Use a different detection method for Firefox 135- because the method
        // described above did not work until Firefox 136 (bugzil.la/1688743).
        if (/Firefox\/1([12]\d|3[0-5])\./.test(navigator.userAgent)) {
            // Until Firefox 136 (bugzil.la/1688743), contextMenus.update()
            // returned early if a non-existing menu item was specified.
            // If a menu item exists, the validity of parentId was checked.
            // parentId is invalid when it points to itself.
            chrome.contextMenus.update(MENU_ID_DUMMY_NEVER_SHOWN, {
                parentId: MENU_ID_DUMMY_NEVER_SHOWN,
            }, function() {
                // No error = menu does not exist, so it was not persisted yet.
                var hasPersistedMenu = !!chrome.runtime.lastError;
                callback(hasPersistedMenu);
            });
            return;
        }
        chrome.contextMenus.update(MENU_ID_DUMMY_NEVER_SHOWN, {}, function() {
            // Error = menu does not exist, so it was not persisted before.
            var hasPersistedMenu = !chrome.runtime.lastError;
            callback(hasPersistedMenu);
        });
    }
    function markMenuRegistrationCompleted() {
        // Create an invisible menu item. This persists across browser
        // restarts, but is cleared on extension updates.
        // Chrome: also cleared when the incognito session ends.
        // Firefox: cleared if extension is disabled and re-enabled.
        chrome.contextMenus.create({
            id: MENU_ID_DUMMY_NEVER_SHOWN,
            title: 'dummy',
            visible: false,
            contexts: ['audio'], // <-- Chosen for rarity.
            targetUrlPatterns: ['https://0.0.0.0/'], // Unresolvable URL.
        });
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
        chrome.contextMenus.create({
            id: MENU_ID_PAGE_ACTION,
            title: 'Hide this button',
            contexts: ['page_action'],
        });
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
        if (info.menuItemId === MENU_ID_PAGE_ACTION) {
            // background.js will now pick up the storage change
            // and disable page actions.
            chrome.storage.sync.set({showPageAction: false});
            return;
        }
        if (info.menuItemId.startsWith(MENU_ID_ACTION_MENU)) {
            var choice = info.menuItemId.slice(MENU_ID_ACTION_MENU.length);
            chrome.storage.sync.set({actionClickAction: choice});
            return;
        }
        var url = info.menuItemId == MENU_ID_AMO_APPROVED_PAGE ? info.pageUrl : info.linkUrl;
        openViewerRelatedToTab(get_addon_download_url(url), tab);
    }
    function openViewerRelatedToTab(url, tab) {
        var params = encodeQueryString({url: url});

        chrome.tabs.create({
            url: chrome.runtime.getURL('viewer.html') + '?' + params,
            active: true,
            windowId: tab ? tab.windowId : undefined,
            index: tab ? tab.index + 1 : undefined,
            cookieStoreId: tab ? tab.cookieStoreId : undefined,
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
        chrome.contextMenus.remove(MENU_ID_AMO_APPROVED_LINK, darkhole);
        chrome.contextMenus.remove(MENU_ID_AMO_APPROVED_PAGE, darkhole);
    }
})();
