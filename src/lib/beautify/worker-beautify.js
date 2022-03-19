/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/*
 * Beautify:
 * - JSON
 * - JavaScript
 * - HTML
 * - CSS
 */

'use strict';

/* globals beautifier, json_beautify */
importScripts(
    'beautifier.js',
    'beautify-json.js'
);

self.onmessage = function(event) {
    var messagePort = event.ports && event.ports[0];
    if (messagePort) {
        messagePort.addEventListener('message', self.onmessage);
        messagePort.start();
        // Just like the end of this file: Hi, I'm alive!
        messagePort.postMessage({});
        return;
    }
    var data = event.data;
    var messageID = data.messageID;
    var source = data.source;
    var type = data.type;
    var options = data.options || {};
    
    var result;
    try {
        result = beautify(type, source, options);
    } catch (e) {
        // An error occurred, give a proper result, but also
        // queue an error message
        setTimeout(function() { throw e; }, 0);
        result = source;
    }

    // event.target: Either the WorkerGlobalScope, or a MessagePort.
    event.target.postMessage({
        messageID: messageID,
        result: result
    });
};
function beautify(type, source, options) {
    switch (type) {
    case 'css':
        return beautifier.css(source, options);
    case 'html':
        return beautifier.html(source, options);
    case 'js':
        return beautifier.js(source, options);
    case 'json':
        return json_beautify(source);
    default:
        return source;
    }
}

// Hi, I'm alive!
postMessage({});
