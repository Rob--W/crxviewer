/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals location, getPlatformInfo, navigator */
/* exported cws_match_patterns, mea_match_pattern, ows_match_pattern, amo_match_patterns, atn_match_patterns */
/* exported cws_pattern, mea_pattern, ows_pattern, amo_pattern, atn_pattern */
/* exported can_viewsource_crx_url */
/* exported get_crx_url, get_webstore_url, get_zip_name, is_not_crx_url, getParam */
/* exported is_crx_download_url, is_webstore_url */
/* exported get_amo_domain, get_amo_slug */
/* exported get_equivalent_download_url */
/* exported encodeQueryString */
'use strict';

// cws_pattern[1] = extensionID
var cws_pattern = /^https?:\/\/(?:chrome.google.com\/webstore|chromewebstore.google.com)\/.+?\/([a-z]{32})(?=[\/#?]|$)/;
var cws_download_pattern = /^https?:\/\/clients2\.google\.com\/service\/update2\/crx\b.*?%3D([a-z]{32})%26uc/;
// match pattern per Chrome spec
var cws_match_patterns = [
    '*://chrome.google.com/webstore/detail/*',
    '*://chromewebstore.google.com/detail/*',
];

// Microsoft Edge Addons Store
var mea_pattern = /^https?:\/\/microsoftedge.microsoft.com\/addons\/.+?\/([a-z]{32})(?=[\/#?]|$)/;
var mea_download_pattern = /^https?:\/\/edge\.microsoft\.com\/extensionwebstorebase\/v1\/crx\b.*?%3D([a-z]{32})%26/;
var mea_match_pattern = '*://microsoftedge.microsoft.com/addons/detail/*';

// Opera add-on gallery
var ows_pattern = /^https?:\/\/addons.opera.com\/.*?extensions\/(?:details|download)\/([^\/?#]+)/i;
// The gallery links to addons.opera.com/extensions/download and redirects to addons-extensions.operacdn.com.
var ows_download_pattern = /^https?:\/\/addons.opera.com\/extensions\/download\/([^\/]+)/;
var ows_match_pattern = '*://addons.opera.com/*extensions/details/*';

// Firefox addon gallery
var amo_pattern = /^https?:\/\/((?:reviewers\.)?(?:addons\.mozilla\.org|addons(?:-dev)?\.allizom\.org))\/.*?(?:addon|review)\/([^/<>"'?#]+)/;
var amo_download_pattern = /^https?:\/\/(addons\.mozilla\.org|addons(?:-dev)?\.allizom\.org)\/[^?#]*\/downloads\/latest\/([^/?#]+)/;
var amo_domain_pattern = /^https?:\/\/(addons\.mozilla\.org|addons(?:-dev)?\.allizom\.org)\//;
var amo_match_patterns = [
    '*://addons.mozilla.org/*addon/*',
    '*://*.addons.mozilla.org/*review/*',
    '*://addons.allizom.org/*addon/*',
    '*://*.addons.allizom.org/*review/*',
    '*://addons-dev.allizom.org/*addon/*',
    '*://*.addons-dev.allizom.org/*review/*',
];
// Depends on: https://bugzilla.mozilla.org/show_bug.cgi?id=1620084
var amo_xpi_cdn_pattern = /^https?:\/\/(?:addons\.cdn\.mozilla\.net|addons-dev-cdn\.allizom\.org)\/user-media\/addons\//;

// Thunderbird
var atn_pattern = /^https?:\/\/((?:addons|addons-stage)\.thunderbird\.net)\/.*?\/addon\/([^/?#]+)/;
var atn_download_pattern = /^https?:\/\/((?:addons|addons-stage)\.thunderbird\.net)\/[^?#]*\/downloads\/latest\/([^/?#]+)/;
var atn_match_patterns = [
    '*://addons.thunderbird.net/*addon/*',
    '*://addons-stage.thunderbird.net/*addon/*',
];

// page_action.show_matches (in manifest_firefox.json) uses:
// cws_match_patterns, mea_match_pattern, ows_match_pattern, amo_match_patterns
//
// declarativeContent (in background.js) uses the same patterns, translated to a UrlFilter.
//
// popup.js uses can_viewsource_crx_url to determine whether the URL can actually be opened,
// which use regexps that may be stricter than the match patterns.

// string extensionID if valid URL
// null otherwise
function get_extensionID(url) {
    var match = cws_pattern.exec(url);
    if (match) return match[1];
    match = cws_download_pattern.exec(url);
    return match && match[1];
}

function get_xpi_url(amoDomain, addonSlug) {
    // "https://addons.mozilla.org/firefox/downloads/latest/<slug>/" is suggested by TheOne:
    // https://discourse.mozilla-community.org/t/is-there-a-direct-download-link-for-the-latest-addon-version-on-amo/4788
    // This did not always work. I figured that some packages are platform-specific, so they need
    // extra juice, so add it in the mix!

    // https://github.com/mozilla/addons-server/blob/a5c045df049227b8a6e6ec0b9c86093aedda3d37/src/olympia/constants/platforms.py
    var platformId;
    var ua = navigator.userAgent;
    if (ua.includes('Mac')) {
        platformId = 3;
    } else if (ua.includes('Win')) {
        platformId = 5;
    } else if (ua.includes('Android')) {
        platformId = 7;
    } else { // Assume Linux.
        platformId = 2;
    }

    var url = 'https://' + amoDomain + '/firefox/downloads/latest/';
    url += addonSlug;
    url += '/platform:' + platformId;
    url += '/';
    // We can put anything here, but it is usually the desired file name for the XPI file.
    url += addonSlug + '.xpi';
    return url;
}

// Returns location of CRX file for a given extensionID or CWS url or Opera add-on URL
// or Firefox addon URL or Microsoft Edge addon URL.
// Unrecognized values are returned as-is.
// If the input is potentially a CWS URL, ensure that getPlatformInfoAsync() has been called before,
// which results in a CRX URL with richer version information.
function get_crx_url(extensionID_or_url) {
    var url;
    var match = ows_pattern.exec(extensionID_or_url);
    if (match) {
        url = 'https://addons.opera.com/extensions/download/';
        url += match[1];
        url += '/';
        return url;
    }
    match = amo_pattern.exec(extensionID_or_url);
    if (match) {
        return get_xpi_url(match[1], match[2]);
    }
    match = atn_pattern.exec(extensionID_or_url);
    if (match) {
        // Although /firefox/ works too, let's prefer /thunderbird/.
        return get_xpi_url(match[1], match[2]).replace('/firefox/', '/thunderbird/');
    }
    match = mea_pattern.exec(extensionID_or_url) || mea_download_pattern.exec(extensionID_or_url);
    if (match) {
        return 'https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=id%3D' + match[1] + '%26installsource%3Dondemand%26uc';
    }
    // Chrome Web Store
    match = get_extensionID(extensionID_or_url);
    var extensionID = match ? match : extensionID_or_url;

    if (!/^[a-z]{32}$/.test(extensionID)) {
        return extensionID_or_url;
    }

    // Note: To avoid the fallback, ensure that getPlatformInfoAsync() has been called before.
    var platformInfo = getPlatformInfo();

    // Omitting this value is allowed, but add it just in case.
    // Source: https://cs.chromium.org/file:update_query_params.cc%20GetProdIdString
    var product_id = isChromeNotChromium() ? 'chromecrx' : 'chromiumcrx';
    // Channel is "unknown" on Chromium on ArchLinux, so using "unknown" will probably be fine for everyone.
    var product_channel = 'unknown';
    // As of July, the Chrome Web Store sends 204 responses to user agents when their
    // Chrome/Chromium version is older than version 31.0.1609.0
    var product_version = '9999.0.9999.0';
    // Try to detect the Chrome version, and if it is lower than 31.0.1609.0, use a very high version.
    // $1 = m.0.r.p  // major.minor.revision.patch where minor is always 0 for some reason.
    // $2 = m
    // $3 =     r
    var cr_version = /Chrome\/((\d+)\.0\.(\d+)\.\d+)/.exec(navigator.userAgent);
    if (cr_version && +cr_version[2] >= 31 && +cr_version[3] >= 1609) {
        product_version = cr_version[1];
    }

    url = 'https://clients2.google.com/service/update2/crx?response=redirect';
    url += '&os=' + platformInfo.os;
    url += '&arch=' + platformInfo.arch;
    url += '&os_arch=' + platformInfo.arch; // crbug.com/709147 - should be archName of chrome.system.cpu.getInfo
    url += '&nacl_arch=' + platformInfo.nacl_arch;
    url += '&prod=' + product_id;
    url += '&prodchannel=' + product_channel;
    url += '&prodversion=' + product_version;
    url += '&acceptformat=crx2,crx3';
    url += '&x=id%3D' + extensionID;
    url += '%26uc';
    return url;
}

// Weak detection of whether the user is using Chrome instead of Chromium/Opera/RockMelt/whatever.
function isChromeNotChromium() {
    try {
        // Chrome ships with a PDF Viewer by default, Chromium does not.
        return null !== navigator.plugins.namedItem('Chrome PDF Viewer');
    } catch (e) {
        // Just in case.
        return false;
    }
}

// Get location of addon gallery for a given extension
function get_webstore_url(url) {
    // Keep logic in sync with is_webstore_url.
    var cws = cws_pattern.exec(url) || cws_download_pattern.exec(url);
    if (cws) {
        return 'https://chromewebstore.google.com/detail/' + cws[1];
    }
    var mea = mea_pattern.exec(url) || mea_download_pattern.exec(url);
    if (mea) {
        return 'https://microsoftedge.microsoft.com/addons/detail/' + mea[1];
    }
    var ows = ows_pattern.exec(url) || ows_download_pattern.exec(url);
    if (ows) {
        return 'https://addons.opera.com/extensions/details/' + ows[1];
    }
    var amo = get_amo_slug(url);
    if (amo) {
        return 'https://' + get_amo_domain(url) + '/firefox/addon/' + amo;
    }
    var atn = atn_pattern.exec(url) || atn_download_pattern.exec(url);
    if (atn) {
        return 'https://' + atn[1] + '/thunderbird/addon/' + atn[2];
    }
}

// Return the suggested name of the zip file.
function get_zip_name(url, /*optional*/filename) {
    if (!filename) {
        var extensionID = get_extensionID(url);
        if (!extensionID) {
            extensionID = mea_pattern.exec(url) || mea_download_pattern.exec(url);
            extensionID = extensionID && extensionID[1];
        }
        if (extensionID) {
            filename = extensionID;
        } else {
            // https://addons.opera.com/en/extensions/details/<slug>/?display=en
            // AMO: Lots of different formats, but usually ending with .xpi?....
            url = url.split(/[?#]/, 1)[0];
            filename = /([^\/]+?)\/*$/.exec(url)[1];
        }
    }
    return filename.replace(/\.(crx|jar|nex|xpi|zip)$/i, '') + '.zip';
}

function get_amo_domain(url) {
    var match = amo_domain_pattern.exec(url);
    return match ? match[1] : 'addons.mozilla.org';
}

function get_amo_slug(url) {
    var match = amo_pattern.exec(url) || amo_download_pattern.exec(url);
    if (match) {
        return match[2];
    }
}

function is_cors_enabled_download_url(url) {
    if (
        // We're only interested in XPI files from AMO,
        // which supports CORS as of March 2020:
        // https://github.com/mozilla/addons-server/issues/9118
        // The following matches the whole AMO domain, including non-CORS
        // endpoints. That's fine since we only care about XPI URLs.
        amo_domain_pattern.test(url) ||
        // The full redirect chain should also allow CORS, including the CDN:
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1620084
        amo_xpi_cdn_pattern.test(url)
    ) {
        return true;
    }
    return false;
}

// Some environments enforce restrictions on the URLs that can be accessed.
// This function rewrites the input URL to one that should serve exactly the
// same result as the requested URL, sans restrictions.
function get_equivalent_download_url(url) {
    var requestUrl = url;
//#if WEB
    if (/^https?:/.test(url) && !is_cors_enabled_download_url(url)) {
        // Proxy request through CORS Anywhere.
        requestUrl = 'https://cors-anywhere.herokuapp.com/' + url;
    }
//#endif
//#if OPERA
    // Opera blocks access to addons.opera.com. Let's bypass this restriction.
    // Unfortunately, there is no way to retrieve the .crx file in an ordinary way.
    // If given the extension ID, it is possible to fetch
    // "https://extension-updates.opera.com/api/omaha/update/?[see get_crx_url for params]"
    // but using the following x param instead:
    // "&x=id%3D[extensionID]%26v%3D[old version, e.g. 0]%26installedby%3Dinternal"
    // and then download the crx from https://addons-extensions.operacdn.com/media/direct/*/*/*.crx
    // ... but we are given the slug of the store listing, not the extension ID, so we cannot use this.
    if (ows_download_pattern.test(url)) {
        requestUrl = 'https://cors-anywhere.herokuapp.com/' + url;
    }
//#endif
    return requestUrl;
}

// Whether the URL is supported by crxviewer (used in the popup).
function can_viewsource_crx_url(url) {
    return is_crx_download_url(url) || is_webstore_url(url);
}

// Whether the given URL is not a CRX file, with certainty.
// Used to determine whether a file should pass through openCRXasZip (of lib/crx-to-zip.js).
function is_not_crx_url(url) {
    // Chromium-based browsers use CRX with certainty.
    if (
        cws_pattern.test(url) || cws_download_pattern.test(url) ||
        mea_pattern.test(url) || mea_download_pattern.test(url) ||
        ows_pattern.test(url) || ows_download_pattern.test(url) ||
        /\.(crx|nex)\b/.test(url)
    ) {
        return false;
    }
    // Firefox-based browsers use XPI, which is not a CRX with certainty.
    if (
        amo_pattern.test(url) || amo_domain_pattern.test(url) ||
        atn_pattern.test(url) || atn_download_pattern.test(url) ||
        /\.xpi([#?]|$)/.test(url)
    ) {
        return true;
    }
    // Unsure: maybe CRX, maybe not.
    return false;
}

// Whether the given URL is from a URL that is expected to serve the extension file.
function is_crx_download_url(url) {
    return cws_download_pattern.test(url) ||
        mea_download_pattern.test(url) ||
        ows_download_pattern.test(url) ||
        amo_download_pattern.test(url) ||
        atn_download_pattern.test(url) ||
        /\.(crx|nex|xpi)\b/.test(url);
}

function is_webstore_url(url) {
    // Keep logic in sync with get_webstore_url.
    return cws_pattern.test(url) ||
        mea_pattern.test(url) ||
        ows_pattern.test(url) ||
        amo_pattern.test(url) ||
        atn_pattern.test(url);
}

// |name| should not contain special RegExp characters, except possibly maybe a '[]' at the end.
// If |name| ends with a '[]', then the return value is an array. Otherwise the first match is
// returned.
function getParam(name, querystring) { // Assume name contains no RegEx-specific char
    var haystack = querystring || location.search || location.hash;
    var pattern, needle, match;
    if (name.slice(-2, name.length) === '[]') {
        pattern = new RegExp('[&?#]' + name.slice(0, -2) + '\\[\\]=([^&]*)', 'g');
        var needles = [];
        while ((match = pattern.exec(haystack)) !== null) {
            needles.push(decodeURIComponent(match[1]));
        }
        return needles;
    }
    pattern = new RegExp('[&?#]' + name + '=([^&]*)');
    needle = pattern.exec(haystack);
    return needle && decodeURIComponent(needle[1]);
}

function encodeQueryString(params) {
    var parts = [];
    Object.keys(params).forEach(function(key) {
        var value = params[key];
        if (Array.isArray(value)) {
            value.forEach(function(value2) {
                parts.push(encodeQueryStringPart(key + '[]', value2));
            });
        } else if (value !== void 0) {
            parts.push(encodeQueryStringPart(key, value));
        }
    });
    return parts.join('&');
    function encodeQueryStringPart(key, value) {
        value = encodeURIComponent(value);
        return key + '=' + value;
    }
}
