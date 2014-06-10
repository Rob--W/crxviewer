/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 */
var beautify = (function(){
    // Detect URL of current script.
    // Note: Does not work if loaded asynchronously.
    var workerURL = document.scripts[document.scripts.length-1];
    if (workerURL) {
        workerURL = workerURL.src.replace(/[^\/]+.js([\?#].*?)?$/i, '');
    }
    workerURL = (workerURL || './') + 'worker-beautify.js';
        
    var worker = new Worker(workerURL);
    var isWorkerAvailable = false;
    worker.addEventListener('message', function listener() {
        worker.removeEventListener('message', listener);
        isWorkerAvailable = true;
    });

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
    return beautify;
})();
