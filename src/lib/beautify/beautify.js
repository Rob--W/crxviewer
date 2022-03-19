/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* exported beautify */
'use strict';

var beautify = (function(){
    var worker;
    if (typeof document == 'object') {
        // Detect URL of current script.
        // Note: Does not work if loaded asynchronously.
        var workerURL;
        if (document.currentScript) {
            workerURL = document.currentScript.src
                .replace(/[^\/]+.js([\?#].*?)?$/i, '');
        }
        workerURL = (workerURL || './') + 'worker-beautify.js';
        worker = new Worker(workerURL);
    } else {
        // Inside a Web Worker. Delegate the task to the worker that exists in
        // the parent (main) thread.
        // The parent thread should call beautify.maybeInterceptMessageEvent for
        // a message event from this worker.
        // We don't use a dedicated worker because Chromium does not support
        // nested workers, and I also use this library in the main thread, so
        // a dedicated worker already exists in the main thread.
        var messageChannel = new MessageChannel();
        self.postMessage('PORT_BEAUTY', [messageChannel.port1]);
        worker = messageChannel.port2;
    }
    // This boolean is here in case the worker fails to load.
    // I generally expect the worker to have finished initializing before the
    // caller want to do anything useful with it.
    var isWorkerAvailable = false;
    // Using worker.onmessage instead of addEventListener to make sure that
    // if "worker" is a MessagePort, that .start is then implicitly called here.
    worker.onmessage = function() {
        worker.onmessage = null;
        isWorkerAvailable = true;
    };

    var _messageID = 0;
    function beautify(options, callback) {
        if (!options) options = {};
        var source = options.text;
        var type = options.type;
        var wrap_line_length = options.wrap;

        if (!isWorkerAvailable) {
            // Don't queue or anything, just show the non-beautified result
            callback(source);
            return;
        }
        if (!type) {
            // When there is no beautification type, the result will be
            // identical. Immediately send back the result to avoid a round-trip
            // to the worker.
            callback(source);
            return;
        }
        var messageID = ++_messageID;
        worker.addEventListener('message', function listener(event) {
            var data = event.data;
            if (data.messageID != messageID) return;
            worker.removeEventListener('message', listener);

            callback(data.result);
        });
        worker.postMessage({
            messageID: messageID,
            source: source,
            type: type,
            options: {
                indent_size: 4,
                indent_char: ' ',
                preserve_newlines: true,            // js
                keep_array_indentation: false,      // js
                break_chained_methods: true,        // js
                indent_scripts: false,              // html
                brace_style: 'collapse',            // js
                space_before_conditional: true,     // js
                unescape_strings: true,             // js
                wrap_line_length: wrap_line_length || 0,
                space_after_anon_function: false    // js
            }
        });
    }
    beautify.getType = function(filename) {
        var extension = filename.split('.').pop().toLowerCase();
        switch (extension) {
        case 'js':
            return 'js';
        case 'css':
            return 'css';
        case 'htm':
        case 'html':
        case 'xhtml':
            return 'html';
        case 'json':
            return 'json';
        }
        return ''; // Unknown
    };
    beautify.maybeInterceptMessageEvent = function(event) {
        if (event.data === 'PORT_BEAUTY' && event.ports && event.ports.length) {
            worker.postMessage('', event.ports);
            return true;
        }
        return false;
    };
    return beautify;
})();
