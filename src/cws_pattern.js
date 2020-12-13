/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals location, getPlatformInfo, navigator */
/* exported cws_match_pattern, mea_match_pattern, ows_match_pattern, amo_match_patterns, amo_file_version_match_patterns */
/* exported cws_pattern, mea_pattern, ows_pattern, amo_pattern, amo_file_version_pattern */
/* exported get_crx_url, get_webstore_url, get_zip_name, is_crx_url, is_not_crx_url, getParam */
/* exported is_crx_download_url */
/* exported get_amo_domain, get_amo_slug */
/* exported get_equivalent_download_url */
/* exported encodeQueryString */
'use strict';

// cws_pattern[1] = extensionID
var cws_pattern = /^https?:\/\/chrome.google.com\/webstore\/.+?\/([a-z]{32})(?=[\/#?]|$)/;
var cws_download_pattern = /^https?:\/\/clients2\.google\.com\/service\/update2\/crx\b.*?%3D([a-z]{32})%26uc/;
// match pattern per Chrome spec
var cws_match_pattern = '*://chrome.google.com/webstore/detail/*';

// Microsoft Edge Addons Store
var mea_pattern = /^https?:\/\/microsoftedge.microsoft.com\/addons\/.+?\/([a-z]{32})(?=[\/#?]|$)/;
var mea_download_pattern = /^https?:\/\/edge\.microsoft\.com\/extensionwebstorebase\/v1\/crx\b.*?%3D([a-z]{32})%26uc/;
var mea_match_pattern = '*://microsoftedge.microsoft.com/addons/detail/*';

// Opera add-on gallery
var ows_pattern = /^https?:\/\/addons.opera.com\/.*?extensions\/(?:details|download)\/([^\/?#]+)/i;
var ows_match_pattern = '*://addons.opera.com/*extensions/details/*';

// Firefox addon gallery
var amo_pattern = /^https?:\/\/(addons\.mozilla\.org|addons(?:-dev)?\.allizom\.org|addons\.thunderbird\.net)\/.*?(?:addon|review)\/([^/<>"'?#]+)/;
var amo_download_pattern = /^https?:\/\/(addons\.mozilla\.org|addons(?:-dev)?\.allizom\.org|addons\.thunderbird\.net)\/[^?#]*\/downloads\/latest\/([^/?#]+)/;
var amo_domain_pattern = /^https?:\/\/(addons\.mozilla\.org|addons(?:-dev)?\.allizom\.org|addons\.thunderbird\.net)\//;
var amo_file_version_pattern = /^https?:\/\/(addons\.mozilla\.org|addons(?:-dev)?\.allizom\.org|addons\.thunderbird\.net)\/(?:[^?#\/]*\/)?(?:firefox|thunderbird)\/files\/browse\/(\d+)(\/[^?#\/]+\.xpi)?/;
var amo_match_patterns = [
    '*://addons.mozilla.org/*addon/*',
    '*://addons.mozilla.org/*review/*',
    '*://addons.allizom.org/*addon/*',
    '*://addons.allizom.org/*review/*',
    '*://addons-dev.allizom.org/*addon/*',
    '*://addons-dev.allizom.org/*review/*',
    '*://addons.thunderbird.net/*addon/*',
    '*://addons.thunderbird.net/*review/*',
];
var amo_file_version_match_patterns = [
    '*://addons.mozilla.org/*firefox/files/browse/*',
    '*://addons.allizom.org/*firefox/files/browse/*',
    '*://addons-dev.allizom.org/*firefox/files/browse/*',
    '*://addons.thunderbird.net/*thunderbird/files/browse/*',
];
// Depends on: https://bugzilla.mozilla.org/show_bug.cgi?id=1620084
var amo_xpi_cdn_pattern = /^https?:\/\/(?:addons\.cdn\.mozilla\.net|addons-dev-cdn\.allizom\.org)\/user-media\/addons\//;

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

    var url = get_amo_base_url(amoDomain) + '/downloads/latest/';
    url += addonSlug;
    url += '/platform:' + platformId;
    url += '/';
    // We can put anything here, but it is usually the desired file name for the XPI file.
    url += addonSlug + '.xpi';
    return url;
}

// Returns location of CRX file for a given extensionID or CWS url or Opera add-on URL
// or Firefox addon URL or Microsoft Edge addon URL.
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
    match = amo_file_version_pattern.exec(extensionID_or_url);
    if (match) {
        return get_amo_base_url(match[1]) + '/downloads/file/' + match[2] + (match[3] || '/addon.xpi');
    }
    match = mea_pattern.exec(url) || mea_download_pattern.exec(url);
    if (match) {
        return 'https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=id%3D' + match[1] + '%26installsource%3Dondemand%26uc';
    }
    // Chrome Web Store
    match = get_extensionID(extensionID_or_url);
    var extensionID = match ? match : extensionID_or_url;

    if (!/^[a-z]{32}$/.test(extensionID)) {
        return extensionID_or_url;
    }

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
    var cws = cws_pattern.exec(url) || cws_download_pattern.exec(url);
    if (cws) {
        return 'https://chrome.google.com/webstore/detail/' + cws[1];
    }
    var mea = mea_pattern.exec(url) || mea_download_pattern.exec(url);
    if (mea) {
        return 'https://microsoftedge.microsoft.com/addons/detail/' + mea[1];
    }
    var ows = ows_pattern.exec(url);
    if (ows) {
        return 'https://addons.opera.com/extensions/details/' + ows[1];
    }
    var amo = get_amo_slug(url);
    if (amo) {
        return get_amo_base_url(get_amo_domain(url))+'/addon/' + amo;
    }
}

// Return the suggested name of the zip file.
function get_zip_name(url, /*optional*/filename) {
    if (!filename) {
        var extensionID = get_extensionID(url);
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

function get_amo_base_url(amoDomain) {
    if (amoDomain === 'addons.thunderbird.net') {
        return 'https://addons.thunderbird.net/thunderbird';
    }
    return 'https://' + amoDomain + '/firefox';
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
    requestUrl = url.replace(/^https?:\/\/addons\.opera\.com(?=\/)/i, '$&.');
//#endif
//#if CHROME
    // Brave intercepts requests to the CWS update endpoint, and prevents us
    // from reading the source file, as explained at
    // https://github.com/Rob--W/crxviewer/issues/91#issuecomment-629854450
    //
    // Work around this by changing the URL to something that does not match
    // https://github.com/brave/brave-core/blob/f453ab2a5e8425afea9bd980fb688d8fec137f53/browser/net/brave_common_static_redirect_network_delegate_helper.cc#L40
    if (url.startsWith('https://clients2.google.com/service/update2')) {
        // There are multiple ways to bypass the check. Replacing the host is
        // one of them, but we don't do that because manifest.json does not
        // include permissions for access to other subdomains of google.com.
        // Prepending another slash works, so let's use it.
        requestUrl = url.replace('.com/', '.com//');
    }
//#endif
    return requestUrl;
}

function is_crx_url(url) {
    return cws_pattern.test(url) || mea_pattern.test(url) || ows_pattern.test(url) || /\.(crx|nex)\b/.test(url);
}

// Whether the given URL is not a CRX file, with certainty.
function is_not_crx_url(url) {
    if (is_crx_url(url) || cws_download_pattern.test(url) || mea_download_pattern.test(url))
        return false;
    return amo_pattern.test(url) ||
        amo_download_pattern.test(url) ||
        amo_file_version_pattern.test(url) ||
        /\.xpi([#?]|$)/.test(url);
}

function is_crx_download_url(url) {
    return cws_download_pattern.test(url) || mea_download_pattern.test(url) || amo_download_pattern.test(url);
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
