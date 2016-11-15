/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 */

/* jshint browser:true, devel:true */
/* globals chrome, URL,
           getParam, encodeQueryString, openCRXasZip, get_zip_name, get_webstore_url, is_not_crx_url,
           get_extensionID, getPlatformInfo,
           cws_pattern, get_crx_url, cws_download_pattern,
           zip,
           EfficientTextWriter,
           beautify,
           Prism,
           SearchEngineElement,
           CryptoJS
           */

'use strict';

// crx_url is globally set to the URL of the shown file for ease of debugging.
// If there is no URL (e.g. with  <input type=file>), then crx_url is the file name.

// Integrate zip.js
zip.workerScriptsPath = 'lib/zip.js/';

function formatByteSize(fileSize) {
    // Assume parameter fileSize to be a number
    fileSize = (fileSize+'').replace(/\d(?=(\d{3})+(?!\d))/g, '$&,');
    return fileSize;
}
function formatByteSizeSuffix(fileSize) {
    if (fileSize < 1e4)
        return fileSize + ' B';
    if (fileSize < 1e6)
        return Math.round(fileSize/1e3) + ' KB';
    if (fileSize < 1e9)
        return Math.round(fileSize/1e6) + ' MB';
    // Which fool stores over 1 GB of data in a Chrome extension???
    return Math.round(fileSize/1e9) + ' GB';
}
function handleZipEntries(entries) {
    var output = document.createDocumentFragment();
    var root = [];
    var nonroot = [];

    var listItemBase = document.createElement('li');
    var genericTypeCounts = {};
    listItemBase.innerHTML =
'<span class="file-path">' +
    '<span class="file-dir"></span>' +
    '<span class="file-name"></span>' +
'</span>' +
'<span class="file-size"></span>';
    entries.forEach(function(entry) {
        // Who cares about folders? Files are interesting!
        if (entry.directory) return;

        var filename = entry.filename;
        var listItem = listItemBase.cloneNode(true);

        // "path/to/file" -> ["path/to/", "file"]
        var filenameIndex = filename.lastIndexOf('/');
        filenameIndex = filenameIndex === -1 ? 0 : filenameIndex + 1;
        listItem.querySelector('.file-path').title = filename;
        listItem.querySelector('.file-name').textContent = filename.slice(filenameIndex);
        listItem.querySelector('.file-dir').textContent = filename.slice(0, filenameIndex);
        var fileSize = entry.uncompressedSize;
        var fileSizeElem = listItem.querySelector('.file-size');
        fileSizeElem.title = formatByteSize(fileSize) + ' bytes';
        fileSizeElem.textContent = formatByteSizeSuffix(fileSize);

        listItem.addEventListener('click', function(e) {
            var tmp = document.querySelector('.file-selected');
            if (tmp) tmp.classList.remove('file-selected');
            listItem.classList.add('file-selected');
            viewFileInfo(entry);
        });

        listItem.dataset.filename = filename;

        var genericType = getGenericType(filename);
        if (genericType) {
            listItem.classList.add('gtype-' + genericType);
            genericTypeCounts[genericType] = genericTypeCounts[genericType] + 1 || 1;
        }

        if (filename.toLowerCase() === 'manifest.json')
            output.appendChild(listItem);
        else if (filename.indexOf('/') === -1)
            root.push({filename:filename, listItem:listItem});
        else
            nonroot.push({filename:filename, listItem:listItem});
    });
    function sortAndAppend(list) {
        list.sort(function(x, y) {
            return x.filename.localeCompare(y.filename);
        }).forEach(function(o) {
            output.appendChild(o.listItem);
        });
    }
    sortAndAppend(root);
    sortAndAppend(nonroot);
    nonroot = root = null;
    var fileList = document.getElementById('file-list');
    fileList.textContent = '';
    fileList.appendChild(output);

    checkAndApplyFilter();

    // Render number of files of the following generic types:
    Object.keys(genericTypeCounts).forEach(function(genericType) {
        var checkbox = document.querySelector('input[data-filter-type="' + genericType + '"]');
        var label = checkbox.parentNode;
        var counter = label.querySelector('.gcount');
        counter.textContent = genericTypeCounts[genericType];
    });
}
function getGenericType(filename) {
    // Chromium / generic / WebExtensions
    if (filename === 'manifest.json') {
        // No generic type = Don't offer any checkbox to hide it.
        return '';
    }
    var extension = filename.split('.').pop().toLowerCase();
    if (/^(js|coffee)$/.test(extension)) {
        return 'code';
    }
    if (/^(bmp|cur|gif|ico|jpe?g|png|psd|svg|tiff?|xcf|webp)$/.test(extension)) {
        return 'images';
    }
    if (/^(css|sass|less|html?|xhtml|xml)$/.test(extension)) {
        return 'markup';
    }
    if (filename.lastIndexOf('_locales/', 0) === 0) {
        return 'locales';
    }

    // Firefox add-on specific.
    // Note: package.json is not just used for Jetpack but also npm and such.
    if (filename === 'chrome.manifest' || filename === 'install.rdf' || filename === 'package.json') {
        return '';
    }
    if (/^jsm$/.test(extension)) {
        return 'code';
    }
    if (/^(xbl|xul)$/.test(extension)) {
        return 'markup';
    }
    if (/locale\/.*\.(dtd|properties)$/i.test(filename)) {
        return 'locales';
    }

    return 'misc';
}

function getMimeTypeForFilename(filename) {
    if (/^META-INF\/.*\.[ms]f$/.test(filename)) {
        // .sf and .mf are part of the signature in Firefox addons.
        // They are viewable as plain text.
        return 'text/plain';
    }
    if (/(^|\/)(AUTHORS|CHANGELOG|COPYING|INSTALL|LICENSE|NEWS|README|THANKS)$/i.test(filename)) {
        return 'text/plain';
    }
    var extension = filename.split('.').pop().toLowerCase();
    switch (extension) {
    case 'crx':
    case 'nex':
    case 'xpi':
        // Just map them to zip files because we treat it as a zip file, internally.
        return 'application/zip';
    case 'md':
        return 'text/plain';
    }
    return zip.getMimeType(filename);
}

var viewFileInfo = (function() {
    var _lastView = 0;
    var handlers = {};
    var wantRawSourceGlobalDefault = false;

    // To increase performance, intermediate results are cached
    // _cachedResult = extracted content
    // _cachedCallback = If existent, a function which renders the (cached) result.
    function viewFileInfo(entry) {
        var currentView = ++_lastView;
        if (entry._cachedCallback) {
            // If cachedCallback returns false, then nothing was rendered.
            if (entry._cachedCallback() !== false);
                return;
        }

        var mimeType = getMimeTypeForFilename(entry.filename);
        var mt = mimeType.split('/');

        var handler = handlers[mimeType] || handlers[mt[0]];
        if (!handler) {
            switch (getGenericType(entry.filename)) {
            case 'code':
            case 'markup':
            case 'locales':
                handler = handlers.text;
                break;
            case 'images':
                handler = handlers.image;
                break;
            }
        }

        if (!handler) {
            if (!confirm('No handler for ' + mimeType + ' :(\nWant to open as plain text?'))
                return;
            mimeType = 'text/plain';
            handler = handlers.text;
        }
        var callback = handler.callback;

        if (entry._cachedResult) {
            callback(entry, entry._cachedResult);
            return;
        }

        var Writer = handler.Writer;
        var writer;
        if (Writer === zip.Data64URIWriter ||
            Writer === zip.BlobWriter) {
            writer = new Writer(mimeType);
        } else {
            writer = new Writer();
        }

        entry.getData(writer, function(result) {
            entry._cachedResult = result;
            if (_lastView !== currentView) {
                console.log('Finished reading file, but another file was opened!');
                return;
            }
            callback(entry, result, function(callbackResult) {
                if (callbackResult && typeof callbackResult !== 'function') {
                    throw new Error('callbackResult exists and is not a function!');
                }
                entry._cachedCallback = function() {
                    saveScroll();
                    if (callbackResult) callbackResult();
                    restoreScroll(entry.filename);
                    return typeof callbackResult == 'function';
                };
                // Final callback = thing has been rendered for the first time,
                // or something like that.
                saveScroll();
                restoreScroll(entry.filename);
            });
        }, function(current, total) {
            // Progress, todo
        });
    }
    handlers['application/vnd.mozilla.xul+xml'] =
    handlers['application/javascript'] =
    handlers['application/json'] =
    handlers['application/rdf+xml'] =
    handlers['application/xhtml+xml'] =
    handlers['application/xml-dtd'] =
    handlers.text = {
        Writer: EfficientTextWriter,
        callback: function(entry, text, finalCallback) {
            var sourceCodeElem = document.getElementById('source-code');
            var heading = document.createElement('div');
            heading.className = 'file-specific-toolbar';

            heading.appendChild(createDownloadLink(entry));

            var goToLineButton = document.createElement('button');
            goToLineButton.textContent = 'Go to line';
            goToLineButton.onclick = function() {
                showGoToLine(sourceCodeElem, preCurrent);
            };
            heading.appendChild(goToLineButton);

            heading.insertAdjacentHTML('beforeend',
                '<button class="find-prev" title="Find previous">&#9650;</button>' +
                '<button class="find-next" title="Find next">&#9660;</button>' +
                '<button class="find-all" title="Highlight all">All</button>' +
                '');

            var textBeauty;
            var searchEngine;
            heading.querySelector('.find-prev').onclick = function() {
                searchEngine.setQuery(textSearchEngine.getCurrentSearchTerm());
                searchEngine.findPrev();
            };
            heading.querySelector('.find-next').onclick = function() {
                searchEngine.setQuery(textSearchEngine.getCurrentSearchTerm());
                searchEngine.findNext();
            };
            heading.querySelector('.find-all').onclick = function() {
                searchEngine.setQuery(textSearchEngine.getCurrentSearchTerm());
                searchEngine.highlightAll();
            };
            heading.querySelector('.find-all').ondblclick = function() {
                // TODO: Remove dblclick. The button should be a toggle,
                // and the highlight should update automatically when the query
                // changes.
                searchEngine.setQuery(textSearchEngine.getCurrentSearchTerm());
                searchEngine.unhighlightAll();
            };
            function enableFind(enabled) {
                heading.querySelector('.find-next').disabled =
                heading.querySelector('.find-prev').disabled =
                heading.querySelector('.find-all').disabled =
                    !enabled;
            }
            // Disable find by default because 1) there is initially no content
            // (<ol>). and 2) the search engine is unavailable in old browsers.
            enableFind(false);

            // TODO: Keep buttons in sync with engine? (search as you type)

            // TODO: Add counter of total search results.

            var onPreRendered = function(pre) {
                if (sourceCodeElem.firstChild !== heading || pre !== preCurrent) {
                    // While asynchronously generating the content for the pre
                    // element, the user switched to another element, or the
                    // user toggled the beautify option..
                    // Do nothing for now. When the user switches back,
                    // onPreRendered will be called again via a call to
                    // doRenderSourceCodeViewer.
                    return;
                }
                var list = pre.querySelector('ol');
                console.assert(list, '<pre> should contain <ol>');
                if (!searchEngine) {
                    if (typeof SearchEngineElement === 'undefined') {
                        console.warn('search-tools.js failed to load. In-file search not available.');
                        return;
                    }
                    if (pre === preRaw) {
                        searchEngine = new SearchEngineElement(text);
                    } else { // pre === preBeauty
                        searchEngine = new SearchEngineElement(textBeauty);
                    }
                    enableFind(true);
                }
                searchEngine.setElement(list);
            };

            var preRaw = document.createElement('pre');
            var preBeauty = document.createElement('pre');
            var preCurrent; // The currently selected <pre>.
            var type = beautify.getType(entry.filename);
            if (type) {
                var toggleBeautify = document.createElement('button');
                toggleBeautify.title = 'Click on this button to toggle between beautified code and non-beautified (original) code.';
                var selectPre = function(pre) {
                    preCurrent = pre;
                    if (pre === preRaw) {
                        toggleBeautify.textContent = 'Show beautified code';
                    } else {
                        toggleBeautify.textContent = 'Show original code';
                    }
                    if (pre._didInitializeSourceViewer) return;
                    pre._didInitializeSourceViewer = true;
                    if (pre === preRaw) {
                        viewTextSource(text, entry.filename, preRaw, onPreRendered);
                        return;
                    }
                    beautify({
                        text: text,
                        type: type,
                        wrap: 0
                    }, function(text) {
                        textBeauty = text;
                        viewTextSource(text, entry.filename, preBeauty, onPreRendered);
                    });
                };
                toggleBeautify.onclick = function() {
                    // Note: Toggling the state is based on the local preCurrent
                    // variable instead of `!wantRawSourceGlobalDefault` because
                    // the two may differ when the user switches to a different
                    // file and modifies toggles the beautifier in that file.
                    wantRawSourceGlobalDefault = preCurrent !== preRaw;
                    if (searchEngine) {
                        searchEngine.destroy();
                        searchEngine = null;
                        enableFind(false);
                    }
                    selectPre(wantRawSourceGlobalDefault ? preRaw : preBeauty);
                    doRenderSourceCodeViewer();
                };
                heading.appendChild(toggleBeautify);

                // Use the last selected option for new views.
                // Note: This state only changes when the user clicks on the
                // `toggleBeautify` button, not when they change the file view.
                selectPre(wantRawSourceGlobalDefault ? preRaw : preBeauty);
            } else {
                preCurrent = preRaw;
                viewTextSource(text, entry.filename, preRaw, onPreRendered);
            }
            doRenderSourceCodeViewer();

            function doRenderSourceCodeViewer() {
                if (sourceCodeElem.firstChild !== heading) {
                    // Switched from another view.
                    sourceCodeElem.textContent = '';
                    sourceCodeElem.appendChild(heading);
                }
                var lastPre = sourceCodeElem.lastChild;
                if (lastPre !== preCurrent) {
                    if (lastPre == preRaw || lastPre == preBeauty) {
                        // Last element is a <pre>, but not matching
                        // the desired <pre>. So remove the existing
                        // pre before appending the desired pre,
                        lastPre.remove();
                    }
                    sourceCodeElem.appendChild(preCurrent);
                    if (preCurrent.firstChild) {
                        onPreRendered(preCurrent);
                    }
                }
            }

            finalCallback(doRenderSourceCodeViewer);
        }
    };
    handlers.image = {
        Writer: zip.Data64URIWriter,
        callback: function(entry, data_url) {
            var sourceCodeElem = document.getElementById('source-code');
            sourceCodeElem.innerHTML = '<img>';
            sourceCodeElem.firstChild.src = data_url;
        }
    };
    handlers['application/java-archive'] =
    handlers['application/zip'] = {
        Writer: zip.BlobWriter,
        callback: function(entry, blob) {
            var viewerUrl = 'crxviewer.html';
            var blob_url = URL.createObjectURL(blob);
            if (getParam('crx') === window.crx_url && window.crx_url) {
                // The URL parameters are probably reliable (=describing the zip), so use it.
                var inside = getParam('inside[]');
                inside.push(entry.filename);
                viewerUrl += '?' + encodeQueryString({
                    // Pass these parameters in case the blob URL disappears.
                    crx: window.crx_url,
                    inside: inside,
                    // Allow the viewer to re-use our cached blob.
                    blob: blob_url,
                });
            } else {
                viewerUrl += '?' + encodeQueryString({
                    blob: blob_url,
                    zipname: entry.filename,
                });
            }

            var sourceCodeElem = document.getElementById('source-code');
            sourceCodeElem.innerHTML = '<button>View the content of this file in a new CRX Viewer</button>';
            sourceCodeElem.firstChild.onclick = function() {
//#if FIREFOX
                // window.open is broken, so use chrome.tabs.create: bugzil.la/1288901.
                chrome.tabs.create({url: viewerUrl});
//#else
                window.open(viewerUrl);
//#endif
            };
        }
    };

    // Render `text` in the given pre tag. The pre element should be blank,
    // i.e. the caller should create it and not add any attributes or content.
    // onPreRendered is called when the content (`<ol>`) has been rendered.
    function viewTextSource(text, filename, pre, onPreRendered) {
        pre.className = 'linenums auto-wordwrap';
        var lineCount = text.match(/\n/g);
        lineCount = lineCount ? lineCount.length + 1 : 1;
        // Calculate max width of counters:
        var lineCountExp = Math.floor( Math.log(lineCount)/Math.log(10) ) + 1;
        pre.className += ' linenumsltE' + lineCountExp;
        
        // Auto-highlight for <30kb source
        if (text.length < 3e4) {
            pre.innerHTML = Prism.rob.highlightSource(text, filename);
            onPreRendered(pre);
        } else {
            var startTag = '<li>';
            var endTag = '</li>';
            pre.innerHTML =
                '<ol>' +
                startTag +
                escapeHTML(text).replace(/\n/g, endTag+startTag) +
                endTag +
                '</ol>';
            Prism.rob.highlightSourceAsync(text, filename, function(html) {
                pre.innerHTML = html;
                onPreRendered(pre);
            });
            onPreRendered(pre);
        }
    }
    var scrollingOffsets = {};
    // identifier = filename, for example
    function saveScroll(identifier) {
        var sourceCodeElem = document.getElementById('source-code');
        if (!identifier) identifier = sourceCodeElem.dataset.filename;
        else sourceCodeElem.dataset.filename = identifier;
        if (!identifier) return;
        scrollingOffsets[identifier] = sourceCodeElem.scrollTop;
    }
    function restoreScroll(identifier) {
        var sourceCodeElem = document.getElementById('source-code');
        if (!identifier) identifier = sourceCodeElem.dataset.filename;
        else sourceCodeElem.dataset.filename = identifier;
        sourceCodeElem.scrollTop = scrollingOffsets[identifier] || 0;
    }
    function createDownloadLink(entry) {
        var mimeType = getMimeTypeForFilename(entry.filename);
        var filename = entry.filename.split('/').pop();

        var a = document.createElement('a');
        a.className = 'file-specific-download-link';
        a.textContent = 'Show download';
        a.title = 'Download ' + entry.filename + ' (' + formatByteSize(entry.uncompressedSize) + ' bytes, type ' + mimeType + ')';
        a.onclick = function() {
            a.onclick = null;
            a.textContent = 'Generating link...';
            entry.getData(new zip.BlobWriter(mimeType), function(blob) {
                a.download = filename;
                a.textContent = 'Download file';
                a.href = URL.createObjectURL(blob);
            });
        };
        return a;
    }
    function showGoToLine(sourceCodeElem, preCurrent) {
        var ol = preCurrent.querySelector('ol');
        if (!ol) {
            // When the source is beautified asynchronously,
            // initially the <ol> does not exist yet.
            alert('Not ready yet, wait until the source is shown');
            return;
        }
        var lineCount = ol.childElementCount;
        var lineInput = prompt('Enter a line to jump to (max ' + lineCount + ')', '');
        // Converting to Number first to avoid '123bogus' -> 123.
        var line = parseInt(Number(lineInput));
        if (isNaN(line) || line <= 0) {
            if (lineInput !== null) {
                alert('Line number must be an integer between 1 and ' + lineCount + ', but got "' + lineInput + '"!');
            }
            return;
        }
        // While the dialog was shown, the asynchronous highlighter might
        // have overwritten the displayed list, so fetch the new list.
        ol = preCurrent.querySelector('ol');
        lineCount = ol.childElementCount;
        if (line > lineCount) {
            var msg = 'Line ' + line + ' not found.\n' +
                'This file has ' + lineCount + ' lines.\n' +
                'Want to go to the last line?';
            if (confirm(msg)) {
                sourceCodeElem.scrollTop = sourceCodeElem.scrollHeight;
            }
            return;
        }
        // Note: offsetTop is relative to the nearest positioned container.
        // As of writing, the nearest such container is <body>, so the
        // following centers the line relative to the viewport.
        // We will center the line approximately above the center of the page.
        var li = ol.children[line - 1];
        sourceCodeElem.scrollTop = li.offsetTop + li.offsetHeight - sourceCodeElem.offsetHeight / 2;
        li.style.outline = '2px solid red';
        setTimeout(function() {
            li.style.outline = '';
        }, 1000);
    }
    return viewFileInfo;
})();

var textSearchEngine;  // Initialized as soon as we have a zip file.
var TextSearchEngine = (function() {
    // A text search engine. It is guaranteed to report a result for every entry in the zip file.
    // When a new search is started before the previous search completes, no old search results will
    // appear again.
    function TextSearchEngine(zipBlob) {
        // Lazily initialize the worker.
        Object.defineProperty(this, 'worker', {
            configurable: true,
            enumerable: true,
            get: function() {
                var worker = initializeWorker(this);
                worker.postMessage({
                    zipBlob: zipBlob,
                });
                delete this.worker;
                this.worker = worker;
                return worker;
            },
        });
        /**
         * Called twice for every new search. First with null, and then again with true or false.
         *
         * @callback resultCallback
         * @param {string|null} filename The filename of the result. null for all files.
         * @param {boolean|null} found true if found, false if not found, null if unknown.
         */
        this.resultCallback = null;
        this._currentSearchTerm = '';
        this._currentSearchStart = 0;
        this._recentSearchResults = {
            // This is often identical to this._currentSearchTerm, except the latter may become an
            // empty string, whereas this is not. This allows known-good search results to be
            // supplied much faster.
            searchTerm: '',
            found: [],
            notfound: [],
        };
    }

    TextSearchEngine.prototype.setResultCallback = function(resultCallback) {
        this.resultCallback = resultCallback;
    };

    /**
     * @returns {RegExp|null} The current search term, as a RegExp.
     *     null if there there is no search query.
     */
    TextSearchEngine.prototype.getCurrentSearchTerm = function() {
        // Keep this search term parsing logic in sync with search-worker.js.
        var searchTerm = this._currentSearchTerm;
        if (searchTerm.lastIndexOf('regexp:', 0) === 0) {
            // Assuming a valid RegExp
            searchTerm = new RegExp(searchTerm.slice(7), 'i');
        } else if (searchTerm) {
            searchTerm = searchTerm.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
            searchTerm = new RegExp(searchTerm, 'i');
        } else {
            searchTerm = null;
        }
        return searchTerm;
    };

    /**
     * @param {string} searchTerm A case-insensitive search query.
     * @param {Array<string>} lowPrioFilenames List of files that the caller is not really
     *     interested in, e.g. because the files are hidden anyway.
     */
    TextSearchEngine.prototype.doPlaintextSearch = function(searchTerm, lowPrioFilenames) {
        if (!this.resultCallback) {
            console.warn('Ignored search request because the result handler was not set.');
            return;
        }
        searchTerm = searchTerm.toLocaleLowerCase();
        if (this._currentSearchTerm === searchTerm) {
            return; // No change in result.
        }
        if (!searchTerm) {
            this._currentSearchTerm = '';
            this.worker.postMessage({
                searchTerm: '',
            });
            // No search term = every file matches.
            this.resultCallback(null, true);
            return;
        }
        this.resultCallback(null, null); // Should not call doPlaintextSearch again.

        // Re-use the last search results if possible.
        if (this._recentSearchResults.searchTerm.indexOf(searchTerm) !== -1) {
            // E.g. "test" -> "tes". If the result contained "test" then it also includes "tes".
            lowPrioFilenames = mergeUnique(lowPrioFilenames, this._recentSearchResults.found);
            this.resultCallback(this._recentSearchResults.found, true);
        } else if (searchTerm.indexOf(this._recentSearchResults.searchTerm) !== -1) {
            // E.g. "tes" -> "test". If the result did not contain "tes" then it will not contain
            // "test" either.
            lowPrioFilenames = mergeUnique(lowPrioFilenames, this._recentSearchResults.notfound);
            this.resultCallback(this._recentSearchResults.notfound, false);
        }
        this._recentSearchResults.searchTerm = searchTerm;
        this._recentSearchResults.found.length = 0;
        this._recentSearchResults.notfound.length = 0;

        this._currentSearchTerm = searchTerm;
        this._currentSearchStart = Date.now();
        this.worker.postMessage({
            searchTerm: searchTerm,
            lowPrioFilenames: lowPrioFilenames,
        });
    };

    // Stably merge two arrays, ignoring duplicate entries from the second array.
    function mergeUnique(a, b) {
        var merged = a.slice();
        // a is probably not large, in the worst case thousands, so this algorithm should be fine.
        for (var i = 0; i < b.length; ++i) {
            if (a.indexOf(b[i]) === -1) {
                merged.push(b[i]);
            }
        }
        return merged;
    }

    function initializeWorker(textSearchEngine) {
        var worker = new Worker('search-worker.js');
        worker.addEventListener('message', function(event) {
            var message = event.data;
            if (message.searchTerm !== textSearchEngine._currentSearchTerm) {
                return;
            }
            if (message.found.length) {
                textSearchEngine._recentSearchResults.found =
                    textSearchEngine._recentSearchResults.found.concat(message.found);
                textSearchEngine.resultCallback(message.found, true);
            }
            if (message.notfound.length) {
                textSearchEngine._recentSearchResults.notfound =
                    textSearchEngine._recentSearchResults.notfound.concat(message.notfound);
                textSearchEngine.resultCallback(message.notfound, false);
            }
            if (message.remaining === 0) {
                // This is the time spent on waiting until the zip file is extracted (first time
                // only) and busy main thread (e.g. updating the UI).
                var totalTime = Date.now() - textSearchEngine._currentSearchStart;
                console.log('Query finished in ' + message.querytime + 'ms' +
                        (totalTime > 10 ? ' (' + totalTime + 'ms total)' : '') +
                        ' for ' + message.searchTerm);
            }
        });
        return worker;
    }

    return TextSearchEngine;
})();

function escapeHTML(string, useAsAttribute) {
    string = string
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    if (useAsAttribute)
        string = string
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    return string;
}


function renderPanelResizer() {
    var leftPanel = document.getElementById('left-panel');
    var rightPanel = document.getElementById('right-panel');
    var resizer = document.createElement('div');
    var rightPanelPadding = parseFloat(getComputedStyle(rightPanel).paddingLeft);
    rightPanelPadding = (rightPanelPadding - leftPanel.offsetWidth) || 0;
    var oldX;
    var width;
    var TOGGLED_CLASS = 'toggled';

    var toggler = document.createElement('div');
    toggler.className = 'toggler';
    toggler.addEventListener('click', function(e) {
        e.stopPropagation();
        leftPanel.classList.toggle(TOGGLED_CLASS);
    });
    rightPanel.classList.add('toggleable');

    resizer.className = 'resizer';
    resizer.addEventListener('mousedown', function(e) {
        if (leftPanel.classList.contains(TOGGLED_CLASS)) return;
        e.preventDefault();
        oldX = e.clientX;
        width = leftPanel.offsetWidth;
        window.addEventListener('mousemove', resizeHandler);
        window.addEventListener('mouseup', function(e) {
            window.removeEventListener('mousemove', resizeHandler);
        });
    });
    resizer.appendChild(toggler);
    leftPanel.appendChild(resizer);

    function resizeHandler(e) {
        var newWidth = width + (e.clientX - oldX);
        if (newWidth < 0) {
            if (width > 0)
                newWidth = 0;
            else
                return;
        }
        leftPanel.style.width = newWidth + 'px';
        rightPanel.style.paddingLeft = (newWidth + rightPanelPadding) + 'px';
    }
}

var checkAndApplyFilter = (function() {
    var filteredFilenames = [];
    // Filter for file names
    function applyFilter(/*regex*/pattern) {
        var CLASS_FILTERED = 'file-filtered';
        var fileList = document.getElementById('file-list');
        var listItems = fileList.querySelectorAll('li');
        filteredFilenames.length = 0;
        for (var i = 0; i < listItems.length; ++i) {
            var listItem = listItems[i];
            var filename = listItem.dataset.filename;
            if (pattern.test(filename)) {
                listItem.classList.remove(CLASS_FILTERED);
            } else {
                listItem.classList.add(CLASS_FILTERED);
                filteredFilenames.push(filename);
            }
        }
    }
    // Filter on files containing |searchTerm|. See search-worker.js for the algorithm.
    function grepSearch(searchTerm) {
        if (!textSearchEngine) {
            return;
        }
        textSearchEngine.setResultCallback(function(filenames, found) {
            var listItems = document.querySelectorAll('#file-list li');
            for (var i = 0; i < listItems.length; ++i) {
                var listItem = listItems[i];
                if (filenames !== null && filenames.indexOf(listItem.dataset.filename) === -1) {
                    continue;
                }
                listItem.classList.toggle('grep-unknown', found === null);
                listItem.classList.toggle('grep-no-match', found === false);
            }
        });
        textSearchEngine.doPlaintextSearch(searchTerm, filteredFilenames);
    }
    var debounceGrep;
    function checkAndApplyFilter(shouldDebounce) {
        var fileFilterElem = document.getElementById('file-filter');
        var feedback = document.getElementById('file-filter-feedback');
        var pattern = fileFilterElem.value;
        var grepTerm = '';

        // Allow ! to be escaped if a user really wants to look for a ! in the filename.
        var i = -1;
        exclamation_search_loop: while ((i = pattern.indexOf('!', i + 1)) != -1) {
            // (?! is a negative look-ahead, don't treat it as a search either.
            if (pattern.substring(i - 2, i) != '(?') {
                // Allow '!' to be escaped. Note that in a RegExp, '\!' is identical to '!', so we
                // don't have to worry about changing semantics by requiring ! to be escaped to
                // disable search.
                for (var j = i; j > 0 && pattern.charAt(j - 1) === '\\'; --j);
                if ((j - i) % 2 === 0) {
                    // An unescaped !. Let's treat this as the delimiter for grep.
                    grepTerm = pattern.slice(i + 1);
                    pattern = pattern.slice(0, i);
                    break exclamation_search_loop;
                }
            }
        }

        try {
            pattern = new RegExp(pattern, 'i');
            feedback.textContent = '';
            fileFilterElem.classList.remove('invalid');
        } catch (e) {
            fileFilterElem.classList.add('invalid');
            // Strip Regexp, the user can see it themselves..
            // Invalid regular expression: /..pattern.../ : blablabla
            feedback.textContent = (e.message+'').replace(': /' + pattern + '/', '');
            return;
        }
        
        // Validate the grep pattern here to make sure that we don't apply the filter if the
        // pattern is invalid.
        if (grepTerm.lastIndexOf('regexp:', 0) === 0) {
            var grepTermPattern = grepTerm.slice(7);
            try {
                new RegExp(grepTermPattern, 'i');
                feedback.textContent = '';
                fileFilterElem.classList.remove('invalid');
            } catch (e) {
                fileFilterElem.classList.add('invalid');
                feedback.textContent = 'Search: ' + (e.message+'').replace(': /' + grepTermPattern + '/', '');
                return;
            }
        }
        applyFilter(pattern);

        clearTimeout(debounceGrep);
        if (shouldDebounce && !debounceGrep) {
            debounceGrep = setTimeout(function() {
                debounceGrep = null;
                grepSearch(grepTerm);
            }, 300);
        } else {
            debounceGrep = null;
            grepSearch(grepTerm);
        }
    }
    (function() {
        // Bind to checkbox filter
//#if CHROME || OPERA
        var storageArea = chrome.storage.sync || chrome.storage.local;
//#endif

        var FILTER_STORAGE_PREFIX = 'filter-';
        var fileList = document.getElementById('file-list');
        var checkboxes = document.querySelectorAll('input[data-filter-type]');

//#if !CHROME && !OPERA
        if (!checkboxes.length) return;
        // In Firefox, checkbox elements don't respect width/height style for checkbox.
        // Resize it if needed.
        var checkbox = checkboxes[0];
        var elementOnSameLine = checkbox.parentNode.querySelector('.gcount');
        var actualHeight = checkbox.getBoundingClientRect().height;
        var expectedHeight = elementOnSameLine.getBoundingClientRect().height;
        var scaleFactor = 1;
        if (actualHeight && expectedHeight && actualHeight !== expectedHeight) {
            scaleFactor = expectedHeight / actualHeight;
        }
//#endif
        [].forEach.call(checkboxes, function(checkbox) {
//#if !CHROME && !OPERA
            if (scaleFactor !== 1) {
                checkbox.style.transformOrigin = '0 0';
                checkbox.style.transform = 'scale(' + scaleFactor + ')';
            }
//#endif
            var storageKey = FILTER_STORAGE_PREFIX + checkbox.dataset.filterType;
            checkbox.checked = localStorage.getItem(storageKey) !== '0';
            checkbox.onchange = function() {
//#if CHROME || OPERA
                var items = {};
                items[storageKey] = checkbox.checked;
                storageArea.set(items);
//#else
                localStorage.setItem(storageKey, checkbox.checked ? '1' : '0');
//#endif
                updateFileListView();
            };
//#if CHROME || OPERA
                storageArea.get(storageKey, function(items) {
                    checkbox.checked = items[storageKey] !== false;
                    updateFileListView();
                });
//#else
                localStorage.setItem(storageKey, checkbox.checked ? '1' : '0');
                updateFileListView();
//#endif
            function updateFileListView() {
                fileList.classList.toggle('gfilter-' + checkbox.dataset.filterType, !checkbox.checked);
            }
        });
    })();
    // Bind event
    var fileFilterElem = document.getElementById('file-filter');
    fileFilterElem.addEventListener('input', function() {
        checkAndApplyFilter(true);
    });
    fileFilterElem.form.onsubmit = function(e) {
        e.preventDefault();
        checkAndApplyFilter();
    };

    return checkAndApplyFilter;
})();
// Go load the stuff
initialize();
function initialize() {
    if (getParam('noview')) {
        showAdvancedOpener();
        return;
    }
    var crx_url = getParam('crx');
    var blob_url = getParam('blob');
    if (!crx_url && !blob_url) {
        showAdvancedOpener();
        return;
    }
    var webstore_url = crx_url && get_webstore_url(crx_url);
    // Only consider rewriting the URL if it is not a known webstore download, because
    // the get_crx_url method only takes the extension ID and generates the other
    // parameters based on the current platform.
    if (!cws_download_pattern.test(crx_url)) {
        if (cws_pattern.test(crx_url)) {
            // Prefer given URL because its slug contains an extra human-readable short name.
            webstore_url = crx_url;
        }
        if (webstore_url) {
            // This is a no-op if the URL is not recognized.
            crx_url = get_crx_url(webstore_url);
        }
    }
    if (webstore_url) {
        var webstore_link = document.getElementById('webstore-link');
        webstore_link.href = webstore_url;
        webstore_link.title = webstore_url;
    }
    var inside = getParam('inside[]');
    var zipname = getParam('zipname');

    // blob:-URL without inside parameter = looking inside an (embedded) zip file for which we don't
    // have a URL, e.g. a file selected via <input type=file>
    if (!inside.length && blob_url) {
        loadCachedUrlInViewer(blob_url, crx_url || zipname || blob_url, function(blob) {
            openCRXinViewer(crx_url, zipname, blob);
        }, function() {
            if (crx_url) {
                openCRXinViewer(crx_url, zipname);
            } else {
                var progressDiv = document.getElementById('initial-status');
                progressDiv.textContent = 'Cannot open ' + (zipname || blob_url);
                appendFileChooser();
            }
        });
        return;
    }
    if (crx_url && inside.length) {
        openEmbeddedZipFile(crx_url, inside, blob_url);
        return;
    }

    // Plain and simple: Open the CRX at the given URL.
    openCRXinViewer(crx_url, zipname);
}

function showAdvancedOpener() {
    var advancedOpenView = document.getElementById('advanced-open');
    var openForm = document.getElementById('advanced-open-form');
    var cwsOptions = document.getElementById('advanced-open-cws-extension');
    var urlInput = openForm.querySelector('input[type=url]');
    var fileInput = openForm.querySelector('input[type=file]');
    function getCwsOption(name) {
        var input = cwsOptions.querySelector('input[name="' + name + '"]');
        if (input && input.type == 'text') {
            return input.value;
        }
        input = cwsOptions.querySelector('input[name="' + name + '"]:checked');
        return input ? input.value : '';
    }
    function setCwsOption(name, value) {
        var input = cwsOptions.querySelector('input[name="' + name + '"]');
        if (input && input.type == 'text') {
            input.value = value;
            return;
        }
        // Otherwise a radio element.
        var choice = cwsOptions.querySelector('input[name="' + name + '"][value="' + value  + '"');
        if (choice) {
            choice.checked = true;
        } else if (input) {
            console.warn('No element found for option ' + name + ' and value ' + value + ', fall back to first option');
            input.checked = true;
        } else {
            console.warn('No element found for option ' + name + ' and value ' + value + ', ignored.');
        }
    }
    function toCwsUrl() {  // Assuming that all inputs are valid.
        // See cws_pattern.js for an explanation of this URL.
        var url = 'https://clients2.google.com/service/update2/crx?response=redirect';
        url += '&os=' + getCwsOption('os');
        url += '&arch=' + getCwsOption('arch');
        url += '&nacl_arch=' + getCwsOption('nacl_arch');
        url += '&prod=chromiumcrx';
        url += '&prodchannel=unknown';
        url += '&prodversion=' + getCwsOption('prodversion');
        url += '&x=id%3D' + getCwsOption('xid');
        url += '%26uc';
        return url;
    }
    function maybeToggleWebStore() {
        var extensionId = get_extensionID(urlInput.value);
        if (!extensionId) {
            cwsOptions.classList.add('disabled-cws');
            return;
        }
        function setOptionFromUrl(key) {
            var prev = getCwsOption(key);
            var next = getParam(key, urlInput.value);
            if (next && prev !== next) {
                setCwsOption(key, next);
            }
        }
        cwsOptions.classList.remove('disabled-cws');
        setCwsOption('xid', extensionId);
        setOptionFromUrl('os');
        setOptionFromUrl('arch');
        setOptionFromUrl('nacl_arch');
    }
    function maybeSaveBack() {
        var isExtensionId = /^[a-p]{32}$/.test(getCwsOption('xid'));
        cwsOptions.querySelector('.submit-if-valid').hidden = !isExtensionId;
        if (!isExtensionId) {
            return;
        }

        // Only synchronize if there is no information to be lost, e.g. if it is not a URL or
        // already a Chrome Web Store item.
        var crx_url = toCwsUrl();
        if (!/^https:?/.test(urlInput.value) || get_extensionID(urlInput.value)) {
            urlInput.value = crx_url;
        }
        cwsOptions.querySelector('.submit-if-valid a').href = get_webstore_url(crx_url);
    }
    function toggleForm(enable) {
        if (enable) {
            cwsOptions.classList.add('focused-form');
        } else {
            cwsOptions.classList.remove('focused-form');
        }
    }

    openForm.onsubmit = function(e) {
        e.preventDefault();
        if (!urlInput.value) {
            if (fileInput.files[0]) {
                // Navigate back in history or just reloaded page.
                fileInput.onchange();
            }
            return;
        }
        var url = location.pathname + '?' + encodeQueryString({
            crx: urlInput.value,
        });
        advancedOpenView.classList.remove('visible');
        // This open dialog only appears at the start of the page, and there is
        // no data to lose, so we just replace the current URL.
        history.replaceState(history.state, null, url);
        initialize();
    };
    cwsOptions.onsubmit = function(e) {
        e.preventDefault();
        // Note: let's assume that the extension ID is valid, otherwise form validation would have
        // kicked in. This is not necessarily true in old browsers, but whatever.
        urlInput.value = toCwsUrl();
        openForm.onsubmit(e);
    };
    fileInput.onchange = function() {
        var file = fileInput.files[0];
        if (file) {
            advancedOpenView.classList.remove('visible');
            openCRXinViewer('', file.name, file);
        }
    };

    [].forEach.call(cwsOptions.querySelectorAll('input'), function(input) {
        // Sync back changes when radio / text input changes
        input.addEventListener('input', maybeSaveBack);
        input.addEventListener('change', maybeSaveBack);
        input.addEventListener('focus', toggleForm.bind(null, true));
        input.addEventListener('blur', toggleForm.bind(null, false));
    });
    urlInput.addEventListener('input', maybeToggleWebStore);
    urlInput.value = getParam('crx') || '';

    // Render default webstore options.
    var platformInfo = getPlatformInfo();
    setCwsOption('os', platformInfo.os);
    setCwsOption('arch', platformInfo.arch);
    setCwsOption('nacl_arch', platformInfo.nacl_arch);
    var prodversion = /Chrome\/(\d+\.\d+\.\d+\.\d+)/.exec(navigator.userAgent);
    prodversion = prodversion ? prodversion[1] : '52.0.2743.116';
    setCwsOption('prodversion', prodversion);

    maybeToggleWebStore();

    advancedOpenView.classList.add('visible');
}

// |crx_url| is the canonical representation (absolute URL) of the zip file.
// |inside| is the path to the file that we want to open. Every extra item is another level inside
// the zip file, e.g. ['foo.jar','bar.zip'] is the "bar.zip" file inside "foo.jar" inside |crx_url|.
// The list must contain at least one item.
// |blob_url| is the (ephemeral) URL of the Blob, used if possible.
function openEmbeddedZipFile(crx_url, inside, blob_url) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;

    var zipname = inside[inside.length - 1];

    loadCachedUrlInViewer(blob_url, zipname, function(blob) {
        openCRXinViewer(crx_url, zipname, blob);
    }, function() {
        progressDiv.textContent = 'Loading ' + zipname;
        loadUrlInViewer(crx_url, function(blob) {
            peekIntoZipUntilEnd(0, blob);
        });
    });

    function peekIntoZipUntilEnd(index, blob) {
        var human_readable_name = inside.slice(0, index + 1).reverse().join(' in ') + ' from ' + crx_url;
        var zipname = inside[index];

        zip.createReader(new zip.BlobReader(blob), function(zipReader) {
            zipReader.getEntries(function(entries) {
                var entry = entries.filter(function(entry) {
                    return entry.filename === zipname;
                })[0];
                if (!entry) {
                    progressDiv.textContent = 'Cannot open (did not find) ' + human_readable_name;
                    zipReader.close();
                    return;
                }
                entry.getData(new zip.BlobWriter(), function(blob) {
                    zipReader.close();
                    if (++index < inside.length) {
                        peekIntoZipUntilEnd(index, blob);
                    } else {
                        openCRXinViewer(crx_url, zipname, blob);
                    }
                }, function() {
                    progressDiv.textContent = 'Cannot read ' + human_readable_name;
                    zipReader.close();
                });
            });
        });
    }
}

function appendFileChooser() {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.insertAdjacentHTML('beforeend',
            '<br><br>' +
//#if !WEB
            'Visit the Chrome Web Store, Opera\'s or Firefox\'s add-on gallery<br>' +
            'and click on the CRX button to view its source.' +
            '<br><br>Or select a .crx/.nex/.xpi/.zip file:' +
//#else
            'Select a .crx/.nex/.xpi/.zip file:' +
//#endif
            '<br><br>');
    var fileChooser = document.createElement('input');
    fileChooser.type = 'file';
    fileChooser.onchange = function() {
        var file = fileChooser.files[0];
        if (file) openCRXinViewer('', file.name, file);
    };
    progressDiv.appendChild(fileChooser);
}

// crx_url: full URL to CRX file, may be an empty string.
// zipname: Preferred file name.
// crx_blob: Blob of the zip file.
// One (or both) of crx_url or crx_blob must be set.
function openCRXinViewer(crx_url, zipname, crx_blob) {
    // Now we have fixed the crx_url, update the global var.
    window.crx_url = crx_url;
    zipname = get_zip_name(crx_url, zipname);

    // We are switching from the initial view (selecting an extenzion/zip)
    // to the next view (showing the contents of the extension/zip file).
    // Show a link to open a new CRX Viewer, prepopulated with the current
    // settings to allow the user to modify one bit of the download.
    setCrxViewerLink(crx_url);

    if (crx_blob) {
        if (crx_url && is_not_crx_url(crx_url)) {
            handleBlob(zipname, crx_blob, null, null);
            return;
        }
        loadBlobInViewer(crx_blob, crx_url || zipname, function(blob, publicKey, raw_crx_data) {
            handleBlob(zipname, blob, publicKey, raw_crx_data);
        });
        return;
    }
    loadUrlInViewer(crx_url, function(blob, publicKey, raw_crx_data) {
        handleBlob(zipname, blob, publicKey, raw_crx_data);
    });
}

function loadCachedUrlInViewer(blob_url, human_readable_name, onHasBlob, onHasNoBlob) {
    if (!/^blob:/.test(blob_url)) {
        onHasNoBlob();
        return;
    }
    loadNonCrxUrlInViewer(blob_url, human_readable_name, onHasBlob, onHasNoBlob);
}

function loadNonCrxUrlInViewer(url, human_readable_name, onHasBlob, onHasNoBlob) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.textContent = 'Loading ' + human_readable_name;

    var requestUrl = url;
//#if WEB
    if (/^https?:/.test(url)) {
        // Proxy request through CORS Anywhere.
        requestUrl = 'https://cors-anywhere.herokuapp.com/' + url;
    }
//#endif
    try {
        var x = new XMLHttpRequest();
        x.open('GET', requestUrl);
        x.responseType = 'blob';
        x.onerror = function() {
            onHasNoBlob('Network error for ' + url);
        };
        x.onload = function() {
            if (x.response && x.response.size) {
                onHasBlob(x.response);
            } else {
                onHasNoBlob('No response received for ' + url);
            }
        };
        x.send();
    } catch (e) {
        onHasNoBlob('The browser refused to load ' + url + ', ' + e);
    }
}

function loadBlobInViewer(crx_blob, human_readable_name, onHasBlob) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.textContent = 'Loading ' + human_readable_name;

    openCRXasZip(crx_blob, onHasBlob, function(error_message) {
        progressDiv.textContent = error_message;
        appendFileChooser();
    });
}

function loadUrlInViewer(crx_url, onHasBlob) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.textContent = 'Loading ' + crx_url;

    if (is_not_crx_url(crx_url)) {
        // If it is certainly not expected to be a CRX, don't try to load as a CRX.
        // Otherwise the user may be confused if they see CRX-specific errors.
        loadNonCrxUrlInViewer(crx_url, crx_url, onHasBlob, function(err) {
            progressDiv.textContent = err;
//#if CHROME
            maybeShowPermissionRequest();
//#endif
        });
        return;
    }

    openCRXasZip(crx_url, onHasBlob, function(error_message) {
        progressDiv.textContent = error_message;
        appendFileChooser();
//#if CHROME
        maybeShowPermissionRequest();
//#endif
    }, progressEventHandler);

//#if CHROME
    function maybeShowPermissionRequest() {
        var permission = {
            origins: ['<all_urls>']
        };
        chrome.permissions.contains(permission, function(hasAccess) {
            if (hasAccess) return;
            var grantAccess = document.createElement('button');
            var checkAccessOnClick = function() {
                chrome.permissions.request(permission, function(hasAccess) {
                    if (!hasAccess) return;
                    grantAccess.parentNode.removeChild(grantAccess);
                    loadUrlInViewer(crx_url, onHasBlob);
                });
            };
            grantAccess.onclick = checkAccessOnClick;
            progressDiv.insertAdjacentHTML('beforeend', '<br><br>' +
                'To view this extension\'s source, an extra permission is needed.<br>' +
                'This permission can be revoked at any time at the ' +
                '<a href="/options.html" target="_blank">options page</a>.<br><br>'
            );
            grantAccess.textContent = 'Add permission';
            progressDiv.appendChild(grantAccess);
        });
    }
//#endif
    function progressEventHandler(xhrProgressEvent) {
        if (xhrProgressEvent.lengthComputable) {
            var loaded = xhrProgressEvent.loaded;
            var total = xhrProgressEvent.total;
            progressDiv.textContent = 'Loading ' + crx_url;
            progressDiv.insertAdjacentHTML('beforeend', '<br><br>' +
                                           (formatByteSize(loaded) + ' / ' + formatByteSize(total)) + '<br>' +
                                           '<progress max="' + total + '" value="' + loaded + '">');
        } else {
            progressDiv.textContent = 'Loading ' + crx_url;
            progressDiv.insertAdjacentHTML('beforeend', '<br><br>' +
                                           'Loaded bytes: ' + formatByteSize(xhrProgressEvent.loaded) + ' (total size unknown)');
        }
    }
}

function handleBlob(zipname, blob, publicKey, raw_crx_data) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = true;
    
    setBlobAsDownload(zipname, blob);
    setRawCRXAsDownload(zipname, publicKey && raw_crx_data);
    if (publicKey || raw_crx_data) {
        setPublicKey(publicKey);
    }
    textSearchEngine = new TextSearchEngine(blob);

    zip.createReader(new zip.BlobReader(blob), function(zipReader) {
        renderPanelResizer();
        zipReader.getEntries(handleZipEntries);
    });
}

if (typeof URL === 'undefined') window.URL = window.webkitURL;
function setCrxViewerLink(crx_url) {
    var viewerUrl = 'crxviewer.html';

    if (crx_url) {
        viewerUrl += '?' + encodeQueryString({
            noview: 'on',
            crx: crx_url,
        });
    }

    var link = document.getElementById('open-crxviewer');
    link.href = viewerUrl;
    link.title = 'View the source of another extension or zip file';

}
function setBlobAsDownload(zipname, blob) {
    var dl_link = document.getElementById('download-link');
    dl_link.href = URL.createObjectURL(blob);
    dl_link.download = zipname;
    dl_link.title = 'Download zip file as ' + zipname + ' (' + formatByteSize(blob.size) + ' bytes)';
//#if FIREFOX
//  // If e10s is enabled, then <a download> ceases to work with blob:moz-extension-URLs.
//  // (bugzil.la/1287346). So work around this by converting the blob-URL to a data-URL.
//  if (!/Firefox\/4\d\./.test(navigator.userAgent)) return; // Fixed in Firefox 50
//  var fr = new FileReader();
//  fr.onloadend = function() {
//      dl_link.href = fr.result;
//  };
//  fr.readAsDataURL(blob);
//#endif
}
function setRawCRXAsDownload(zipname, arraybuffer) {
    var dl_link = document.getElementById('download-link-crx');
    if (!arraybuffer) {
        // Not a CRX file.
        dl_link.hidden = true;
        return;
    }
    // Use application/octet-stream to prevent Chromium from trying to install the extension.
    var blob = new Blob([arraybuffer], { type: 'application/octet-stream' });
    dl_link.href = URL.createObjectURL(blob);
    var crxname = zipname.replace(/\.zip$/i, '.crx');
    dl_link.download = crxname;
    dl_link.title = 'Download original CRX file as ' + crxname;
//#if FIREFOX
//  // If e10s is enabled, then <a download> ceases to work with blob:moz-extension-URLs.
//  // (bugzil.la/1287346). So work around this by converting the blob-URL to a data-URL.
//  if (!/Firefox\/4\d\./.test(navigator.userAgent)) return; // Fixed in Firefox 50
//  var fr = new FileReader();
//  fr.onloadend = function() {
//      dl_link.href = fr.result;
//  };
//  fr.readAsDataURL(blob);
//#endif
}
function setPublicKey(publicKey) {
    if (!publicKey) {
        console.warn('Public key not found, cannot generate "key" or extension ID.');
        return;
    }
    console.log('Public key (paste into manifest.json to preserve extension ID)');
    console.log('"key": "' + publicKey + '",');

    var extensionId = publicKeyToExtensionId(publicKey);
    console.log('Calculated extension ID: ' + extensionId);
}
function publicKeyToExtensionId(base64encodedKey) {
    var key = atob(base64encodedKey);
    var sha256sum = CryptoJS.SHA256(CryptoJS.enc.Latin1.parse(key)).toString();
    var extensionId = '';
    var ord_a = 'a'.charCodeAt(0);
    for (var i = 0; i < 32; ++i) {
        extensionId += String.fromCharCode(parseInt(sha256sum[i], 16) + ord_a);
    }
    return extensionId;
}
