/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: reduced to Firefox only (removed Chrome, Opera and web-demo code,
 * and Chrome Web Store, Edge and Opera add-on sites). */

/* jshint esversion:6 */
/* globals navigator */
/* globals chrome, amo_match_patterns, atn_match_patterns, amo_pattern, atn_pattern */

'use strict';

chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg && msg.action === "downloadBlob") {
        chrome.downloads.download({
            url: URL.createObjectURL(msg.blob),
            filename: msg.filename,
            incognito: msg.incognito,
        });
    }
});

/**
 * Logic to toggle visibility of pageAction if needed.
 *
 * By default, the extension wants to show a pageAction button on the (few)
 * websites that it recognizes as an extension store. The user can opt out of
 * this behavior, which is stored in storage.sync at the "showPageAction" key.
 *
 * Firefox used to have a menu option to toggle the visibility of the pageAction
 * but that was removed in Firefox 89, see bugzil.la/1712556
 * and https://github.com/Rob--W/crxviewer/issues/41
 *
 * Implementation details:
 * - Register tabs.onUpdated at the top level, to detect relevant URLs.
 *   - In tabs.onUpdated, calls pageAction.show/pageAction.hide as needed.
 * - Retrieve user preference from storage.sync.get. If the preference is to
 *   show the pageAction, unregister the listener (and let it be handled fully
 *   by tabs.onUpdated).
 * - Register storage.onChanged to detect changes to the pref, to (un)register
 *   the tabs.onUpdated as needed, and show/hide existing pageAction buttons.
 */
function tabsOnUpdatedCheckPageAction(tabId, changeInfo, tab) {
    showPageActionIfNeeded(tab);
}
var pageActionIsEnabled = true; // Default-enabled by page_action.show_matches.
// We immediately respond to tabs.onUpdated events to minimize the chance of
// tab.url getting out of sync. This event may trigger before we read the
// user's preference through storage.sync. Once we got the user's preference,
// we fix up any touched tabs and void this set.
var tabIdsBeforePageActionPrefRead = new Set();
var hasLostPersistentListener = false;

// Same patterns as page_action.show_matches in manifest.json:
var page_action_show_matches_patterns = [
    ...amo_match_patterns,
    ...atn_match_patterns,
];
function registerTabsOnUpdatedForPageAction() {
    // Note: must be called from the top-level to make sure that the listener
    // persists after event page suspension and browser restarts.
    // When called after startup, the listener will not trigger after the event
    // has suspended (bugzil.la/1869125).

    if (chrome.tabs.onUpdated.hasListener(tabsOnUpdatedCheckPageAction)) {
        // Already a no-op in Firefox, but check just in case it ever changes
        // in the future.
        return;
    }
    try {
        chrome.tabs.onUpdated.addListener(tabsOnUpdatedCheckPageAction, {
            properties: ['url'],
            urls: page_action_show_matches_patterns,
        });
    } catch (e) {
        // filter not supported on Firefox for Android (bugzil.la/1713819).
        // filter is only supported in Firefox 61+ (bugzil.la/1329507).
        // "url" in properties requires Firefox 88+ (bugzil.la/1680279).
        chrome.tabs.onUpdated.addListener(tabsOnUpdatedCheckPageAction);
    }
    if (hasLostPersistentListener) {
        chrome.runtime.onSuspend.addListener(wakeupSoonAfterSuspend);
    }
}
function unregisterTabsOnUpdatedForPageAction() {
    // Note: once removed, the listener cannot participate in waking up the
    // event page after it has suspended (bugzil.la/1869125).
    chrome.tabs.onUpdated.removeListener(tabsOnUpdatedCheckPageAction);

    if (/Firefox\/1(1\d|2[0-7])\./.test(navigator.userAgent)) {
        // bugzil.la/1869125 was fixed in Firefox 128.
        return;
    }

    hasLostPersistentListener = true;
    chrome.runtime.onSuspend.removeListener(wakeupSoonAfterSuspend);
}

function wakeupSoonAfterSuspend() {
    // Schedule wakeup of event page (via alarms.onAlarm) to make sure that the
    // tabs.onUpdated listener persists, because we can only persist listeners
    // at the start of the event page (bugzil.la/1869125).
    chrome.alarms.create("wakeupSoonAfterSuspend", {
        delayInMinutes: 0.05, // 3 seconds.
    });
}

function togglePageAction(isEnabled) {
    pageActionIsEnabled = isEnabled;
    // Now that pageActionIsEnabled has been set to a value from a pref, we can
    // stop keeping track of new tabIds observed in tabs.onUpdated.
    // Later below, we will either fix up this small set of tabIds, or query
    // all tabs and fix up as needed.
    const tabIdsToFixup = tabIdsBeforePageActionPrefRead;
    tabIdsBeforePageActionPrefRead = null;

    // page_action.show_matches is supported. We only need the listener to
    // hide the button. The button is shown by default.
    if (isEnabled) {
        // The button is shown by default via page_action.show_matches.
        unregisterTabsOnUpdatedForPageAction();
    } else {
        // Need listener to hide (revert effect of page_action.show_matches).
        // Expected common case.
        registerTabsOnUpdatedForPageAction();
    }

    // Now determine whether there is a chance for existing tabs to have an
    // out-of-sync pageAction state, and update their visibility if needed.
    chrome.storage.session.get({ showPageAction: true }, function(items) {
        if (items.showPageAction === pageActionIsEnabled) {
            // Effectively not changed - common case. Bail out.
            // Fix the few tabs that may have used the hard-coded default
            // before the first call to showPageActionIfNeeded.
            if (tabIdsToFixup) {
                Array.from(tabIdsToFixup).forEach(fixupPageActionForTabId);
            }
            return;
        }
        chrome.storage.session.set({ showPageAction: pageActionIsEnabled });
        togglePageActionAcrossAllMatchingTabs();
    });
}
function fixupPageActionForTabId(tabId) {
    chrome.tabs.get(tabId, function(tab) {
        // Silence any errors, e.g. when the tab was closed in the meantime.
        void chrome.runtime.lastError;
        if (tab) {
            showPageActionIfNeeded(tab);
        }
    });
}
function togglePageActionAcrossAllMatchingTabs() {
    chrome.tabs.query({
        url: page_action_show_matches_patterns,
    }, function(tabs) {
        tabs.forEach(showPageActionIfNeeded);
    });
}

// In event pages, listeners need to be registered at the top level.
registerTabsOnUpdatedForPageAction();
chrome.storage.onChanged.addListener(function(changes, areaName) {
    if (areaName === 'session') {
        // Ignore changes to storage.session.
        return;
    }
    if (changes.showPageAction) {
        togglePageAction(changes.showPageAction.newValue);
    }
});
chrome.runtime.onStartup.addListener(function() {
    // We do need the runtime.onStartup event to make sure that the event page
    // starts when the browser starts for the first time. This ensures that if
    // showPageAction is set to a non-default (false), that the pageActions are
    // hidden for existing tabs, and that tabs.onUpdated is registered.
    //
    // This is especially needed if the setting was toggled before the event
    // page restarted for another reason, because the tabs.onUpdated listener
    // can only persist when registered at the top-level without the listener
    // getting removed (which happens when showPageAction=true).
    // See comments at registerTabsOnUpdatedForPageAction and
    // unregisterTabsOnUpdatedForPageAction.
});
chrome.alarms.onAlarm.addListener(function(alarm) {
    // See wakeupSoonAfterSuspend(). The main purpose of the scheduled alarm is
    // to wake up the event page to give tabs.onUpdated a chance to register
    // and be persisted. The alarm itself is not of any other interest.

    // Note: If the browser shuts down before alarms.onAlarm has had a chance
    // of triggering, then we will rely on runtime.onStartup to trigger the
    // wakeup of the event page on startup.
});
chrome.storage.sync.get({
    showPageAction: true,
}, function(items) {
    togglePageAction(items.showPageAction);
});

function showPageActionIfNeeded(tab) {
    var tabId = tab.id;
    var url = tab.url;
    if (tabIdsBeforePageActionPrefRead) {
        tabIdsBeforePageActionPrefRead.add(tabId);
    }
    // Note: .hide()/.show() calls are cached until a top navigation in the tab.
    // In theory, a race condition can happen where tab.url has changed...
    // that's why we want to rely on page_action.show_matches when possible.
    if (isPageActionNeededForUrl(url) && pageActionIsEnabled) {
        chrome.pageAction.show(tabId);
    } else {
        chrome.pageAction.hide(tabId);
    }
}
function isPageActionNeededForUrl(url) {
    return amo_pattern.test(url) || atn_pattern.test(url);
}
