/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */
/* globals chrome, cws_match_pattern, ows_match_pattern, cws_pattern, ows_pattern */

'use strict';

if (chrome.declarativeWebRequest) {
    chrome.runtime.onInstalled.addListener(setupDeclarativeWebRequest);
    chrome.declarativeWebRequest.onMessage.addListener(dwr_onMessage);
}

// Detect navigations to/from Chrome/Opera extension gallery, and show icon if needed.
(function() {
    var webNavigationFilter = {
        urls: [{
            hostEquals: 'chrome.google.com'
        }, {
            hostEquals: 'addons.opera.com'
        }]
    };
    if (!chrome.declarativeWebRequest) {
        // This method should be an efficient way to only activate the extension when needed,
        // but unfortunately the onCommitted event does not work as intended.
        // See http://crbug.com/257851
        // Thus it's disabled when the declarativeWebRequest is available.
        // pushState-based navigation within the Chrome Web Store is handled by the
        //  onHistoryStateUpdated event, navigation within Opera's addon gallery is handled by
        //  the declarativeWebRequest API.
        chrome.webNavigation.onCommitted.addListener(showPageActionIfNeeded, webNavigationFilter);
    }
    chrome.webNavigation.onHistoryStateUpdated.addListener(showPageActionIfNeeded, webNavigationFilter);
})();

chrome.runtime.onInstalled.addListener(function() {
    chrome.tabs.query({url: cws_match_pattern}, queryCallback);
    chrome.tabs.query({url: ows_match_pattern}, queryCallback);
    function queryCallback(tabs) {
        tabs.forEach(showPageActionIfNeeded);
    }
});

function setupDeclarativeWebRequest() {
    // Note: Requires host permissions for the given host before a message is sent.
    var detectCrx = {
        id: 'nl.robwu.crxviewer',
        conditions: [
            // Correct mime type
            new chrome.declarativeWebRequest.RequestMatcher({
                contentType: [
                    'application/x-chrome-extension',
                    'application/x-navigator-extension'
                ]
            }),
            // Octet stream, name ends with..
            new chrome.declarativeWebRequest.RequestMatcher({
                contentType: [
                    'application/octet-stream'
                ],
                url: {
                    urlMatches: '(?i)\\.(crx|nex)\\b'
                }
            }),
            // Octet stream, with attachment
            cdw_getRequestMatcherForExtensionAsAttachment()
        ],
        actions: [
            new chrome.declarativeWebRequest.SendMessageToExtension({message: 'crx'})
        ]
    };
    var detectOperaAddonGallery = {
        id: 'nl.robwu.crxviewer.operagallery',
        conditions: [
            new chrome.declarativeWebRequest.RequestMatcher({
                resourceType: ['main_frame'],
                url: {
                    hostEquals: 'addons.opera.com',
                    pathContains: 'extensions/'
                },
                stages: [
                    'onHeadersReceived'
                ]
            })
        ],
        actions: [
            new chrome.declarativeWebRequest.SendMessageToExtension({message: 'opera'})
        ]
    };
    var rules = [detectCrx, detectOperaAddonGallery];
    var rule_ids = rules.map(function(rule) { return rule.id; });
    chrome.declarativeWebRequest.onRequest.removeRules(rule_ids);
    chrome.declarativeWebRequest.onRequest.addRules(rules);
}
function cdw_getRequestMatcherForExtensionAsAttachment() {
    return new chrome.declarativeWebRequest.RequestMatcher({
        contentType: [
            'application/octet-stream'
        ],
        responseHeaders: [
            '.crx', '.CRX', '.crx"', ".crx'",
            '.nex', '.NEX', '.NEX"', ".nex'"
        ].map(function(contentDispositionHeaderSuffix) {
            return {
                nameEquals: 'Content-disposition',
                valueSuffix: contentDispositionHeaderSuffix
            };
        })
    });
}
function dwr_checkPageAction(details) {
    var onUpdated = function(tabId, changeInfo, tab) {
        if (details.tabId == tabId && details.url == tab.url) {
            removeListeners(tabId);
            showPageAction(tabId, tab.url);
        }
    };
    var removeListeners = function(tabId) {
        if (details.tabId == tabId) {
            chrome.tabs.onUpdated.removeListener(onUpdated);
            chrome.tabs.onRemoved.removeListener(removeListeners);
        }
    };
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(removeListeners);
}
function dwr_onMessage(details) {
    if (details.message == 'opera') {
        dwr_checkPageAction(details);
        return;
    }
    showPageAction(details.tabId, details.url);
}
function showPageAction(tabId, url) {
    var params = url ? '#crx=' + encodeURIComponent(url) : '';
    chrome.pageAction.setPopup({
        tabId: tabId,
        popup: 'popup.html?' + params
    });
    chrome.pageAction.show(tabId);
}

function showPageActionIfNeeded(details_or_tab) {
    if (details_or_tab.frameId) {
        // If frameId is set, and it's not zero, then it's a navigation in a frame.
        // We're only interested in main-frame navigations, so... bye!
        return;
    }
    var tabId = details_or_tab.tabId || details_or_tab.id;
    var url = details_or_tab.url;
    if (cws_pattern.test(url) || ows_pattern.test(url)) {
        showPageAction(tabId, url);
    } else {
        chrome.pageAction.hide(tabId);
    }
}
