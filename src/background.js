/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* jshint esversion:6 */
/* globals navigator */
/* globals chrome, cws_match_patterns, mea_match_pattern, ows_match_pattern, amo_match_patterns, atn_match_patterns,
   cws_pattern, mea_pattern, ows_pattern, amo_pattern, atn_pattern,
    */

'use strict';

//#if FIREFOX
/**
 * Logic to toggle visibility of  pageAction if needed.
 *
 * By default, the extension wants to show a pageAction button on the (few)
 * websites that it recognizes as an extension store. The user can opt out of
 * this behavior, which is stored in storage.sync at the "showPageAction" key.
 *
 * Bugs relevant to page_action support:
 * Firefox < 59: did not support page_action.show_matches (bugzil.la/1419842).
 * Firefox < 61: did not reset pageAction in inactive tabs (bugzil.la/1439246).
 * Firefox < 89: Firefox 58+ had a menu option to toggle the visibility of the
 *               pageAction, but it was removed in 89. See bugzil.la/1712556
 *               and https://github.com/Rob--W/crxviewer/issues/41
 * Firefox < 106: did not support event pages: background page lived forever.
 * Firefox < 115: did not support storage.session.
 *
 * Implementation details:
 * - Register tabs.onUpdated at the top level, to detect relevant URLs.
 *   - In tabs.onUpdated, calls pageAction.show/pageAction.hide as needed.
 * - Retrieve user preference from storage.sync.get. If the preference is to
 *   show the pageAction, unregister the listener (and let it be handled fully
 *   by tabs.onUpdated).
 * - Register storage.onChanged to detect changes to the pref, to (un)register
 *   the tabs.onUpdated as needed, and show/hide existing pageAction buttons.
 *
 * To strike a balance between maintainability, performance and customizability,
 * ...
 */
function tabsOnUpdatedCheckPageAction(tabId, changeInfo, tab) {
    showPageActionIfNeeded(tab);
}
//// In Firefox >= 59, we rely on page_action.show_matches.
var hasStaticPageActionPatterns = !/Firefox\/5[0-8]\./.test(navigator.userAgent);
var pageActionIsEnabled = hasStaticPageActionPatterns;
//// We immediately respond to tabs.onUpdated events to minimize the chance of
//// tab.url getting out of sync. This event may trigger before we read the
//// user's preference through storage.sync. Once we got the user's preference,
//// we fix up any touched tabs and void this set.
var tabIdsBeforePageActionPrefRead = new Set();
var hasLostPersistentListener = false;

//// Same patterns as in manifest_firefox.json:
var page_action_show_matches_patterns = [
    ...cws_match_patterns,
    mea_match_pattern,
    ows_match_pattern,
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

    // Technically the logic below is not needed in Firefox < 106 because the
    // logic is only needed for event pages. But we don't bother with checking
    // versions and returning early, because in the worst case the only result
    // is scheduling one no-op alarm.
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
    var didChange = pageActionIsEnabled !== isEnabled;
    pageActionIsEnabled = isEnabled;
    // Now that pageActionIsEnabled has been set to a value from a pref, we can
    // stop keeping track of new tabIds observed in tabs.onUpdated.
    // Later below, we will either fix up this small set of tabIds, or query
    // all tabs and fix up as needed.
    const tabIdsToFixup = tabIdsBeforePageActionPrefRead;
    tabIdsBeforePageActionPrefRead = null;

    if (!hasStaticPageActionPatterns) {
        // page_action.show_matches not supported, we always need the listener
        // if enabled. The button is hidden by default.
        if (isEnabled) {
            registerTabsOnUpdatedForPageAction();
        } else {
            unregisterTabsOnUpdatedForPageAction();
        }
    } else {
        // page_action.show_matches is supported. We only need the listener to
        // hide the button. The button is shown by default.
        if (isEnabled) {
            unregisterTabsOnUpdatedForPageAction();
        } else {
            // Expected common case.
            registerTabsOnUpdatedForPageAction();
        }
    }

    // Now determine whether there is a chance for existing tabs to have an
    // out-of-sync pageAction state, and update their visibility if needed.
    if (chrome.storage.session) {
        // Note: hasStaticPageActionPatterns is also true here.
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
    } else if (didChange) {
        // Uncommon case: when the user has set showPageAction to false.
        // Before event page support (Firefox <= 105), the background page lives
        // forever, so this logic executes only once, as desired.
        // But with event page support and no storage.session support, this
        // logic may run more often than ideal: whenever the event page awakes
        // (Firefox versions: 106 <= Firefox version <= 114).
        // (in Firefox 115+, storage.session is suppported, we never get here).
        //
        // This is because didChange relies on a global (pageActionIsEnabled),
        // which defaults to a static boolean (hasStaticPageActionPatterns),
        // independent of user preferences. The user preference is retrieved
        // asynchronously.
        togglePageActionAcrossAllMatchingTabs();
    }
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

//// In event pages, listeners need to be registered at the top level.
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

    if (pageActionIsEnabled === hasStaticPageActionPatterns) {
        // Preference matches the default, nothing to fix up.
        return;
    }
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
    return cws_pattern.test(url) || mea_pattern.test(url) || ows_pattern.test(url) ||
        amo_pattern.test(url) || atn_pattern.test(url);
}
//#else
//// Work-around for crbug.com/1132684: static event_rules disappear after a
//// restart, so we register rules dynamically instead, on install.
function registerEventRules() {
    if (registerEventRules.hasRunOnce) {
        return;
    }
    registerEventRules.hasRunOnce = true;

    var pageUrlFilters = [{
        hostEquals: "chrome.google.com",
        pathPrefix: "/webstore/detail/"
    }, {
        hostEquals: "chromewebstore.google.com",
        pathPrefix: "/detail/"
    }, {
        hostEquals: "microsoftedge.microsoft.com",
        pathPrefix: "/addons/detail/"
    }, {
        hostEquals: "addons.opera.com",
        pathContains: "extensions/details/"
    }, {
        hostEquals: "addons.mozilla.org",
        pathContains: "addon/"
    }, {
        hostSuffix: "addons.mozilla.org",
        pathContains: "review/"
    }, {
        hostEquals: "addons.allizom.org",
        pathContains: "addon/"
    }, {
        hostSuffix: "addons.allizom.org",
        pathContains: "review/"
    }, {
        hostEquals: "addons-dev.allizom.org",
        pathContains: "addon/"
    }, {
        hostSuffix: "addons-dev.allizom.org",
        pathContains: "review/"
    }, {
        hostEquals: "addons.thunderbird.net",
        pathContains: "addon/"
    }, {
        hostSuffix: "addons-stage.thunderbird.net",
        pathContains: "addon/"
    }];

    if (!chrome.declarativeContent.ShowAction) {
        // Chrome < 97.
        chrome.declarativeContent.ShowAction = chrome.declarativeContent.ShowPageAction;
    }

    var rule = {
        conditions: pageUrlFilters.map(function(pageUrlFilter) {
            return new chrome.declarativeContent.PageStateMatcher({
                pageUrl: pageUrlFilter,
            });
        }),
        actions: [
            new chrome.declarativeContent.ShowAction(),
        ],
    };

    chrome.declarativeContent.onPageChanged.removeRules(undefined, function() {
        chrome.declarativeContent.onPageChanged.addRules([rule], function() {
            // Visibility of action fully controlled by declarativeContent.
            chrome.action.disable();
        });
    });
}
//// The documentation recommends to use runtime.onInstalled to register
//// declarativeContent rules. Due to bugs, additional work-arounds are needed
//// to ensure that the declarativeContent rules are registered correctly.
chrome.runtime.onInstalled.addListener(registerEventRules);
//// Work-around for crbug.com/388231: onInstalled is not fired when the
//// extension was disabled during an update.
chrome.runtime.onStartup.addListener(registerEventRules);
//// Work-around for crbug.com/264963: onInstalled is not fired when the
//// extension is run in incognito mode. Although not documented, incognito
//// contexts have their own declarativeContent rule store.
if (chrome.extension.inIncognitoContext) {
    chrome.declarativeContent.onPageChanged.getRules(function(rules) {
        if (!rules.length) {
            registerEventRules();
        }
    });
}

//#endif
