/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */
/* globals chrome */

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    // The CWS is a single page application (SAP). Checking changeInfo.url is not
    // sufficient to see if the tab is part of the CWS. tab.url has to be checked
    // every time
    if (cws_pattern.test(tab.url))
        chrome.pageAction.show(tabId);
    else
        chrome.pageAction.hide(tabId);
});
chrome.tabs.query({
    url: cws_match_pattern
}, function(tabs) {
    for (var i=0; i<tabs.length; ++i) {
        if (cws_pattern.test(tabs[i].url)) {
            chrome.pageAction.show(tabs[i].id);
        }
    }
});
