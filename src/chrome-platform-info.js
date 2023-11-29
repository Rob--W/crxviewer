/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Chrome's platform information
// Exported methods:
//
// - getPlatformInfoAsync(callback)
//   Calls callback with the most accurate PlatformInfo, sourced from
//   chrome.runtime.getPlatformInfo if possible.
//
// - getPlatformInfo()
//   Returns platformInfo compatible with the format of chrome.runtime.getPlatformInfo
//   When this method is unavailable, the getPlatformInfoFallback method is called.
//   To avoid this fallback, call getPlatformInfoAsync() at first (at least once).
//
// - getPlatformInfoFallback() is exposed for debugging purposes, other methods should
//   use getPlatformInfo() instead.

// First calculate the information, synchronously.
// - When chrome.runtime.getPlatformInfo is not supported
// - When the platform info is needed, but the information is not ready yet.
// Then, when available, query the platform information

/* globals chrome, console, navigator */
/* exported getPlatformInfoAsync, getPlatformInfo */

'use strict';

var _platformInfo_cached;

// Set platform info if unset
function getPlatformInfoAsync(callback) {
    if (_platformInfo_cached) {
        callback(getPlatformInfo());
        return;
    }
    if (
        typeof chrome !== 'object' ||
        !chrome.runtime ||
        !chrome.runtime.getPlatformInfo
    ) {
        _platformInfo_cached = getPlatformInfoFallback();
        callback(getPlatformInfo());
        return;
    }
    chrome.runtime.getPlatformInfo(function(platformInfo) {
        _platformInfo_cached = platformInfo;
        callback(getPlatformInfo());
    });
}

/**
 * Get platform info.
 * If it's not available in _platformInfo_cached, then the chrome.runtime.getPlatformInfo
 * method hasn't returned anything useful. Fall back to UA-sniffing.
 **/
function getPlatformInfo() {
    var platformInfo = _platformInfo_cached;
    if (!platformInfo) {
        console.warn('getPlatformInfoAsync() has not been called, using getPlatformInfoFallback()');
        return getPlatformInfoFallback();
    }
    platformInfo = Object.assign({}, platformInfo);
    // Firefox does not have nacl_arch.
    if (!platformInfo.nacl_arch) {
        platformInfo.nacl_arch = getPlatformInfoFallback().nacl_arch;
    }
    return platformInfo;
}


function getPlatformInfoFallback() {
    var os;
    var arch;

    // For the definition of the navigator object, see Chromium's source code:
    //  third_party/WebKit/Source/core/page/NavigatorBase.cpp
    //  webkit/common/user_agent/user_agent_util.cc

    // UA := "Mozilla/5.0 (%s) AppleWebKit/%d.%d (KHTML, like Gecko) %s Safari/%d.%d"
    //                     ^^                                        ^^
    //                     Platform + CPUinfo                        Product, Chrome/d.d.d.d
    var ua = navigator.userAgent;
    ua = ua.split('AppleWebKit')[0] || ua;
    // After splitting, we get the next string:
    // ua := "5.0 (%s) "

    // The string in comments is the line with the actual definition in user_agent_util.cc,
    // unless said otherwise.
    if (ua.indexOf('Mac') >= 0) {
        // "Intel Mac OS X %d_%d_%d",
        os = 'mac';
    } else if (ua.indexOf('Win') >= 0) {
        // "Windows NT %d.%d%s",
        os = 'win';
    } else if (ua.indexOf('Android') >= 0) {
        // Note: "Linux; " is preprended, so test Android before Linux
        // "Android %s%s",
        os = 'android';
    } else if (ua.indexOf('CrOS') >= 0) {
        // "CrOS "
        // "%s %d.%d.%d",
        os = 'cros';
    } else if (ua.indexOf('BSD') >= 0) {
        os = 'openbsd';
    } else { // if (ua.indexOf('Linux') >= 0) {
        os = 'linux';
    }

    if (/\barm/.test(ua)) {
        arch = 'arm';
    } else if (/[^.0-9]64(?![.0-9])/.test(ua)) {
        // WOW64, Win64, amd64, etc. Assume 64-bit arch when there's a 64 in the string, not surrounded
        // by dots or digits (this restriction is set to avoid matching version numbers)
        arch = 'x86-64';
    } else {
        arch = 'x86-32';
    }
    return {
        os: os,
        arch: arch,
        nacl_arch: arch
    };
}
