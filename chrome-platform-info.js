// Chrome's platform information
// Exported methods:
//
// - getPlatformInfo()
//   Returns platformInfo compatible with the format of chrome.runtime.getPlatformInfo
//   When this method is unavailable, the getPlatformInfoFallback method is called.
//
// - getPlatformInfoFallback() is exposed for debugging purposes, other methods should
//   use getPlatformInfo() instead.

// First calculate the information, synchronously.
// - When chrome.runtime.getPlatformInfo is not supported
// - When the platform info is needed, but the information is not ready yet.
// Then, when available, query the platform information

/* globals chrome, localStorage, navigator */

'use strict';

// Set platform info if unset
if (chrome.runtime.getPlatformInfo && !localStorage.getItem('platformInfo')) {
    chrome.runtime.getPlatformInfo(function(platformInfo) {
        localStorage.setItem('platformInfo', JSON.stringify(platformInfo));
    });
}

/**
 * Get platform info.
 * If it's not available in localStorage, then the chrome.runtime.getPlatformInfo
 * method hasn't returned anything useful. Fall back to UA-sniffing.
 **/
function getPlatformInfo() {
    var platformInfo = localStorage.getItem('platformInfo');
    return platformInfo ? JSON.parse(platformInfo) : getPlatformInfoFallback();
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
    // appVersion = UA without "Mozilla/"
    var ua = navigator.appVersion.split('AppleWebKit')[0];
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
        os = 'Linux';
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

