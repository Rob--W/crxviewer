/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */

/* globals location */
'use strict';

// cws_pattern[1] = extensionID
var cws_pattern = /^https?:\/\/chrome.google.com\/webstore\/.+?\/([a-z]{32})(?=[\/#?]|$)/;
// match pattern per Chrome spec
var cws_match_pattern = '*://chrome.google.com/webstore/*';

// string extensionID if valid URL
// null otherwise
function get_extensionID(url) {
    var match = cws_pattern.exec(url);
    return match && match[1];
}

// Returns location of CRX file for a given extensionID or CWS url
function get_crx_url(extensionID_or_url) {
    var match = get_extensionID(extensionID_or_url);
    var extensionID = match ? match : extensionID_or_url;

    var url = 'https://clients2.google.com/service/update2/crx?response=redirect&x=id%3D';
    url += extensionID;
    url += '%26uc';
    return url;
}
function getParam(name) { // Assume name contains no RegEx-specific char
    var haystack = location.search || location.hash;
    var pattern = new RegExp('[&?#]' + name + '=([^&]*)');
    var needle = pattern.exec(haystack);
    return needle && decodeURIComponent(needle[1]);
}
