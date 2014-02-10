/**
 * (c) 2013 Rob Wu <gwnRob@gmail.com>
 */

/* jshint browser:true, devel:true */
/* globals chrome, URL,
           getParam, openCRXasZip, get_zip_name, get_webstore_url,
           zip,
           beautify, prettyPrintOne,
           CryptoJS
           */

'use strict';

var crx_url = getParam('crx');

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

        // "path/to/file" -> ["path/to", "file"]
        var path = entry.filename.split(/\/(?=[^\/]+$)/);
        listItem.querySelector('.file-path').title = filename;
        listItem.querySelector('.file-name').textContent = path.pop();
        listItem.querySelector('.file-dir').textContent = path[0] || '';
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
        var counter = document.createElement('span');
        counter.className = 'gcount';
        counter.textContent = genericTypeCounts[genericType];
        checkbox.parentNode.appendChild(counter);
    });
}
function getGenericType(filename) {
    if (filename === 'manifest.json') {
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
    return 'misc';
}

var viewFileInfo = (function() {
    var _lastView = 0;
    var handlers = {};

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

        var mimeType = zip.getMimeType(entry.filename);
        var mt = mimeType.split('/');

        var handler = handlers[mimeType] || handlers[mt[0]];

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
    handlers['application/javascript'] =
    handlers['application/json'] =
    handlers['application/xhtml+xml'] =
    handlers.text = {
        Writer: zip.TextWriter,
        callback: function(entry, text, finalCallback) {
            var type = beautify.getType(entry.filename);
            if (type) {
                beautify({
                    text: text,
                    type: type,
                    wrap: 0
                }, function(text) {
                    viewTextSource(text, type, finalCallback);
                });
            } else {
                viewTextSource(text, type, finalCallback);
            }
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
    function calcWrapLength(text) {
        var textLength = text.length;

        var testElem = document.createElement('span');
        testElem.style.cssText = 'position:absolute;top:-9999px;left:-9999px;' +
                                 'padding:0;border:0;font:inherit;';
        var testText = 'Calculate character width';
        testElem.textContent = testText;

        var sourceCodeElem = document.getElementById('source-code');
        sourceCodeElem.appendChild(testElem);

        var lineWidth = sourceCodeElem.offsetWidth;
        var charPxWidth = testElem.offsetWidth / testText.length;
        var maxLineLength = Math.floor(lineWidth / charPxWidth);
        sourceCodeElem.removeChild(testElem);

        // Assume: Average line is half full
        var minLineCount = Math.ceil(textLength / maxLineLength / 2);
        // 1 space at the left, 1 dot and 1 space at the right + width of counters
        var paddingFromLineNum = Math.floor( Math.log(minLineCount)/Math.log(10) ) + 4;
        // Minus 2 to deal with rounding errors and scrollbar
        var charsPerLine = maxLineLength - paddingFromLineNum - 2;
        return charsPerLine;
    }
    function viewTextSource(text, type, finalCallback) {
        var sourceCodeElem = document.getElementById('source-code');
        sourceCodeElem.textContent = '';
        var pre = document.createElement('pre');
        pre.className = 'prettyprint linenums';
        var lineCount = text.match(/\n/g);
        lineCount = lineCount ? lineCount.length + 1 : 1;
        // Calculate max width of counters:
        var lineCountExp = Math.floor( Math.log(lineCount)/Math.log(10) ) + 1;
        pre.className += ' linenumsltE' + lineCountExp;
        
        var withSyntaxHighlighting = function() {
            pre.classList.add('auto-wordwrap');
            pre.textContent = text;
            pre.innerHTML = prettyPrintOne(pre.innerHTML, null, 1);
        };
        // Auto-highlight for <30kb source
        if (text.length < 3e4) {
            withSyntaxHighlighting();
        } else {
            beautify({
                text: text,
                type: type,
                wrap: calcWrapLength(text)
            }, function(wrappedText) {
                var startTag = '<li>';
                var endTag = '</li>';
                pre.innerHTML =
                    '<button title="Click to add syntax highlighting">' +
                        'Pretty print' +
                    '</button>' +
                    '<ol>' +
                    startTag +
                    escapeHTML(wrappedText).replace(/\n/g, endTag+startTag) +
                    endTag +
                    '</ol>';
                pre.querySelector('button').onclick = function() {
                    sourceCodeElem.removeChild(pre);
                    withSyntaxHighlighting();
                    sourceCodeElem.appendChild(pre);
                };
            });
        }

        sourceCodeElem.appendChild(pre);

        finalCallback(function() {
            var sourceCodeElem = document.getElementById('source-code');
            if (sourceCodeElem.firstChild === pre) return;
            sourceCodeElem.textContent = '';
            sourceCodeElem.appendChild(pre);
        });
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
    return viewFileInfo;
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
    // Filter for file names
    function applyFilter(/*regex*/pattern) {
        var CLASS_FILTERED = 'file-filtered';
        var fileList = document.getElementById('file-list');
        var listItems = fileList.querySelectorAll('li');
        for (var i=0; i<listItems.length; ++i) {
            var listItem = listItems[i];
            if (pattern.test(listItem.dataset.filename)) {
                listItem.classList.remove(CLASS_FILTERED);
            } else {
                listItem.classList.add(CLASS_FILTERED);
            }
        }
    }
    function checkAndApplyFilter() {
        var fileFilterElem = document.getElementById('file-filter');
        var feedback = document.getElementById('file-filter-feedback');
        var pattern = fileFilterElem.value;
        try {
            // TODO: Really want to force case-sensitivity?
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
        applyFilter(pattern);
    }
    (function() {
        // Bind to checkbox filter

        var FILTER_STORAGE_PREFIX = 'filter-';
        var fileList = document.getElementById('file-list');
        var checkboxes = document.querySelectorAll('input[data-filter-type]');
        for (var i = 0; i < checkboxes.length; ++i) {
            var checkbox = checkboxes[i];
            var storageKey = FILTER_STORAGE_PREFIX + checkbox.dataset.filterType;
            checkbox.checked = localStorage.getItem(storageKey) !== '0';
            checkbox.onchange = onCheckboxChange;
            if (!checkbox.checked) {
                fileList.classList.add('gfilter-' + checkbox.dataset.filterType);
            }
        }
        function onCheckboxChange() {
            // jshint validthis:true
            var storageKey = FILTER_STORAGE_PREFIX + this.dataset.filterType;
            localStorage.setItem(storageKey, this.checked ? '1' : '0');
            fileList.classList.toggle('gfilter-' + this.dataset.filterType, !this.checked);
        }
    })();
    // Bind event
    var fileFilterElem = document.getElementById('file-filter');
    fileFilterElem.addEventListener('input', checkAndApplyFilter);
    fileFilterElem.form.onsubmit = function(e) {
        e.preventDefault();
        checkAndApplyFilter();
    };

    return checkAndApplyFilter;
})();
// Go load the stuff
initialize();
function initialize() {
    if (!crx_url) {
        // No crx found in parameters, show Select file dialog.
        appendFileChooser();
        return;
    }
    var webstore_url = get_webstore_url(crx_url);
    if (webstore_url) {
        var webstore_link = document.getElementById('webstore-link');
        webstore_link.href = webstore_url;
        webstore_link.title = webstore_url;
    }
    openCRXinViewer(crx_url);
}

function appendFileChooser() {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.insertAdjacentHTML('beforeend',
            '<br><br>' +
            (typeof chrome === 'object' && chrome.runtime && chrome.runtime.id ?
            // Extension
            'Visit the Chrome Web Store or Opera\'s add-on gallery<br>' +
            'and click on the CRX button to view its source.' +
            '<br><br>Or select a .crx/.nex/.zip file:' :
            // Web page
            'Select a .crx/.nex/.zip file:'
            ) +
            '<br><br>');
    var fileChooser = document.createElement('input');
    fileChooser.type = 'file';
    fileChooser.onchange = function() {
        var file = fileChooser.files[0];
        if (file) openCRXinViewer(file);
    };
    progressDiv.appendChild(fileChooser);
}

// crx_url: string or File object
function openCRXinViewer(crx_url) {
    var crx_blob;
    if (typeof crx_url === 'object') {
        crx_blob = crx_url;
        crx_url = crx_blob.name;
    }
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.textContent = 'Loading ' + crx_url;

    openCRXasZip(crx_blob || crx_url, handleBlob, function(error_message) {
        progressDiv.textContent = error_message;
        appendFileChooser();

//#if CHROME
        if (crx_blob) {
            // Input was a File object, so failure cannot be caused by invalid input.
            return;
        }
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
                    openCRXasZip(crx_url, handleBlob, null, progressEventHandler);
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
//#endif
    }, progressEventHandler);
    function progressEventHandler(xhrProgressEvent) {
        if (xhrProgressEvent.lengthComputable) {
            var loaded = xhrProgressEvent.loaded;
            var total = xhrProgressEvent.total;
            progressDiv.textContent = 'Loading ' + crx_url;
            progressDiv.insertAdjacentHTML('beforeend', '<br><br>' +
                                           (formatByteSize(loaded) + ' / ' + formatByteSize(total)) + '<br>' +
                                           '<progress max="' + total + '" value="' + loaded + '">');
        } else {
            // Progress dot ;)
            progressDiv.appendChild(document.createTextNode('.'));
        }
    }
}

function handleBlob(blob, publicKey) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = true;
    
    setBlobAsDownload(blob);
    setPublicKey(publicKey);

    zip.createReader(new zip.BlobReader(blob), function(zipReader) {
        renderPanelResizer();
        zipReader.getEntries(handleZipEntries);
        window.addEventListener('unload', function() {
            zipReader.close();
            // Close background page as well, to avoid memory leak.....
            //chrome.extension.getBackgroundPage().close();
            // F***, Extension crashes if navigating away >.>
        });
    });
}

if (typeof URL === 'undefined') window.URL = window.webkitURL;
function setBlobAsDownload(blob) {
    var dl_link = document.getElementById('download-link');
    dl_link.href = URL.createObjectURL(blob);
    var zipname = getParam('zipname');
    if (!zipname) 
        zipname = get_zip_name(crx_url, zipname);
    dl_link.download = zipname;
    dl_link.title = 'Download as ' + zipname;
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
