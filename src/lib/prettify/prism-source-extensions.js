/**
 * (c) 2016 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * My glue for prism.js, designed for viewing untrusted source code.
 */
'use strict';
/* globals Prism, Worker, self, importScripts, setTimeout, clearTimeout,
           console */

if (typeof importScripts === 'function') { // In a Web Worker.
    // Disable Prism.js's message handler; we are going to take care of it.
    self.Prism = {disableWorkerMessageHandler: true};
    importScripts('prism.js');
    self.addEventListener('message', function(event) {
        self.postMessage('PRISM_ROB_WORKER_MSG_RECEIVED');
        self.postMessage(
            Prism.rob.highlightSource(event.data.code, event.data.filename));
    });
}

Prism.hooks.add('wrap', function(env) {
    // Delete title attributes (from markup).
    // (they preview HTML entities, but in XUL add-ons custom entities
    //  are very common, so highlighting them only adds noise).
    delete env.attributes.title;
});

// My namespace.
Prism.rob = {};

/**
 * Wraps every line in a <li>.
 * Advantages over the standard prism-line-numbers.js plugin:
 * - Preserves styling of multi-line tokens (e.g. comments).
 * - Allows per-line styling (e.g. :hover)
 * - Allows word wrapping while maintaining the line number.
 * - No DOM or in-place DOM manipulations, so no unnecessary recalcs/slow DOM.
 *
 * This method could be called at the before-insert hook, e.g.
 *
 *     Prism.hooks.add('before-insert', function(env) {
 *       env.highlightedCode = Prism.rob.wrapSourceLines(env.highlightedCode);
 *     });
 *
 * @param {string} safeHtml - Safe HTML (i.e. satisfying the invariants as
 *    mentioned inside the function).
 * @returns {string} HTML with every line wrapped in its own list element. Any
 *    (markup) tags that were not closed before the line break are closed and
 *    re-opened at the next line..
 */
Prism.rob.wrapSourceLines = function(safeHtml) {
    // ### Invariants on safeHtml
    // [a] '\n' never appears between '<' and next '>'
    // [b] All '<' characters mark the start of a tag, and is always eventually
    //     followed by a '>'. There are no '<' or '>' in between.
    // [c] All HTML is safe (no scripts / external resources are loaded).
    // [d] All tags are correctly nested/balanced (e.g. <a><b>...</b></a>).
    //
    // ### Verification of invariants on input
    // safeHtml is supposed comes from prism.js, which treats the input as text
    // and escapes '<' and '&'. All invariants are initially satisfied for the
    // lack of HTML tags. prism.js's Token.stringify returns HTML using code
    // similar to '<' + tag + attributes + '>' + content + '</' + tag + '>'.
    // `content` is the result of recursively calling Token.stringify. Since the
    // input was already properly escaped, `content` satisfies all invariants.
    // tag and attributes are safe by default, but they may be modified by
    // prism highlighters and plugins. To audit, just look up every use of the
    // 'wrap' hook, and ascertain that the result is safe.
    // Source: https://github.com/PrismJS/prism/blob/07b81ac79e565/prism.js#L451
    // Audit results:
    // - https://github.com/PrismJS/prism/issues/1053
    // - https://github.com/PrismJS/prism/issues/1054
    // - https://github.com/PrismJS/prism/pull/1050
    // - https://github.com/PrismJS/prism/pull/1051
    //
    // ### Safety proof (=at the end of this function, safeHtml is still safe)
    // We split at '\n', so the line boundaries are outside tags because of [a].
    // tag_regex finds all HTML tag (relying on [b]) and inserts it in the tag
    // stacks. These tag stacks are inserted at the start and end of the line.
    // Since the HTML in these tag stacks are safe (according to [c]), the HTML
    // is not modified and the boundaries are outside tags, the resulting HTML
    // is still safe. No other output is added, so [b] and [c] are maintained.
    //
    // [d] enables processTag to correctly maintain the tag stacks and generate
    // well-formed HTML (this is needed to make sure that the resulting HTML's
    // appearance is the same as the input.
    //
    // Since the invariants ([a], [b] and [c] in particular) are maintained,
    // the resulting safeHtml is still safe and free of XSS.  QED
    
    // Assertion to check invariants.
    var assert = function(cond, msg) { if (!cond) throw new Error(msg); };

    // Keep track of the open tags, in case content spans multiple lines.
    var tag_stack_head = [];  // E.g. <a attr><b>
    var tag_stack_tail = [];  // E.g. </b></a>

    // This regex relies on the fact/assumption that prism.js always
    // encodes input '<' as '&lt;', so any '<' is the start of a tag.
    // '>' is not encoded, but I assume/verified that prism does not
    // add attributes containing '>' (grep attributes).
    var tag_regex = /<\/?[^><]*>/g;
    var processTag = function(tag) {
        if (assert) assert(tag.indexOf('\n') === -1, 'No linebreaks');
        if (assert) assert(/^<\/?([^"><]|"[^"]*")+>$/.test(tag), 'Safe HTML');
        if (tag.charCodeAt(1) === 47) { // '/'
            if (assert) assert(tag === tag_stack_tail[0], 'Closing tag');
            tag_stack_head.pop();
            tag_stack_tail.shift();
        } else {
            tag_stack_head.push(tag);
            // Element name is first character until space. If the element has
            // no attributes, then i === -1. That is also good, because then the
            // element name ends before the last character ('>').
            var i = tag.indexOf(' ');
            tag_stack_tail.unshift('</' + tag.slice(1, i) + '>');
        }
    };

    safeHtml =
        '<ol class="line-nums">' +
        safeHtml
        .split('\n')
        .map(function(line, i) {
            var out = i % 2 ? '<li class="odd-code-line">' : '<li>';
            out += tag_stack_head.join('');
            var tags = line.match(tag_regex);
            if (tags !== null) tags.forEach(processTag);
            out += line + tag_stack_tail.join('') + '</li>';
            return out;
        })
        .join('') +
        '</ol>';

    if (assert) assert(tag_stack_head.length === 0, 'Head stack empty');
    if (assert) assert(tag_stack_tail.length === 0, 'Tail stack empty');
    return safeHtml;
};

/**
 * Map file extensions to language.
 * This is only a subset of the languages for which prism.js has highlighters.
 * A hard requirement for syntax highlighters is that the highlighter does not
 * add or remove characters from the displayed text. For this reason, languages
 * such as PHP cannot be supported: https://github.com/PrismJS/prism/issues/1053
 * Languages are added if they meet any of the following criteria:
 * - Is the language used on the web
 * - Is the language used as in build tools
 * - Is the language used in documentation
 *
 * @param {string} The file extension.
 * @returns {string} The prism.js language hint
 */
Prism.rob.extToLanguage = function(ext) {
    // Alphabetically by language, then by extension.
    switch (ext) {
    case 'cakefile':
    case 'coffee':
    case 'litcoffee':
        return 'coffeescript';
    case 'bash':
    case 'sh':
        return 'bash';
    case 'bat':
    case 'cmd':
        return 'batch';
    case 'css':
        return 'css';
    case 'go':
        return 'go';
    case 'ini':
        return 'ini';
    case 'js':
    case 'jsm':
        return 'javascript';
    case 'json':
        return 'json';
    case 'jsx':
        return 'jsx';
    case 'less':
        return 'less';
    case 'ls':
        return 'livescript';
    case 'makefile':
        return 'makefile';
    case 'markdown':
    case 'md':
        return 'markdown';
    case 'htm':
    case 'html':
    case 'xhtml':
    case 'xml':
    case 'xul':
        return 'markup';
    case 'pl':
        return 'perl';
    case 'ps1':
    case 'psd1':
    case 'psm1':
        return 'powershell';
    case 'py':
        return 'python';
    case 'rake':
    case 'rakefile':
    case 'rb':
        return 'ruby';
    case 'scss':
        return 'scss';
    case 'ts':
    case 'tsx': // "tsx" in Prism is an alias for "typescript".
        return 'typescript';
    case 'wat':
        return 'wasm';
    default:
        return '';
    }
};

Prism.rob.detectLanguage = function(code, filename) {
    filename = filename || '';
    // ~ is a common suffix for auto-generated backup files.
    var extParts = filename.toLowerCase().replace(/~$/, '').split('.');
    // Note: If the filename has no dot, then "ext" is the filename itself.
    var ext = extParts.pop();
    if (ext === 'bk' || ext === 'bak') {
        ext = extParts.pop();
    }

    // Try the last extension, fall back to the penultimate extension.
    var language = Prism.rob.extToLanguage(ext);
    if (language)
        return language;

    if (/^\s*</.test(code))
        return 'markup';

    return language;
};

/**
 * @param {string} text - Code to highlight.
 * @param {string} [filename] - Filename used for language detection.
 * @returns {string} HTML that represents the text with syntax-highlighting.
 *    This HTML can safely be inserted in the document.
 */
Prism.rob.highlightSource = function(code, filename) {
    // Based on Prism.highlight, without dependency on DOM.
    var language = Prism.rob.detectLanguage(code, filename);
    var grammar = Prism.languages[language];

    var highlightedCode;
    if (grammar && code) {
        highlightedCode = Prism.highlight(code, grammar, language);
    } else {
        highlightedCode = Prism.util.encode(code);
    }

    highlightedCode = Prism.rob.wrapSourceLines(highlightedCode);
    return highlightedCode;
};

/**
 * Similar to highlightSource, but asynchronous. The callback is invoked when
 * the source has been prettified. If the code cannot be prettified (e.g. when
 * it takes too long to do so), the callback is never invoked.
 */
Prism.rob.highlightSourceAsync = function(code, filename, callback) {
    // highlightSourceAsync is expected to not be called too frequently.
    var worker = Prism.rob.highlightSourceAsync._worker;
    if (worker) {
        // The worker handles only one task at a time. We are going to process a
        // task, so take ownership of the worker.
        Prism.rob.highlightSourceAsync._worker = null;
    } else {
        var workerSrc = Prism.filename;
        workerSrc = workerSrc.replace('prism.js', 'prism-source-extensions.js');
        worker = new Worker(workerSrc);
    }
    var workerTooBusyTimer;
    worker.addEventListener('message', function listener(event) {
        // In response to the postMessage call below, the worker will send the
        // following control message before highlighting the code. This allows
        // us to detect whether the highlighting is taking too long.
        if (event.data === 'PRISM_ROB_WORKER_MSG_RECEIVED') {
            workerTooBusyTimer = setTimeout(function() {
                worker.terminate();
                console.log('Aborted highlightSourceAsync for ' + filename +
                    ' because it did not finish in ' +
                    Prism.rob.highlightSourceAsync.MAXIMUM_DEADLINE_MS + 'ms.');
            }, Prism.rob.highlightSourceAsync.MAXIMUM_DEADLINE_MS);
            return;
        }
        clearTimeout(workerTooBusyTimer);
        worker.removeEventListener('message', listener);
        if (Prism.rob.highlightSourceAsync._worker) {
            // There is already a free worker, we are not needed.
            worker.terminate();
        } else {
            // Cache worker for the next call to highlightSourceAsync.
            Prism.rob.highlightSourceAsync._worker = worker;
        }
        callback(event.data);
    });
    worker.postMessage({
        code: code,
        filename: filename,
    });
};

// Number of seconds to wait before terminating the worker.
Prism.rob.highlightSourceAsync.MAXIMUM_DEADLINE_MS = 10000;
