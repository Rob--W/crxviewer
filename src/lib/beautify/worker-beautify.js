/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 */
/*
 * Beautify:
 * - JSON
 * - JavaScript
 * - HTML
 * - CSS
 */

// jsbeautifier only exports to exports or window...
var window = self;

importScripts(
    'jsbeautifier/beautify.js',
    'jsbeautifier/beautify-css.js',
    'jsbeautifier/beautify-html.js',
    'jsbeautifier/unpackers/javascriptobfuscator_unpacker.js',
    'jsbeautifier/unpackers/urlencode_unpacker.js',
    'jsbeautifier/unpackers/p_a_c_k_e_r_unpacker.js',
    'jsbeautifier/unpackers/myobfuscate_unpacker.js',
    'jsbeautifier/unpackers/unpacker_filter.js',
    'beautify-json.js'
);

self.onmessage = function(event) {
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

    postMessage({
        messageID: messageID,
        result: result
    });
};
function beautify(type, source, options) {
    switch (type) {
    case 'css':
        return css_beautify(source, options);
    case 'html':
        return html_beautify(source, options);
    case 'js':
        // Detect packer
        source = unpacker_filter(source);
        return js_beautify(source, options);
    case 'json':
        return json_beautify(source);
    default:
        return source;
    }
}

// Hi, I'm alive!
postMessage({});
