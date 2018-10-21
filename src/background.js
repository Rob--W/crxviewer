/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals chrome, cws_match_pattern, ows_match_pattern, amo_match_patterns,
   amo_file_version_match_patterns,
   cws_pattern, ows_pattern, amo_pattern, amo_file_version_pattern,
   get_crx_url, get_zip_name, console,
   URL, document, alert, localStorage */
/* globals encodeQueryString */
/* exported tryTriggerDownload  */

'use strict';

// See bg-contextmenu for potential values, at MENU_ID_ACTION_MENU.
var gActionClickAction = 'popup';

//#if FIREFOX
/* globals browser */
//// Note: This feature may be unnecessary once bugzil.la/1395387 lands.
function tabsOnUpdatedCheckPageAction(tabId, changeInfo, tab) {
    showPageActionIfNeeded(tab);
}
function togglePageAction(isEnabled) {
    browser.tabs.onUpdated.removeListener(tabsOnUpdatedCheckPageAction);
    if (isEnabled) {
        browser.tabs.onUpdated.addListener(tabsOnUpdatedCheckPageAction);
    }
    browser.tabs.query({
        url: [cws_match_pattern, ows_match_pattern].concat(amo_match_patterns, amo_file_version_match_patterns),
    }).then(function(tabs) {
        if (isEnabled) {
            tabs.forEach(showPageActionIfNeeded);
        } else {
            tabs.forEach(function(tab) {
                browser.pageAction.hide(tab.id);
            });
        }
    });
}
//#endif

chrome.storage.onChanged.addListener(function(changes) {
    function callOnChange(key, callback) {
        var valueInfo = key in changes && changes[key];
        if (valueInfo) callback(valueInfo.newValue);
    }
//#if FIREFOX
    callOnChange('showPageAction', togglePageAction);
//#endif
    callOnChange('actionClickAction', setActionClickAction);
});
chrome.storage.sync.get({
//#if FIREFOX
    showPageAction: true,
//#endif
    actionClickAction: gActionClickAction,
}, function(items) {
//#if FIREFOX
    togglePageAction(items.showPageAction);
//#endif
    setActionClickAction(items.actionClickAction);
});

chrome.pageAction.onClicked.addListener(function(tab) {
    if (gActionClickAction === 'popup') return;
    if (gActionClickAction === 'download') return;
    if (!isPageActionNeededForUrl(tab.url)) {
        console.log('The page action should not have been activated for this tab.');
        chrome.pageAction.hide(tab.id);
        return;
    }
    var crx_url = get_crx_url(tab.url);
    var filename = get_zip_name(crx_url);
    if (!crx_url) {
        console.warn('Cannot find extension URL');
        return;
    }
    if (gActionClickAction === 'view-source') {
        chrome.tabs.create({
            url: chrome.extension.getURL('crxviewer.html') +
            '?' + encodeQueryString({crx: crx_url, zipname: filename}),
            active: true,
            index: tab.index + 1,
        });
        return;
    }
    console.error('Unexpected gActionClickAction: ' + gActionClickAction);
});

function setActionClickAction(actionClickAction) {
    if (actionClickAction && gActionClickAction !== actionClickAction) {
        gActionClickAction = actionClickAction;
        chrome.tabs.query({
            active: true,
        }, function(tabs) {
            tabs.forEach(showPageActionIfNeeded);
        });
    }
}

//#if !FIREFOX
if (chrome.declarativeWebRequest) {
    chrome.runtime.onInstalled.addListener(setupDeclarativeWebRequest);
    chrome.declarativeWebRequest.onMessage.addListener(dwr_onMessage);
}

(function() {
    var webNavigationFilter = {
        url: [{
            hostEquals: 'chrome.google.com'
        }, {
            hostEquals: 'addons.opera.com'
        }, {
            hostEquals: 'addons.mozilla.org'
        }, {
            hostEquals: 'addons.allizom.org'
        }, {
            hostEquals: 'addons-dev.allizom.org'
        }]
    };
    chrome.webNavigation.onCommitted.addListener(showPageActionIfNeeded, webNavigationFilter);
    chrome.webNavigation.onHistoryStateUpdated.addListener(showPageActionIfNeeded, webNavigationFilter);
})();

chrome.runtime.onInstalled.addListener(function() {
    chrome.tabs.query({
        url: [
            cws_match_pattern,
            ows_match_pattern,
        ].concat(amo_match_patterns, amo_file_version_match_patterns),
    }, function(tabs) {
        tabs.forEach(showPageActionIfNeeded);
    });
    // Migrate from old localStorage settings to chrome.storage
    var items = {};
    Object.keys(localStorage).forEach(function(key) {
        if (key.lastIndexOf('filter-', 0) !== 0) {
            return;
        }
        var value = localStorage.getItem(key);
        localStorage.removeItem(key);
        if (value === '1') {
            items[key] = true;
        } else if (value === '0') {
            items[key] = false;
        }
    });
    if (Object.keys(items).length) {
        var storageArea = chrome.storage.sync;
        storageArea.set(items);
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
                    'application/x-navigator-extension',
                    'application/x-xpinstall',
                ]
            }),
            // Octet stream, name ends with..
            new chrome.declarativeWebRequest.RequestMatcher({
                contentType: [
                    'application/octet-stream'
                ],
                url: {
                    urlMatches: '(?i)\\.(crx|nex|xpi)\\b'
                }
            }),
            // Octet stream, with attachment
            cdw_getRequestMatcherForExtensionAsAttachment()
        ],
        actions: [
            new chrome.declarativeWebRequest.SendMessageToExtension({message: 'crx'})
        ]
    };
    var rules = [detectCrx];
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
            '.nex', '.NEX', '.NEX"', ".nex'",
            '.xpi', '.XPI', '.XPI"', ".xpi'"
        ].map(function(contentDispositionHeaderSuffix) {
            return {
                nameEquals: 'Content-disposition',
                valueSuffix: contentDispositionHeaderSuffix
            };
        })
    });
}
function dwr_onMessage(details) {
    if (details.tabId === -1) return;
    showPageAction(details.tabId, details.url);
}
//#endif
function showPageAction(tabId, url) {
    var popup;
    if (gActionClickAction === 'view-source') {
        // Let pageAction.onClicked handle this.
        popup = '';
    } else if (gActionClickAction === 'popup' ||
        gActionClickAction === 'download') {
        var params = {};
        if (url) params.crx = url;
        if (gActionClickAction === 'download') params.doDownload = 1;
        popup = 'popup.html?' + encodeQueryString(params);
    }

    chrome.pageAction.setPopup({
        tabId: tabId,
        popup: popup,
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
    if (isPageActionNeededForUrl(url)) {
        showPageAction(tabId, url);
    } else {
        chrome.pageAction.hide(tabId);
    }
}
function isPageActionNeededForUrl(url) {
    return cws_pattern.test(url) || ows_pattern.test(url) || amo_pattern.test(url) ||
        amo_file_version_pattern.test(url);
}

// Called by popup.js
function tryTriggerDownload(blob, filename) {
//#if FIREFOX
//  // Note: Can't use blob:-URLs with <a download> when out-of-process
//  // WebExtensions are disabled ( bugzil.la/1423168 )
//  // so make sure that you the chrome.downloads API stays enabled.
//#endif
    tryTriggerDownloadUrl(URL.createObjectURL(blob), filename);
}
function tryTriggerDownloadUrl(url, filename) {
    if (!chrome.downloads) {
        // Chrome 31+ and Opera 20+
        tryTriggerDownloadFallback(url, filename);
        return;
    }
    chrome.downloads.download({
        url: url,
        filename: filename
    }, function(downloadId) {
        if (chrome.runtime.lastError) {
            alert('An error occurred while trying to save ' + filename + ':\n\n' +
                chrome.runtime.lastError.message);
        }
    });
}
function tryTriggerDownloadFallback(url, filename) {
    function triggerDownload(url, filename) {
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        (document.body || document.documentElement).appendChild(a);
        a.click();
        a.remove();
    }

    chrome.tabs.executeScript({
        code: '(' + triggerDownload + ')(' +
                  JSON.stringify(url) + ',' + JSON.stringify(filename) + ')'
    }, function(result) {
        if (chrome.runtime.lastError) {
            // NOTE: May fail if used in quick succession:
            triggerDownload(url, filename);
        }
        // else when the event page goes away, the URL will be revoked.
    }); 
}
