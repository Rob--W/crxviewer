/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals navigator */
/* globals chrome, cws_match_pattern, mea_match_pattern, ows_match_pattern, amo_match_patterns,
   cws_pattern, mea_pattern, ows_pattern, amo_pattern,
    */

'use strict';

//#if FIREFOX
/* globals browser */
function tabsOnUpdatedCheckPageAction(tabId, changeInfo, tab) {
    showPageActionIfNeeded(tab);
}
//// In Firefox >= 59, we rely on page_action.show_matches.
var hasStaticPageActionPatterns = !/Firefox\/5[0-8]\./.test(navigator.userAgent);
if (hasStaticPageActionPatterns) {
    browser.tabs.onUpdated.addListener(tabsOnUpdatedCheckPageAction);
    browser.tabs.query({
        url: [cws_match_pattern, mea_match_pattern, ows_match_pattern].concat(amo_match_patterns),
    }).then(function(tabs) {
        tabs.forEach(showPageActionIfNeeded);
    });
}

function showPageActionIfNeeded(tab) {
    var tabId = tab.id;
    var url = tab.url;
    if (isPageActionNeededForUrl(url)) {
        chrome.pageAction.show(tabId);
    } else {
        chrome.pageAction.hide(tabId);
    }
}
function isPageActionNeededForUrl(url) {
    return cws_pattern.test(url) || mea_pattern.test(url) || ows_pattern.test(url) ||
        amo_pattern.test(url);
}
//#endif
