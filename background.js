/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */
/* globals chrome, cws_match_pattern, ows_match_pattern, cws_pattern, ows_pattern */

'use strict';

if (chrome.declarativeWebRequest) {
    chrome.runtime.onInstalled.addListener(setupDeclarativeWebRequest);
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
    // This method should be an efficient way to only activate the extension when needed,
    // but unfortunately the onCommitted event does not work as intended.
    // See http://crbug.com/257851
    chrome.webNavigation.onCommitted.addListener(showPageActionIfNeeded, webNavigationFilter);
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
    chrome.declarativeWebRequest.onRequest.removeRules([detectCrx.id]);
    chrome.declarativeWebRequest.onRequest.addRules([detectCrx], function() {
        chrome.declarativeWebRequest.onMessage.addListener(dwr_onMessage);
    });
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
function dwr_onMessage(details) {
    chrome.pageAction.setPopup({
        tabId: details.tabId,
        popup: 'popup.html#crx=' + encodeURIComponent(details.url)
    });
    chrome.pageAction.show(details.tabId);
}

function showPageActionIfNeeded(details_or_tab) {
    if (details_or_tab.frameId) {
        // If frameId is set, and it's not zero, then it's a navigation in a frame.
        // We're only interested in main-frame navigations, so... bye!
        return;
    }
    var tabId = details_or_tab.tabId || details_or_tab.id;
    var url = details_or_tab.url;
    // The CWS is a single page application (SAP). Checking changeInfo.url is not
    // sufficient to see if the tab is part of the CWS. tab.url has to be checked
    // every time
    if (cws_pattern.test(url) || ows_pattern.test(url)) {
        var params = url ? '#crx=' + encodeURIComponent(url) : '';
        chrome.pageAction.setPopup({
            tabId: tabId,
            popup: 'popup.html?' + params
        });
        chrome.pageAction.show(tabId);
    } else {
        chrome.pageAction.hide(tabId);
    }
}
