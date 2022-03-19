/* jshint esversion: 6 */
/* globals browser, console, crypto, document, location, URL, XMLHttpRequest */
'use strict';

// Firefox 60+ is overzealous and stops add-ons from reading the response of some Mozilla domains.
//   See https://github.com/Rob--W/crxviewer/issues/58
//   and https://bugzilla.mozilla.org/show_bug.cgi?id=1450649
// This module uses domain fronting to get around those restriction.
//
// Requirements:
// - The front domain and the original domains are handled at the same server.
// - The server presents a valid SSL certificate for the front domain, if https is used.
// - Cookies:
//   * Host-only cookies are not supported.
//   * Domain cookies are supported if the front domain is a subdomain of the original domain.
//   * In any case, the front domain will receive cookies of the original domain.
//     Don't use domain fronting if the front domain cannot be trusted by the original domain!

(() => {
    let DOMAIN_FRONTS = new Map();
    DOMAIN_FRONTS.set('addons.mozilla.org', 'services.addons.mozilla.org');
    DOMAIN_FRONTS.set('addons.cdn.mozilla.net', 'addons.cdn.mozilla.net.');

    const REQUEST_ID_HEADER = 'random-id-to-map-xhr-to-domain-fronter';
    let thisTabId = -1;
    browser.tabs.getCurrent().then(tab => { thisTabId = tab.id; });

    class DomainFronter {
        constructor() {
            this._onBeforeSendHeaders = this._onBeforeSendHeaders.bind(this);
            this._onHeadersReceived = this._onHeadersReceived.bind(this);

            this.originalDomain = '';

            this.initialRequestId = crypto.getRandomValues(new Uint32Array(1))[0].toString();

            this.requestId = '';
        }

        /**
         * @param {URL} url The URL that will be requested.
         * @returns {boolean} Whether domain fronting has been applied.
         */
        modifyBeforeRequest(url) {
            let {hostname} = url;
            let domainFront = DOMAIN_FRONTS.get(hostname);
            if (!domainFront) {
                this.originalDomain = '';
                return false;
            }
            console.log(`Applying domain fronting: Requesting "${hostname}" at "${domainFront}"`);
            this.originalDomain = hostname;
            url.hostname = domainFront;
            return true;
        }

        register() {
            let filter = {
                types: ['xmlhttprequest'],
                urls: ['*://*/*'],
            };
            if (thisTabId !== -1) {
                filter.tabId = thisTabId;
            }
            browser.webRequest.onBeforeSendHeaders.addListener(
                this._onBeforeSendHeaders, filter, ['blocking', 'requestHeaders']);
            browser.webRequest.onHeadersReceived.addListener(
                this._onHeadersReceived, filter, ['blocking', 'responseHeaders']);
        }

        unregister() {
            browser.webRequest.onBeforeSendHeaders.removeListener(this._onBeforeSendHeaders);
            browser.webRequest.onHeadersReceived.removeListener(this._onHeadersReceived);
        }

        _onBeforeSendHeaders({originUrl, requestId, requestHeaders, url}) {
            if (new URL(originUrl).origin !== location.origin) {
                // Only accept requests that this extension has generated.
                return;
            }

            // Ensure that this is a request that we want to modify.
            if (!this.requestId) {
                let i = requestHeaders.findIndex(({name}) => name === REQUEST_ID_HEADER);
                if (i === -1 || requestHeaders[i].value !== this.initialRequestId) {
                    return;
                }
                requestHeaders.splice(i, 1);
                this.requestId = requestId;
            } else if (this.requestId !== requestId) {
                // The REQUEST_ID_HEADER can be omitted for redirected requests.
                // But then we should have stored requestId before, and that should match.
                return;
            }

            // If domain fronting has been applied, restore the original domain.
            if (this.originalDomain) {
                let hostHeader = requestHeaders.find(({name}) => name === 'Host');
                let [, domainFromHeader, portSuffix = ''] = /^(.+?)(:\d+)?$/.exec(hostHeader.value);
                let domainFront = DOMAIN_FRONTS.get(this.originalDomain);
                if (domainFront !== domainFromHeader) {
                    console.warn(`Unexpected Host header. Expected "${domainFront}${portSuffix}" (from "${this.originalDomain}"), got "${hostHeader.value}"`);
                    return;
                }
                hostHeader.value = `${this.originalDomain}.${portSuffix}`;
                let cacheHeader = requestHeaders.find(({name}) => /^cache-control$/i.test(name));
                if (!cacheHeader) {
                    cacheHeader = {name: 'Cache-Control'};
                    requestHeaders.push(cacheHeader);
                }
                cacheHeader.value = 'no-cache';
            }
            return {requestHeaders};
        }

        _onHeadersReceived({requestId, responseHeaders, url, statusCode}) {
            if (this.requestId !== requestId) {
                return;
            }

            if (statusCode !== 301 &&
                statusCode !== 302 &&
                statusCode !== 303 &&
                statusCode !== 307 &&
                statusCode !== 308) {
                return; // Not a redirect
            }

            let header = responseHeaders.find(({name}) => name.toLowerCase() === 'location');
            if (header) {
                let urlObj = new URL(header.value, url);
                if (this.modifyBeforeRequest(urlObj)) {
                    header.value = urlObj.href;
                    return {responseHeaders};
                }
            }
        }
    }

    let XHR_open = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(...args) {
        let domainFronter = new DomainFronter();
        let url = new URL(args[1], document.baseURI);
        if (domainFronter.modifyBeforeRequest(url)) {
            args[1] = url.href;
        }
        XHR_open.apply(this, args);

        domainFronter.register();
        this.setRequestHeader(REQUEST_ID_HEADER, domainFronter.initialRequestId);
        this.addEventListener('loadend', () => {
            domainFronter.unregister();
        }, {once: true});

        // Work-around for https://bugzil.la/1300234
        let {send} = this;
        let registeredPromise = browser.runtime.getBrowserInfo();
        registeredPromise.then(() => {
            this.send = send;
        });
        this.send = function(data) {
            registeredPromise.then(() => {
                this.send(data);
            });
        };
    };
})();
