/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals navigator */
/* globals chrome, cws_match_pattern, mea_match_pattern, ows_match_pattern, wes_match_pattern, amo_match_patterns, atn_match_patterns,
   cws_pattern, mea_pattern, ows_pattern, amo_pattern, atn_pattern,
    */

'use strict';

//#if FIREFOX
/* globals browser */
function tabsOnUpdatedCheckPageAction(tabId, changeInfo, tab) {
    showPageActionIfNeeded(tab);
}
//// In Firefox >= 59, we rely on page_action.show_matches.
var hasStaticPageActionPatterns = !/Firefox\/5[0-8]\./.test(navigator.userAgent);
var pageActionIsEnabled = hasStaticPageActionPatterns;
var pageActionEverToggled = false;
if (hasStaticPageActionPatterns) {
    // Static actions not enabled yet, enable them now.
    togglePageAction(true);
}
//// Later below, actions may be disabled via prefs.

function togglePageAction(isEnabled) {
    var didChange = pageActionIsEnabled !== isEnabled;
    pageActionEverToggled = pageActionEverToggled || didChange;
    pageActionIsEnabled = isEnabled;

    browser.tabs.onUpdated.removeListener(tabsOnUpdatedCheckPageAction);
    if (!hasStaticPageActionPatterns) {
        // page_action.show_matches not supported, we always need the listener
        // if enabled.
        if (isEnabled) {
            browser.tabs.onUpdated.addListener(tabsOnUpdatedCheckPageAction);
        }
        if (!didChange) {
            return;
        }
    } else {
        // page_action.show_matches is supported. We only need the listener to
        // hide the button. But if the button has ever been hidden before, then
        // we need the listener because .hide()/.show() results are cached, and
        // in that case we cannot rely on page_action.show_matches any more.
        if (pageActionEverToggled) {
            browser.tabs.onUpdated.addListener(tabsOnUpdatedCheckPageAction);
        }
        if (!pageActionEverToggled && isEnabled) {
            // We have never hidden anything, and the button is still enabled.
            // Return now to avoid poisoning the .show()/.hide() cache of all tabs.
            return;
        }
    }
    browser.tabs.query({
        url: [cws_match_pattern, mea_match_pattern, ows_match_pattern, wes_match_pattern].concat(amo_match_patterns, atn_match_patterns),
    }).then(function(tabs) {
        tabs.forEach(showPageActionIfNeeded);
    });
}

chrome.storage.onChanged.addListener(function(changes) {
    function callOnChange(key, callback) {
        var valueInfo = key in changes && changes[key];
        if (valueInfo) callback(valueInfo.newValue);
    }
    callOnChange('showPageAction', togglePageAction);
});
chrome.storage.sync.get({
    showPageAction: true,
}, function(items) {
    togglePageAction(items.showPageAction);
});

function showPageActionIfNeeded(tab) {
    var tabId = tab.id;
    var url = tab.url;
    if (isPageActionNeededForUrl(url) && pageActionIsEnabled) {
        chrome.pageAction.show(tabId);
    } else {
        chrome.pageAction.hide(tabId);
    }
}
function isPageActionNeededForUrl(url) {
    return cws_pattern.test(url) || mea_pattern.test(url) || ows_pattern.test(url) || wes_pattern.test(url) ||
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
    }, {
        hostSuffix: "store.whale.naver.com",
        pathPrefix: "/detail/"
    }];

    var rule = {
        conditions: pageUrlFilters.map(function(pageUrlFilter) {
            return new chrome.declarativeContent.PageStateMatcher({
                pageUrl: pageUrlFilter,
            });
        }),
        actions: [
            new chrome.declarativeContent.ShowPageAction(),
        ],
    };

    chrome.declarativeContent.onPageChanged.removeRules(undefined, function() {
        chrome.declarativeContent.onPageChanged.addRules([rule]);
    });
}
//// Work-around for crbug.com/388231 is in incognito-events.js
chrome.runtime.onInstalled.addListener(registerEventRules);
//// Work-around for crbug.com/264963: onInstalled is not fired when the
//// extension was disabled during an update.
chrome.runtime.onStartup.addListener(registerEventRules);
//#endif
