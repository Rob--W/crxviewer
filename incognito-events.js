/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 *
 * Shim to provide chrome.runtime.onInstalled and onStartup events to split incognito extensions.
 * Note that the incognito extension has to be activated before this check can be performed.
 * If it's a background page, it'll always be loaded.
 * If it's an event page, the non-incognito context has to trigger an event in order to activate
 *  the incognito page - see https://developer.chrome.com/extensions/event_pages.html#lifetime
 *
 * onStartup and onInstalled are never triggered simultaneously.
 * If the conditions for onInstalled apply, then onInstalled is triggered.
 * Otherwise, onStartup is triggered.
 */
/* globals chrome, localStorage, document, navigator */

'use strict';

// incognito:split & incognito disabled default = onInstalled
// event will never be triggered in incognito mode.
if (chrome.extension.inIncognitoContext)
(function() {
    var ONINSTALLED_KEY = 'chrome.runtime.onInstalled.incognito-check';
    var ONSTARTUP_KEY = 'chrome.runtime.onStartup.incognito-check';

    function get_onInstalledEvent() {
        var stored = JSON.parse(localStorage.getItem(ONINSTALLED_KEY) || '{"ua":"","version":""}');

        var version = chrome.runtime.getManifest().version;
        var ua = navigator.userAgent;
        var details = {};
        if (!stored.version) { // No value saved before = extension has just been installed
            details.reason = 'install';
        } else if (version !== stored.version) { // Version differs = extension update
            details.reason = 'update';
            details.previousVersion = stored.version;
        } else if (ua != stored.ua) { // User agent changed = Chrome updated
            details.reason = 'chrome_update';
        } else {
            return;
        }
        stored.version = version;
        stored.ua = ua;
        localStorage.setItem(ONINSTALLED_KEY, JSON.stringify(stored));
        set_hasStartedUp();
        return function() {
            chrome.runtime.onInstalled.dispatch(details);
        };
    }
    function get_onStartupEvent() {
        if (document.cookie.indexOf(ONSTARTUP_KEY) != -1) return;
        set_hasStartedUp();
        return function() {
            chrome.runtime.onStartup.dispatch();
        };
    }
    function set_hasStartedUp() {
        document.cookie = ONSTARTUP_KEY + '=1; max-age=30000000'; // Lifetime almost 1 year
    }

    // Fire onInstalled if needed, trigger onStartup otherwise.
    var dispatchEvent = get_onInstalledEvent() || get_onStartupEvent();
    if (dispatchEvent) ;
    else if (document.readyState == 'complete')
        dispatchEvent();
    else
        document.addEventListener('DOMContentLoaded', dispatchEvent);
})();
