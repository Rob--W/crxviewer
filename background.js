/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */
/* globals chrome, cws_match_pattern, cws_pattern */

'use strict';

if (chrome.declarativeWebRequest) {
    chrome.runtime.onInstalled.addListener(setupDeclarativeWebRequest);
}
setupTabsOnUpdated();
chrome.tabs.query({
    url: cws_match_pattern
}, function(tabs) {
    for (var i=0; i<tabs.length; ++i) {
        if (cws_pattern.test(tabs[i].url)) {
            chrome.pageAction.show(tabs[i].id);
        }
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
function setupTabsOnUpdated() {
    chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
        // The CWS is a single page application (SAP). Checking changeInfo.url is not
        // sufficient to see if the tab is part of the CWS. tab.url has to be checked
        // every time
        if (cws_pattern.test(tab.url))
            chrome.pageAction.show(tabId);
        else
            chrome.pageAction.hide(tabId);
    });
}
