/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: reduced to Firefox only (removed Chrome, Opera and web-demo code,
 * and support for Chrome/Edge/Opera CRX extensions; renamed from crxviewer.js);
 * the file list is shown as a collapsible folder tree; code is shown in a
 * CodeMirror 6 editor with editing, and edited files can be downloaded as a zip;
 * a Changes panel lists edited files with diffs (unified or split) and revert;
 * zip.js, js-beautify and strip-json-comments are bundled from npm. */

/* jshint browser:true, devel:true */
/* globals chrome, URL,
           getParam, encodeQueryString, openAddonAsZip, get_zip_name, get_listing_url, is_listing_url,
           get_addon_download_url, is_addon_download_url,
           get_amo_domain, get_amo_slug,
           zip,
           EfficientTextWriter,
           beautify,
           ZenEditor,
           Uint8ArrayWriter, ModernCrypto,
           parseCertificate, parseMozCOSE,
           stripJsonComments
           */

'use strict';

// addon_url is globally set to the URL of the shown file for ease of debugging.
// If there is no URL (e.g. with  <input type=file>), then addon_url is the file name.


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
    // Which fool stores over 1 GB of data in an extension???
    return Math.round(fileSize/1e9) + ' GB';
}
function handleZipEntries(entries) {
    var output = document.createDocumentFragment();
    // Files are shown as a folder tree, like a file explorer.
    var treeRoot = {folders: {}, files: []};
    var fileCount = 0;

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
        listItem.zipEntry = entry;

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
            if (editedFiles.size) scheduleChangesPanelRender();
        });

        listItem.dataset.filename = filename;

        var genericType = getGenericType(filename);
        if (genericType) {
            listItem.classList.add('gtype-' + genericType);
            genericTypeCounts[genericType] = genericTypeCounts[genericType] + 1 || 1;
        }

        var folderNames = filename.split('/');
        folderNames.pop();
        var node = treeRoot;
        folderNames.forEach(function(folderName) {
            node = node.folders[folderName] ||
                (node.folders[folderName] = {folders: {}, files: []});
        });
        node.files.push({name: filename.slice(filenameIndex), listItem: listItem});
        ++fileCount;
    });
    editedFiles.clear();
    document.getElementById('download-edited-zip').hidden = true;
    scheduleChangesPanelRender();
    // Small archives start fully expanded; larger ones start collapsed.
    fileTreeCollapsedFolders = new Set();
    var collapseByDefault = fileCount > 40;
    function appendTree(node, depth, pathPrefix) {
        // manifest.json first, then folders, then the other files.
        var files = node.files.sort(function(x, y) {
            var xIsManifest = depth === 0 && x.name.toLowerCase() === 'manifest.json';
            var yIsManifest = depth === 0 && y.name.toLowerCase() === 'manifest.json';
            if (xIsManifest !== yIsManifest) return xIsManifest ? -1 : 1;
            return x.name.localeCompare(y.name);
        });
        var manifest = depth === 0 && files.length &&
            files[0].name.toLowerCase() === 'manifest.json' ? files.shift() : null;
        if (manifest) appendFile(manifest, depth);
        var fileTotal = files.length + (manifest ? 1 : 0);
        Object.keys(node.folders).sort(function(x, y) {
            return x.localeCompare(y);
        }).forEach(function(folderName) {
            var folderPath = pathPrefix + folderName + '/';
            var folderRow = createFolderRow(folderName, folderPath, depth);
            output.appendChild(folderRow);
            if (collapseByDefault) fileTreeCollapsedFolders.add(folderPath);
            var count = appendTree(node.folders[folderName], depth + 1, folderPath);
            folderRow.querySelector('.folder-count').textContent = count;
            fileTotal += count;
        });
        files.forEach(function(file) {
            appendFile(file, depth);
        });
        return fileTotal;
    }
    function appendFile(file, depth) {
        file.listItem.style.setProperty('--depth', depth);
        output.appendChild(file.listItem);
    }
    function createFolderRow(folderName, folderPath, depth) {
        var folderRow = document.createElement('li');
        folderRow.className = 'folder-row';
        folderRow.dataset.folder = folderPath;
        folderRow.style.setProperty('--depth', depth);
        folderRow.title = folderPath;
        folderRow.innerHTML =
            '<span class="tree-chevron"></span>' +
            '<span class="folder-name"></span>' +
            '<span class="folder-count"></span>';
        folderRow.querySelector('.folder-name').textContent = folderName;
        folderRow.addEventListener('click', function() {
            if (fileTreeCollapsedFolders.has(folderPath)) {
                fileTreeCollapsedFolders.delete(folderPath);
            } else {
                fileTreeCollapsedFolders.add(folderPath);
            }
            updateFileTree();
        });
        return folderRow;
    }
    appendTree(treeRoot, 0, '');
    treeRoot = null;
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

    renderInitialViewFromUrlParams();
}
// Folder paths (ending with "/") that the user collapsed in the file tree.
var fileTreeCollapsedFolders = new Set();

// Hides rows inside collapsed folders and folders without any visible file.
// Called whenever the file filters change (via renderTotalFileSize).
function updateFileTree() {
    var fileList = document.getElementById('file-list');
    var rows = fileList.children;
    // While a filter is typed, show every match regardless of collapsed folders.
    var isFiltering = document.getElementById('file-filter').value !== '';
    fileList.classList.toggle('tree-filtering', isFiltering);

    var foldersWithVisibleFiles = new Set();
    var i, row, path, j;
    for (i = 0; i < rows.length; ++i) {
        row = rows[i];
        path = row.dataset.filename;
        if (path === undefined) continue;
        var isVisible = !row.classList.contains('file-filtered') &&
            !row.classList.contains('grep-no-match') &&
            !row.gtypefiltered;
        if (!isVisible) continue;
        for (j = path.indexOf('/'); j !== -1; j = path.indexOf('/', j + 1)) {
            foldersWithVisibleFiles.add(path.slice(0, j + 1));
        }
    }

    for (i = 0; i < rows.length; ++i) {
        row = rows[i];
        var folderPath = row.dataset.folder;
        path = folderPath === undefined ? row.dataset.filename : folderPath;
        if (path === undefined) continue;
        var isHidden = folderPath !== undefined && !foldersWithVisibleFiles.has(folderPath);
        if (!isFiltering) {
            // Check the ancestor folders (excluding the folder itself).
            var end = folderPath === undefined ? path.length : path.length - 1;
            for (j = path.indexOf('/'); !isHidden && j !== -1 && j < end; j = path.indexOf('/', j + 1)) {
                isHidden = fileTreeCollapsedFolders.has(path.slice(0, j + 1));
            }
        }
        row.classList.toggle('tree-hidden', isHidden);
        if (folderPath !== undefined) {
            row.classList.toggle('folder-collapsed', fileTreeCollapsedFolders.has(folderPath));
        }
    }
}

// Expands all folders that contain |filename|.
function revealInFileTree(filename) {
    for (var j = filename.indexOf('/'); j !== -1; j = filename.indexOf('/', j + 1)) {
        fileTreeCollapsedFolders.delete(filename.slice(0, j + 1));
    }
    updateFileTree();
}

function getGenericType(filename) {
    // Chromium / generic / WebExtensions
    if (filename === 'manifest.json') {
        // No generic type = Don't offer any checkbox to hide it.
        return '';
    }
    var extension = filename.split('.').pop().toLowerCase();
    if (/^(jsx?|tsx?|wat|coffee)$/.test(extension)) {
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
    case 'xpi':
        // Just map them to zip files because we treat it as a zip file, internally.
        return 'application/zip';
    case 'md':
        return 'text/plain';
    case 'cjs':
    case 'jsm':
    case 'mjs':
        return 'application/javascript';
    }
    return zip.getMimeType(filename);
}

// Preferences of the code editor, shared by all files.
var editorPrefs = {
    editable: false,
    wrap: true,
    // How edited files are shown: 'off' (code), 'unified' or 'split' (diff).
    diffMode: 'unified',
};

// Files whose text was edited: filename -> editor (see ZenEditor.create).
var editedFiles = new Map();

function setFileEdited(entry, editor) {
    if (editor) {
        editedFiles.set(entry.filename, editor);
    } else {
        editedFiles.delete(entry.filename);
    }
    var li = getFileListItem(entry.filename);
    if (li) li.classList.toggle('file-edited', !!editor);
    var button = document.getElementById('download-edited-zip');
    button.hidden = editedFiles.size === 0;
    button.title = 'Download a new zip file that includes your edits to ' +
        editedFiles.size + ' file' + (editedFiles.size === 1 ? '' : 's');
    scheduleChangesPanelRender();
}

function getFileListItem(filename) {
    return document.querySelector('#file-list li[data-filename="' + filename.replace(/["\\]/g, '\\$&') + '"]');
}

// Opens a file in the viewer, like clicking on it in the file tree.
function openFileFromList(filename) {
    var li = getFileListItem(filename);
    if (!li) return;
    revealInFileTree(filename);
    li.click();
    li.scrollIntoView({block: 'nearest'});
}

function revertFile(filename) {
    var editor = editedFiles.get(filename);
    if (editor && confirm('Discard your edits to ' + filename + '?')) {
        editor.revert();
    }
}

// The "Changes" panel lists edited files, like the changed files of a commit.
var scheduleChangesPanelRender = (function() {
    var timer = null;
    return function() {
        clearTimeout(timer);
        timer = setTimeout(renderChangesPanel, 120);
    };
})();

function renderChangesPanel() {
    var panel = document.getElementById('changes-panel');
    var list = document.getElementById('changes-list');
    var selected = document.querySelector('#file-list li.file-selected');
    var selectedName = selected && selected.dataset.filename;
    var filenames = Array.from(editedFiles.keys()).sort(function(a, b) {
        return a.localeCompare(b);
    });
    panel.hidden = filenames.length === 0;
    panel.querySelector('.changes-count').textContent = filenames.length;
    list.textContent = '';
    var totalAdded = 0;
    var totalRemoved = 0;
    filenames.forEach(function(filename) {
        var stats = editedFiles.get(filename).diffStats();
        totalAdded += stats.added;
        totalRemoved += stats.removed;
        var slash = filename.lastIndexOf('/');
        var row = document.createElement('li');
        row.className = 'change-row';
        row.classList.toggle('is-selected', filename === selectedName);
        row.title = filename + ' (modified): ' + stats.added + ' line' + (stats.added === 1 ? '' : 's') +
            ' added, ' + stats.removed + ' removed. Click to view the changes.';
        row.innerHTML =
            '<span class="change-status">M</span>' +
            '<span class="change-name"><span class="change-file"></span><span class="change-dir"></span></span>' +
            '<span class="change-stats"><span class="stat-add"></span><span class="stat-del"></span></span>' +
            '<button class="change-revert" title="Discard changes"></button>';
        row.querySelector('.change-file').textContent = filename.slice(slash + 1);
        row.querySelector('.change-dir').textContent = slash === -1 ? '' : filename.slice(0, slash);
        row.querySelector('.stat-add').textContent = '+' + stats.added;
        row.querySelector('.stat-del').textContent = '\u2212' + stats.removed;
        row.querySelector('.change-revert').onclick = function(event) {
            event.stopPropagation();
            revertFile(filename);
        };
        row.onclick = function() {
            if (editorPrefs.diffMode === 'off') editorPrefs.diffMode = 'unified';
            openFileFromList(filename);
            // The file may already be shown; apply the diff mode right away.
            document.getElementById('source-code').dispatchEvent(new CustomEvent('diffmodechange'));
        };
        list.appendChild(row);
    });
    panel.querySelector('.changes-total').innerHTML =
        '<span class="stat-add">+' + totalAdded + '</span> <span class="stat-del">\u2212' + totalRemoved + '</span>';

    // Mark folders that contain edited files, like an editor's source control view.
    var editedFolders = new Set();
    filenames.forEach(function(filename) {
        for (var j = filename.indexOf('/'); j !== -1; j = filename.indexOf('/', j + 1)) {
            editedFolders.add(filename.slice(0, j + 1));
        }
    });
    [].forEach.call(document.querySelectorAll('#file-list li.folder-row'), function(row) {
        row.classList.toggle('folder-has-edits', editedFolders.has(row.dataset.folder));
    });
}

function revertAllFiles() {
    var count = editedFiles.size;
    if (!count || !confirm('Discard your edits to ' + count + ' file' + (count === 1 ? '' : 's') + '?')) return;
    Array.from(editedFiles.values()).forEach(function(editor) {
        editor.revert();
    });
}

// Creates a new zip file with all files of the current archive, using the
// edited text for files that were edited.
function downloadEditedZip() {
    var button = document.getElementById('download-edited-zip');
    var items = [].map.call(document.querySelectorAll('#file-list li[data-filename]'), function(li) {
        return li.zipEntry;
    });
    var originalName = document.getElementById('download-link').download || 'extension.zip';
    var zipName = originalName.replace(/\.(zip|xpi)$/i, '') + '-edited.zip';
    button.disabled = true;
    button.textContent = 'Creating zip\u2026';
    function done(error) {
        button.disabled = false;
        button.textContent = 'Download edited zip';
        if (error) alert('Could not create the zip file: ' + error);
    }
    zip.createWriter(new zip.BlobWriter('application/zip'), function(writer) {
        var i = 0;
        (function addNext() {
            if (i >= items.length) {
                writer.close(function(blob) {
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = zipName;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(function() { URL.revokeObjectURL(a.href); }, 60000);
                    done();
                });
                return;
            }
            var entry = items[i++];
            var editor = editedFiles.get(entry.filename);
            if (editor) {
                writer.add(entry.filename, new zip.TextReader(editor.getText()), addNext);
                return;
            }
            entry.getData(new zip.BlobWriter(), function(blob) {
                writer.add(entry.filename, new zip.BlobReader(blob), addNext);
            });
        })();
    }, done);
}

// The top bar can wrap onto more rows in narrow windows. Publish its height
// so that the panels below it (see viewer.less) fill the rest of the window.
(function() {
    var topBar = document.getElementById('top-bar');
    var lastHeight = -1;
    function updateTopBarHeight() {
        var height = topBar.offsetHeight;
        if (height === lastHeight) return;
        lastHeight = height;
        document.documentElement.style.setProperty('--top-bar-height', height + 'px');
    }
    updateTopBarHeight();
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(updateTopBarHeight).observe(topBar);
    } else {
        window.addEventListener('resize', updateTopBarHeight);
    }
})();

// The code editor that is currently shown, if any.
var currentCodeEditor = null;

// Ctrl/Cmd+F and Ctrl/Cmd+G anywhere on the page: search in the shown code
// instead of opening the browser's find bar.
window.addEventListener('keydown', function(event) {
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    var mod = isMac ? event.metaKey : event.ctrlKey;
    if (!mod || event.altKey) return;
    var key = event.key.toLowerCase();
    if (key !== 'f' && key !== 'g') return;
    // Inside the editor (or its search box), CodeMirror handles these keys itself.
    var active = document.activeElement;
    if (active && active.closest && active.closest('.cm-editor')) return;
    if (key === 'f') {
        event.preventDefault();
        if (currentCodeEditor) {
            currentCodeEditor.openSearch();
        } else {
            var fileFilter = document.getElementById('file-filter');
            fileFilter.focus();
            fileFilter.select();
        }
    } else if (currentCodeEditor) {
        event.preventDefault();
        var button = document.querySelector('#source-toolbar ' + (event.shiftKey ? '.find-prev' : '.find-next'));
        if (button) button.click();
    }
}, true);

document.getElementById('download-edited-zip').onclick = downloadEditedZip;
document.getElementById('revert-all-changes').onclick = revertAllFiles;
document.getElementById('changes-download-zip').onclick = downloadEditedZip;

window.addEventListener('beforeunload', function(event) {
    if (editedFiles.size) {
        // Ask the user before closing the viewer with unsaved edits.
        event.preventDefault();
        event.returnValue = '';
    }
});

var viewFileInfo = (function() {
    var _currentEntry = null;
    var handlers = {};
    var wantRawSourceGlobalDefault = false;

    // To increase performance, intermediate results are cached
    // _cachedResult = extracted content
    // _cachedCallback = If existent, a function which renders the (cached) result.
    // Additional members:
    // _initialViewParams = If set, will be used the first time that the entry is rendered.
    function viewFileInfo(entry) {
        function onReturnEarly() {
            // Clear parameters when the user switches elsewhere,
            // or when the parameters are used.
            delete entry._initialViewParams;
        }
        if (_currentEntry === entry) return onReturnEarly();
        _currentEntry = entry;
        if (entry._cachedCallback) {
            // If cachedCallback returns false, then nothing was rendered.
            if (entry._cachedCallback() !== false);
                return onReturnEarly();
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
                return onReturnEarly();
            mimeType = 'text/plain';
            handler = handlers.text;
        }
        var callback = handler.callback;

        if (entry._cachedResult) {
            saveScroll();
            willSwitchSourceView();
            callback(entry, entry._cachedResult);
            restoreScroll(entry.filename);
            return onReturnEarly();
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
            if (_currentEntry !== entry) {
                console.log('Finished reading file, but another file was opened!');
                return onReturnEarly();
            }
            saveScroll();
            willSwitchSourceView();
            callback(entry, result, function finalCallback(callbackResult) {
                if (callbackResult && typeof callbackResult !== 'function') {
                    throw new Error('callbackResult exists and is not a function!');
                }
                entry._cachedCallback = function() {
                    saveScroll();
                    if (callbackResult) {
                        willSwitchSourceView();
                        onReturnEarly();
                        callbackResult();
                    }
                    restoreScroll(entry.filename);
                    return typeof callbackResult == 'function';
                };
                // Final callback = thing has been rendered for the first time,
                // or something like that.
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
            var sourceToolbarElem = document.getElementById('source-toolbar');
            var sourceCodeElem = document.getElementById('source-code');

            // One CodeMirror editor per view (original and beautified code).
            var hostRaw = document.createElement('div');
            var hostBeauty = document.createElement('div');
            hostRaw.className = hostBeauty.className = 'cm-host';
            var editorRaw, editorBeauty;
            var editorCurrent; // The currently displayed editor.
            var hostCurrent;
            var scrollSnapshots = new Map();

            var heading = document.createElement('div');
            heading.className = 'file-specific-toolbar';

            // Downloads the current text, including any edits.
            var downloadLink = createDownloadLink(entry);
            downloadLink.textContent = 'Download file';
            downloadLink.onclick = function() {
                if (!editorCurrent) return false;
                if (downloadLink.href) URL.revokeObjectURL(downloadLink.href);
                downloadLink.download = entry.filename.split('/').pop();
                downloadLink.href = URL.createObjectURL(new Blob([editorCurrent.getText()], {
                    type: getMimeTypeForFilename(entry.filename),
                }));
            };
            heading.appendChild(downloadLink);
            heading.appendChild(createContentVerifier(entry));

            var goToLineButton = document.createElement('button');
            goToLineButton.textContent = 'Go to line';
            goToLineButton.title = 'Jump to a line (Ctrl+Alt+G / Cmd+Alt+G)';
            goToLineButton.onclick = function() {
                if (editorCurrent) editorCurrent.gotoLine();
            };
            heading.appendChild(goToLineButton);

            var toggleBeautify = document.createElement('button');
            heading.appendChild(toggleBeautify);

            var toggleEdit = document.createElement('button');
            toggleEdit.className = 'toggle-edit';
            toggleEdit.onclick = function() {
                editorPrefs.editable = !editorPrefs.editable;
                applyEditorPrefs();
                if (editorPrefs.editable && editorCurrent) editorCurrent.view.focus();
            };
            heading.appendChild(toggleEdit);

            var revertButton = document.createElement('button');
            revertButton.textContent = 'Revert';
            revertButton.title = 'Discard your edits to this file';
            revertButton.hidden = true;
            revertButton.onclick = function() {
                if (editorCurrent && confirm('Discard your edits to ' + entry.filename + '?')) {
                    editorCurrent.revert();
                }
            };
            heading.appendChild(revertButton);

            var toggleWrap = document.createElement('button');
            toggleWrap.onclick = function() {
                editorPrefs.wrap = !editorPrefs.wrap;
                applyEditorPrefs();
            };
            heading.appendChild(toggleWrap);

            heading.insertAdjacentHTML('beforeend',
                '<button class="find-prev" title="Find previous match of the search term (from the filter box, after !)">&#9650;</button>' +
                '<button class="find-next" title="Find next match of the search term (from the filter box, after !)">&#9660;</button>' +
                '<button class="find-all" title="Highlight all occurrences of the search term"><span class="find-all-indicator">H</span></button>' +
                '<span class="find-status"></span>' +
                '<span class="toolbar-spacer"></span>' +
                '<span class="diff-controls" hidden>' +
                    '<button class="change-prev" title="Previous change">&#8593;</button>' +
                    '<button class="change-next" title="Next change">&#8595;</button>' +
                    '<span class="diff-switch" role="group" aria-label="How to show your changes">' +
                        '<button data-mode="off" title="Show the edited code">Code</button>' +
                        '<button data-mode="unified" title="Show changes inline, like a unified diff">Diff</button>' +
                        '<button data-mode="split" title="Show the original and edited code side by side">Split</button>' +
                    '</span>' +
                '</span>' +
                '<span class="language-label"></span>' +
                '');
            [].forEach.call(heading.querySelectorAll('.diff-switch > button'), function(button) {
                button.onclick = function() {
                    editorPrefs.diffMode = button.dataset.mode;
                    applyDiffMode();
                };
            });
            heading.querySelector('.change-prev').onclick = function() {
                editorCurrent.goToChange(-1);
            };
            heading.querySelector('.change-next').onclick = function() {
                editorCurrent.goToChange(1);
            };
            // Sent when a file is opened from the Changes panel.
            sourceCodeElem.addEventListener('diffmodechange', function() {
                if (sourceToolbarElem.firstChild === heading) applyDiffMode();
            });

            var shouldHighlightAll = false;
            heading.querySelector('.find-prev').onclick = function() {
                if (!editorCurrent.getQueryStatus().hasQuery) {
                    editorCurrent.openSearch();
                    showFindStatus(true);
                    return;
                }
                editorCurrent.findPrev();
                showFindStatus(true);
            };
            heading.querySelector('.find-next').onclick = function() {
                if (!editorCurrent.getQueryStatus().hasQuery) {
                    editorCurrent.openSearch();
                    showFindStatus(true);
                    return;
                }
                editorCurrent.findNext();
                showFindStatus(true);
            };
            var findAllButton = heading.querySelector('.find-all');
            function setHighlightAll(enabled) {
                shouldHighlightAll = enabled;
                findAllButton.firstChild.classList.toggle('find-all-enabled', enabled);
                findAllButton.classList.toggle('is-active', enabled);
                findAllButton.setAttribute('aria-pressed', String(enabled));
                findAllButton.title = enabled ?
                    'Highlighting all matches. Click to turn highlighting off.' :
                    'Highlight all matches of the search term';
                if (editorCurrent) editorCurrent.setHighlightAll(enabled);
            }
            findAllButton.onclick = function() {
                setHighlightAll(!shouldHighlightAll);
                if (shouldHighlightAll && !editorCurrent.getQueryStatus().hasQuery) {
                    // Nothing to highlight yet: let the user type a search term.
                    editorCurrent.openSearch();
                }
                if (shouldHighlightAll) {
                    showFindStatus(true);
                } else {
                    hideFindStatus();
                }
            };
            function hideFindStatus() {
                var statusElem = heading.querySelector('.find-status');
                statusElem.style.cursor = '';
                statusElem.textContent = statusElem.title = '';
            }
            function showFindStatus(isUserGesture) {
                var statusElem = heading.querySelector('.find-status');
                var status = editorCurrent.getQueryStatus();
                if (!status.hasQuery) {
                    if (!isUserGesture) {
                        hideFindStatus();
                        return;
                    }
                    statusElem.textContent = 'Type a search term';
                    statusElem.style.cursor = 'help';
                    statusElem.title =
                        'Search this file with Ctrl+F (Cmd+F on a Mac), or search all files by typing\n' +
                        ' !(search term)\n' +
                        'in the filter box in the upper-left corner.\n' +
                        'Then use the arrow buttons to jump between matches, and H to highlight all of them.';
                    return;
                }
                statusElem.style.cursor = '';
                var searchDescription = '"' + status.term + '" (' +
                    (status.source === 'panel' ? 'search box of this file' : 'filter box') + ')';
                if (!status.resultTotal) {
                    statusElem.textContent = '0';
                    statusElem.title = 'No matches for ' + searchDescription;
                    return;
                }
                // If there are many results, then not the total count is
                // returned. In that case, we know that the total number is
                // the minimum number of results, so add a visual indicator.
                var totalShortStr =
                    status.resultTotal + (status.isTotalDefinite ? '' : '+');
                var totalLongStr =
                    (status.isTotalDefinite ? '' : 'at least ') +
                    status.resultTotal + ' occurrence' +
                    (status.resultTotal === 1 ? '' : 's');
                if (status.resultIndex === -1) {
                    statusElem.textContent = totalShortStr;
                    statusElem.title = 'Found ' + totalLongStr + ' of ' + searchDescription;
                    return;
                }
                var resultIndexOneBased = status.resultIndex + 1;
                statusElem.textContent = resultIndexOneBased + '/' + totalShortStr;
                statusElem.title = 'Showing result ' + resultIndexOneBased + ' of ' + totalLongStr +
                    ' of ' + searchDescription;
            }
            function enableEditorButtons(enabled) {
                [].forEach.call(heading.querySelectorAll(
                    '.find-next, .find-prev, .find-all, .toggle-edit, .toggle-wrap'), function(button) {
                    button.disabled = !enabled;
                });
                goToLineButton.disabled = !enabled;
            }
            toggleWrap.className = 'toggle-wrap';
            // Disabled until the editor exists (beautifying can take a moment).
            enableEditorButtons(false);

            function applyEditorPrefs() {
                toggleEdit.textContent = editorPrefs.editable ? 'Editing' : 'Edit';
                toggleEdit.classList.toggle('is-active', editorPrefs.editable);
                toggleEdit.title = editorPrefs.editable ?
                    'Editing is on. Click to make the code read-only.' :
                    'Click to edit this code. Edited files can be downloaded individually or as a new zip.';
                toggleWrap.textContent = 'Wrap';
                toggleWrap.classList.toggle('is-active', editorPrefs.wrap);
                toggleWrap.title = editorPrefs.wrap ? 'Line wrapping is on. Click to turn it off.' :
                    'Line wrapping is off. Click to turn it on.';
                if (editorCurrent) {
                    editorCurrent.setReadOnly(!editorPrefs.editable);
                    editorCurrent.setWrap(editorPrefs.wrap);
                }
            }

            // Shows the diff of edited files as chosen with the Code/Diff/Split switch.
            function applyDiffMode() {
                if (!editorCurrent) return;
                var modified = editorCurrent.isModified();
                var mode = modified ? editorPrefs.diffMode : 'off';
                editorCurrent.setDiffMode(mode);
                heading.querySelector('.diff-controls').hidden = !modified;
                heading.querySelector('.change-prev').hidden =
                heading.querySelector('.change-next').hidden = mode === 'off';
                [].forEach.call(heading.querySelectorAll('.diff-switch > button'), function(button) {
                    button.classList.toggle('is-active', button.dataset.mode === mode);
                });
            }

            function updateModifiedState() {
                var modified = !!editorCurrent && editorCurrent.isModified();
                revertButton.hidden = !modified;
                if (!modified && editorCurrent && editorCurrent.getDiffMode() !== 'off') {
                    // Nothing left to compare; show the plain editor again.
                    applyDiffMode();
                }
                heading.querySelector('.diff-controls').hidden = !modified;
                var currentMode = editorCurrent ? editorCurrent.getDiffMode() : 'off';
                [].forEach.call(heading.querySelectorAll('.diff-switch > button'), function(button) {
                    button.classList.toggle('is-active', button.dataset.mode === currentMode);
                });
                heading.querySelector('.change-prev').hidden =
                heading.querySelector('.change-next').hidden = currentMode === 'off';
                // Switching between original and beautified code would hide the edits.
                if (beautify.getType(entry.filename)) {
                    toggleBeautify.disabled = modified;
                    if (modified) {
                        toggleBeautify.title = 'Revert your edits to switch between beautified and original code.';
                    } else {
                        toggleBeautify.title = 'Click on this button to toggle between beautified and non-beautified (original) code.';
                    }
                }
                setFileEdited(entry, modified ? editorCurrent : null);
            }

            function createEditor(host, doc) {
                var editor = ZenEditor.create({
                    parent: host,
                    doc: doc,
                    filename: entry.filename,
                    readOnly: !editorPrefs.editable,
                    wrap: editorPrefs.wrap,
                    onSearchChange: function() {
                        if (editor === editorCurrent) showFindStatus(false);
                    },
                    onModifiedChange: function(modified) {
                        if (editor === editorCurrent) {
                            updateModifiedState();
                        } else {
                            // E.g. reverted from the Changes panel while another file is shown.
                            setFileEdited(entry, modified ? editor : null);
                        }
                    },
                });
                return editor;
            }

            // Shows the original (useBeautified=false) or beautified code.
            function selectView(useBeautified) {
                if (hostCurrent && editorCurrent) {
                    scrollSnapshots.set(hostCurrent, editorCurrent.view.scrollSnapshot());
                }
                hostCurrent = useBeautified ? hostBeauty : hostRaw;
                editorCurrent = useBeautified ? editorBeauty : editorRaw;
                toggleBeautify.textContent = 'Beautify';
                toggleBeautify.classList.toggle('was-beautify-enabled', useBeautified);
                toggleBeautify.classList.toggle('is-active', useBeautified);
                if (!editorCurrent) {
                    if (!useBeautified) {
                        editorRaw = editorCurrent = createEditor(hostRaw, text);
                    } else {
                        enableEditorButtons(false);
                        beautify({
                            text: text,
                            type: beautify.getType(entry.filename),
                            wrap: 0
                        }, function(textBeauty) {
                            editorBeauty = createEditor(hostBeauty, textBeauty);
                            if (hostCurrent === hostBeauty) {
                                editorCurrent = editorBeauty;
                                onEditorShown();
                            }
                        });
                    }
                }
                doRenderSourceCodeViewer();
            }

            function onEditorShown() {
                if (sourceToolbarElem.firstChild !== heading || !editorCurrent) {
                    // The user switched to another file in the meantime.
                    return;
                }
                enableEditorButtons(true);
                entry._searchEngineForPermalink = editorCurrent;
                heading.querySelector('.language-label').textContent = editorCurrent.languageName;
                applyEditorPrefs();
                updateModifiedState();
                applyDiffMode();
                editorCurrent.refresh();
                var snapshot = scrollSnapshots.get(hostCurrent);
                if (snapshot) editorCurrent.view.dispatch({effects: snapshot});

                editorCurrent.setSearch(textSearchEngine.getCurrentSearchTerm());
                setHighlightAll(shouldHighlightAll);
                currentCodeEditor = editorCurrent;
                showFindStatus(false);
                textSearchEngine.setQueryChangeCallback(function() {
                    editorCurrent.setSearch(textSearchEngine.getCurrentSearchTerm());
                    showFindStatus(false);
                });
                var initialViewParams = entry._initialViewParams;
                if (initialViewParams) {
                    delete entry._initialViewParams; // = "onReturnEarly".
                    if (initialViewParams.qh) {
                        setHighlightAll(true);
                        showFindStatus(false);
                    }
                    if (initialViewParams.qi) {
                        // Find the qi-th result.
                        for (var i = initialViewParams.qi; i > 0; --i) {
                            editorCurrent.findNext();
                        }
                        showFindStatus(false);
                    }
                }
            }

            if (beautify.getType(entry.filename)) {
                toggleBeautify.className = 'toggle-beautifier';
                toggleBeautify.title = 'Click on this button to toggle between beautified and non-beautified (original) code.';
                toggleBeautify.onclick = function() {
                    // Note: Toggling the state is based on the local editor
                    // instead of `!wantRawSourceGlobalDefault` because
                    // the two may differ when the user switches to a different
                    // file and modifies toggles the beautifier in that file.
                    wantRawSourceGlobalDefault = hostCurrent !== hostRaw;
                    selectView(!wantRawSourceGlobalDefault);
                };

                if (entry._initialViewParams) {
                    wantRawSourceGlobalDefault = !entry._initialViewParams.qb;
                }
            } else {
                toggleBeautify.title = 'Beautify not available for this file type';
                toggleBeautify.disabled = true;
            }

            function doRenderSourceCodeViewer() {
                sourceCodeElem.classList.add('has-editor');
                if (sourceCodeElem.lastChild !== hostCurrent) {
                    if (sourceCodeElem.lastChild === hostRaw || sourceCodeElem.lastChild === hostBeauty) {
                        sourceCodeElem.lastChild.remove();
                    }
                    sourceCodeElem.appendChild(hostCurrent);
                }
                if (editorCurrent) onEditorShown();
            }

            function onSourceViewShow() {
                sourceCodeElem.addEventListener('sourceviewhide', onSourceViewHide);
                sourceToolbarElem.appendChild(heading);
                doRenderSourceCodeViewer();
            }

            function onSourceViewHide() {
                sourceCodeElem.removeEventListener('sourceviewhide', onSourceViewHide);
                sourceCodeElem.classList.remove('has-editor');
                if (editorCurrent) {
                    scrollSnapshots.set(hostCurrent, editorCurrent.view.scrollSnapshot());
                }
                textSearchEngine.setQueryChangeCallback(null);
                currentCodeEditor = null;
            }

            sourceToolbarElem.appendChild(heading);
            sourceCodeElem.addEventListener('sourceviewhide', onSourceViewHide);
            // Use the last selected option for new views.
            // Note: This state only changes when the user clicks on the
            // `toggleBeautify` button, not when they change the file view.
            selectView(!!beautify.getType(entry.filename) && !wantRawSourceGlobalDefault);
            finalCallback(onSourceViewShow);
        }
    };
    handlers.image = {
        Writer: zip.Data64URIWriter,
        callback: function(entry, data_url) {
            var sourceToolbarElem = document.getElementById('source-toolbar');
            sourceToolbarElem.appendChild(createDownloadLink(entry, data_url));
            sourceToolbarElem.appendChild(createContentVerifier(entry));

            var sourceCodeElem = document.getElementById('source-code');
            sourceCodeElem.innerHTML = '<img>';
            var img = sourceCodeElem.firstChild;
            img.onload = function() {
                renderImageInfo('Width: ' + this.naturalWidth + ' Height: ' + this.naturalHeight);
            };
            img.onerror = function() {
                renderImageInfo('Failed to load image');
            };
            img.src = data_url;

            function renderImageInfo(text) {
                if (sourceCodeElem.firstChild === img) {
                    // The image is still being displayed.
                    sourceToolbarElem.appendChild(document.createTextNode(' ' + text));
                }
            }
        }
    };
    handlers.audio = {
        Writer: zip.Data64URIWriter,
        callback: function(entry, data_url) {
            var sourceToolbarElem = document.getElementById('source-toolbar');
            sourceToolbarElem.appendChild(createDownloadLink(entry, data_url));
            sourceToolbarElem.appendChild(createContentVerifier(entry));

            var sourceCodeElem = document.getElementById('source-code');
            sourceCodeElem.innerHTML = '<audio controls>';
            var audio = sourceCodeElem.firstChild;
            audio.onloadeddata = function() {
                renderAudioInfo('Duration: ' + audio.duration + ' seconds');
            };
            audio.onerror = function() {
                renderAudioInfo('Failed to load audio');
            };
            audio.src = data_url;

            function renderAudioInfo(text) {
                if (sourceCodeElem.firstChild === audio) {
                  // The audio element is still being displayed.
                  sourceToolbarElem.appendChild(document.createTextNode(' ' + text));
                }
            }
        }
    };
    handlers.video = {
        Writer: zip.Data64URIWriter,
        callback: function(entry, data_url) {
            var sourceToolbarElem = document.getElementById('source-toolbar');
            sourceToolbarElem.appendChild(createDownloadLink(entry, data_url));
            sourceToolbarElem.appendChild(createContentVerifier(entry));

            var sourceCodeElem = document.getElementById('source-code');
            sourceCodeElem.innerHTML = '<video controls>';
            var video = sourceCodeElem.firstChild;
            video.onloadeddata = function() {
                renderVideoInfo('Width: ' + this.videoWidth + ' Height: ' + this.videoHeight + ' Duration: ' + this.duration + ' seconds');
            };
            video.onerror = function() {
                renderVideoInfo('Failed to load video');
            };
            video.src = data_url;

            function renderVideoInfo(text) {
                if (sourceCodeElem.firstChild === video) {
                    // The video is still being displayed.
                    sourceToolbarElem.appendChild(document.createTextNode(' ' + text));
                }
            }
        }
    };
    handlers['application/java-archive'] =
    handlers['application/zip'] = {
        Writer: zip.BlobWriter,
        callback: function(entry, blob) {
            var viewerUrl = 'viewer.html';
            var blob_url = URL.createObjectURL(blob);
            if (getParam('url') === window.addon_url && window.addon_url) {
                // The URL parameters are probably reliable (=describing the zip), so use it.
                var inside = getParam('inside[]');
                inside.push(entry.filename);
                viewerUrl += '?' + encodeQueryString({
                    // Pass these parameters in case the blob URL disappears.
                    url: window.addon_url,
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

            var sourceToolbarElem = document.getElementById('source-toolbar');
            sourceToolbarElem.appendChild(createDownloadLink(entry, blob_url));
            sourceToolbarElem.appendChild(createContentVerifier(entry));

            var sourceCodeElem = document.getElementById('source-code');
            sourceCodeElem.innerHTML = '<button>View the content of this file in a new viewer</button>';
            sourceCodeElem.firstChild.onclick = function() {
                window.open(viewerUrl);
            };
        }
    };

    // Called right before the source viewer switches to another view.
    function willSwitchSourceView() {
        var sourceToolbarElem = document.getElementById('source-toolbar');
        sourceToolbarElem.textContent = '';

        var sourceCodeElem = document.getElementById('source-code');
        sourceCodeElem.dispatchEvent(new CustomEvent('sourceviewhide'));
        sourceCodeElem.textContent = '';
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
        var currentFilename = sourceCodeElem.dataset.filename;
        if (!identifier) identifier = currentFilename;
        else sourceCodeElem.dataset.filename = identifier;
        var scrollTop = scrollingOffsets[identifier];
        if (scrollTop === undefined && !currentFilename) {
            // This is the first run, don't restore the scroll offset.
            return;
        }
        // Switched view, reset to previous offset (or default to 0).
        sourceCodeElem.scrollTop = scrollTop || 0;
    }
    function createDownloadLink(entry, url) {
        var mimeType = getMimeTypeForFilename(entry.filename);
        var filename = entry.filename.split('/').pop();

        var a = document.createElement('a');
        a.className = 'file-specific-download-link';
        a.textContent = 'Show download';
        a.title = 'Download ' + entry.filename + ' (' + formatByteSize(entry.uncompressedSize) + ' bytes, type ' + mimeType + ')';
        a.onclick = function() {
            a.onclick = null;
            a.textContent = 'Creating link';
            entry.getData(new zip.BlobWriter(mimeType), function(blob) {
                a.download = filename;
                a.textContent = 'Download file';
                a.href = URL.createObjectURL(blob);
            });
        };
        if (url) {
            a.onclick = null;
            a.download = filename;
            a.textContent = 'Download file';
            a.href = url;
        }
        return a;
    }
    function createContentVerifier(entry) {
        var wrapper = document.createElement('div');
        wrapper.className = 'content-verifier-wrapper';
        var output = document.createElement('div');
        output.className = 'content-verifier-output';
        var button = document.createElement('button');
        var displayedHashes = [
            'md5',
            'sha1',
            'sha256',
            'sha384',
            'sha512',
        ];
        button.onclick = function() {
            button.onclick = toggleOutputVisibility;

            var infoTable = createInfoTable();

            infoTable.addRow('File name', entry.filename);
            // The zip file could report an incorrect value, so we will update this later.
            infoTable.addRow('File size', formatByteSize(entry.uncompressedSize) + ' bytes');

            displayedHashes.forEach(function(algo, i) {
                infoTable.addRow(algo, '');
            });

            entry.getData(new Uint8ArrayWriter(), function(uint8array) {
                infoTable.updateRow('File size', formatByteSize(uint8array.length) + ' bytes');
                displayedHashes.forEach(function(algo, i) {
                    // ModernCrypto.md5, ModernCrypto.sha1, etc.
                    ModernCrypto[algo](uint8array, function(hash) {
                        infoTable.updateRow(algo, hash);
                    });
                });
            });

            infoTable.addRow('Link', '').appendChild(createPermaLinkAnchor(entry));

            if (entry.filename === 'manifest.json') {
                infoTable.addRow('Extension ID', '(unknown)');
                calculateExtensionID().then(function(result) {
                    infoTable.updateRow('Extension ID', result);
                });
            }

            output.appendChild(infoTable);
            toggleOutputVisibility();
        };
        function toggleOutputVisibility() {
            output.hidden = !output.hidden;
            if (output.hidden) {
                button.textContent = 'Show analysis';
                button.title = 'View more information about this file.';
            } else {
                button.textContent = 'Hide analysis';
                button.title = '';
                var permalinkAnchor = output.querySelector('tr[data-description="Link"] a');
                permalinkAnchor.hidden = !permalinkAnchor.updatePermalink();
            }
        }
        // Hide the output and update the button label.
        toggleOutputVisibility();
        wrapper.appendChild(button);
        wrapper.appendChild(output);
        return wrapper;
    }

    function createInfoTable() {
        var infoTable = document.createElement('table');

        function addRow(description, initialValue) {
            var row = infoTable.insertRow(-1);
            row.className = 'info-table-row';
            row.dataset.description = description.replace(/"/g, '');
            row.insertCell(0).textContent = description;
            row.insertCell(1).textContent = initialValue || '';
            return row.cells[1];
        }
        function updateRow(description, value) {
            var row = infoTable.querySelector('tr[data-description="' + description.replace(/"/g, '') + '"]');
            row.cells[1].textContent = value;
        }
        infoTable.addRow = addRow;
        infoTable.updateRow = updateRow;
        return infoTable;
    }

    function createPermaLinkAnchor(entry) {
        var a = document.createElement('a');
        a.textContent = 'Link to this view';
        a.updatePermalink = function() {
            if (window.addon_url) {
                // Can only generate permalinks for public URLs.
                a.href = generatePseudoPermalink(entry);
                return true;
            }
        };
        // In case any parameter changes while updating.
        a.onfocus = a.updatePermalink;
        return a;
    }
    function generatePseudoPermalink(entry) {
        var params = {
            url: window.addon_url,
        };
        var inside = getParam('url') === window.addon_url && getParam('inside[]');
        if (inside && inside.length) {
            params.inside = inside;
        }

        var fileFilterElem = document.getElementById('file-filter');
        if (fileFilterElem.value) {
            params.q = fileFilterElem.value;
        }

        // All params starting with "q" are used in renderInitialViewFromUrlParams.
        params.qf = entry.filename;

        // Only code views have this toolbar (not images, audio or video).
        var heading = document.querySelector('#source-toolbar .file-specific-toolbar');
        if (heading && heading.querySelector('.toggle-beautifier')) {
            params.qb = heading.querySelector('.was-beautify-enabled') ? '1' : '0';
        }

        var searchEngine = entry._searchEngineForPermalink;
        var status = searchEngine && searchEngine.getQueryStatus();
        if (status && status.resultTotal) {
            params.qh = searchEngine.isHighlighting ? '1' : '0';
            if (status.resultIndex !== -1) {
                // Our search result indices in qi are one-based.
                params.qi = status.resultIndex + 1;
            }
        }

        var permalink = location.origin + location.pathname;

        permalink += '?' + encodeQueryString(params);
        return permalink;
    }

    return viewFileInfo;
})();

function parseExtensionIdFromManifest(manifest) {
    var id;
    if (manifest.browser_specific_settings &&
        manifest.browser_specific_settings.gecko &&
        (id = manifest.browser_specific_settings.gecko.id)) {
        return id;
    }

    if (manifest.applications && manifest.applications.gecko &&
        (id = manifest.applications.gecko.id)) {
        return id;
    }

    return '';
}

// Parse a manifest.json file into an object. These can contain '//' comments.
function parseManifest(str) {
    var parsed;
    try {
        parsed = JSON.parse(str);
    } catch (e) {
        // Allow comments and trailing commas (lib/strip-json-comments.js).
        parsed = JSON.parse(stripJsonComments(str, {trailingCommas: true}));
    }
    return parsed;
}

// Extract the extension ID from the currently loaded extension. The ID will be
// determined from the COSE signature, the PKCS#7 signature, or manifest.json,
// whatever comes first. Resolves to the extension ID (and the signature type
// between parentheses if available), or rejects on parser errors.
function calculateExtensionID() {
    var fileList = document.getElementById('file-list');
    var readEntry = function(filename, Writer) {
        var li = fileList.querySelector('li[data-filename="' + filename + '"]');
        if (!li) {
            return null;
        }
        return new Promise(function(resolve) {
            li.zipEntry.getData(new Writer(), function(data) {
                resolve(data);
            });
        });
    };
    // https://searchfox.org/mozilla-central/rev/2738efcf/toolkit/components/extensions/schemas/manifest.json#421-431
    var extensionID_pattern =
        /^(\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}|[a-z0-9-._]*@[a-z0-9-._]+)$/i;
    var formatSubject = function(id, subject) {
        if (extensionID_pattern.test(subject.CN)) {
            id = subject.CN;
        }
        var mapping = {
            'Mozilla Components': 'system',
            'Mozilla Extensions': 'privileged',
        };
        var type = mapping[subject.OU] || 'signed';
        return id + ' (' + type + ')';
    };

    return Promise.all([
        readEntry('manifest.json', EfficientTextWriter),
        readEntry('META-INF/cose.sig', Uint8ArrayWriter),
        readEntry('META-INF/mozilla.rsa', Uint8ArrayWriter),
    ]).then(function(entries) {
        var manifest_json = entries[0];
        var cose_sig = entries[1];
        var pkcs7_sig = entries[2];
        var id;

        // manifest.json contains the certification source (e.g. Production), so
        // check it in addition to the other sources.
        if (manifest_json) {
            id = parseExtensionIdFromManifest(parseManifest(manifest_json));
        }

        if (cose_sig) {
            return formatSubject(id, parseCertificate(parseMozCOSE(cose_sig)));
        }

        if (pkcs7_sig) {
            return formatSubject(id, parseCertificate(pkcs7_sig));
        }

        if (id) {
            // Unsigned extension, return it as-is.
            return id;
        }

        throw new Error('Invalid extension file');
    });
}

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
        this.queryChangeCallback = null;
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

    /**
     * Validates the search term and returns a regular expression if the query
     * is a regular expression. This is the case when |searchTerm| starts with
     * "regexp:" or "iregexp:" (the latter is a case-insensitive search).
     *
     * @param {string} searchTerm
     * @returns {null|RegExp} null iff it is not a regular expression query.
     * @throws {Error} If the query is a regular expression, but the pattern is invalid.
     */
    TextSearchEngine.parsePatternAsRegExp = function(searchTerm) {
        // Keep this search term parsing logic in sync with search-worker.js.
        var parsed = /^(i?)regexp:(.*)$/.exec(searchTerm);
        if (!parsed) {
            return null;
        }
        var pattern = parsed[2];
        var flags = parsed[1]; // 'i' or ''.
        try {
            return new RegExp(pattern, flags);
        } catch (e) {
            // Browsers include the regexp in the error message, omit this.
            throw new Error((e.message+'').replace(': /' + pattern + '/' + flags, ''));
        }
    };

    TextSearchEngine.prototype.setResultCallback = function(resultCallback) {
        this.resultCallback = resultCallback;
    };

    TextSearchEngine.prototype.setQueryChangeCallback = function(queryChangeCallback) {
        // This is to support the in-file search. For now I only expect one callback
        // at any time. If more listeners are needed, switch to an event emitter.
        this.queryChangeCallback = queryChangeCallback;
    };

    /**
     * @returns {RegExp|null} The current search term, as a RegExp.
     *     null if there there is no search query.
     */
    TextSearchEngine.prototype.getCurrentSearchTerm = function() {
        // Keep this search term parsing logic in sync with search-worker.js.
        var searchTerm = this._currentSearchTerm;
        // Assuming that the query is a valid regexp, if it is a regexp.
        var regexpTerm = TextSearchEngine.parsePatternAsRegExp(searchTerm);
        if (regexpTerm) {
            searchTerm = regexpTerm;
        } else if (searchTerm) {
            searchTerm = searchTerm.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
            if (searchTerm.lastIndexOf('case:', 0) === 0) {
                searchTerm = new RegExp(searchTerm.slice(5), '');
            } else {
                searchTerm = new RegExp(searchTerm, 'i');
            }
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

        if (!searchTerm) {
            if (this._currentSearchTerm === searchTerm) {
                return; // No change in result, do not lazily initialize the worker.
            }
            this._currentSearchTerm = '';
            this.worker.postMessage({
                searchTerm: '',
            });
            // No search term = every file matches.
            this.resultCallback(null, true);
            if (this.queryChangeCallback) {
                this.queryChangeCallback();
            }
            return;
        }
        this.resultCallback(null, null); // Should not call doPlaintextSearch again.

        // Re-use the last search results if possible.
        if (this._recentSearchResults.searchTerm === searchTerm) {
            lowPrioFilenames = mergeUnique(lowPrioFilenames, this._recentSearchResults.found);
            lowPrioFilenames = mergeUnique(lowPrioFilenames, this._recentSearchResults.notfound);
            this.resultCallback(this._recentSearchResults.found, true);
            this.resultCallback(this._recentSearchResults.notfound, false);
        } else if (this._recentSearchResults.searchTerm.indexOf(searchTerm) !== -1) {
            // E.g. "test" -> "tes". If the result contained "test" then it also includes "tes".
            lowPrioFilenames = mergeUnique(lowPrioFilenames, this._recentSearchResults.found);
            this.resultCallback(this._recentSearchResults.found, true);
            this._recentSearchResults.notfound.length = 0;
        } else if (searchTerm.indexOf(this._recentSearchResults.searchTerm) !== -1) {
            // E.g. "tes" -> "test". If the result did not contain "tes" then it will not contain
            // "test" either.
            lowPrioFilenames = mergeUnique(lowPrioFilenames, this._recentSearchResults.notfound);
            this.resultCallback(this._recentSearchResults.notfound, false);
            this._recentSearchResults.found.length = 0;
        } else {
            this._recentSearchResults.found.length = 0;
            this._recentSearchResults.notfound.length = 0;
        }
        this._recentSearchResults.searchTerm = searchTerm;
        this._currentSearchTerm = searchTerm;
        this._currentSearchStart = Date.now();
        this.worker.postMessage({
            searchTerm: searchTerm,
            lowPrioFilenames: lowPrioFilenames,
        });
        if (this.queryChangeCallback) {
            this.queryChangeCallback();
        }
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
            if (beautify.maybeInterceptMessageEvent(event)) {
                return;
            }
            var message = event.data;
            if (message.searchTerm !== textSearchEngine._currentSearchTerm) {
                return;
            }
            if (message.found.length) {
                textSearchEngine._recentSearchResults.found =
                    mergeUnique(textSearchEngine._recentSearchResults.found, message.found);
                textSearchEngine.resultCallback(message.found, true);
            }
            if (message.notfound.length) {
                textSearchEngine._recentSearchResults.notfound =
                    mergeUnique(textSearchEngine._recentSearchResults.notfound, message.notfound);
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

function renderInitialViewFromUrlParams() {
    // Filename!pattern
    var q = getParam('q') || '';
    // Whether to beautify (anything but &qb=0).
    var qb = getParam('qb') !== '0';
    // The file to select.
    var qf = getParam('qf') || '';
    // Highlight all (&qh=1).
    var qh = getParam('qh') === '1';
    // The nth search result to select (0 = none, 1 = first, etc.).
    var qi = parseInt(getParam('qi')) || 0;
    if (!q && !qf) return;
    var fileFilterElem = document.getElementById('file-filter');
    if (fileFilterElem.value && fileFilterElem.value !== q) {
        // Page restored from cache (refresh?), query parameter does not match
        // input, so do not change the view.
        console.warn('File filter input is not empty. Ignoring query from URL.');
        return;
    }

    fileFilterElem.value = q;

    // Hide all files in the UI that do not match the query.
    checkAndApplyFilter();
    if (fileFilterElem.classList.contains('invalid')) {
        // The query is invalid. Don't bother with searching.
        return;
    }

    var selectedItem;
    var fileList = document.getElementById('file-list');
    // checkAndApplyFilter above ensures that all unfiltered items match the file pattern.
    var unfilteredItems = fileList.querySelectorAll('li[data-filename]:not(.file-filtered)');
    if (qf) {
        var listItems = fileList.querySelectorAll('li[data-filename]');
        for (var i = 0; i < listItems.length; ++i) {
            if (listItems[i].dataset.filename === qf) {
                selectedItem = listItems[i];
                break;
            }
        }
        if (!selectedItem) {
            console.warn('No entry found with name ' + qf);
            return;
        }
        if ([].indexOf.call(unfilteredItems, selectedItem) === -1) {
            console.warn('The selected item is invisible because it did not match the search filter.');
        }
    } else if (unfilteredItems.length === 1) {
        selectedItem = unfilteredItems[0];
    } else if (unfilteredItems.length > 1) {
        // More than one item matches. Select the shortest matching filename,
        // because we assume that the "permalink" includes the file name,
        // so that we don't actually have to search through all files.
        // TODO: Wait for the first positive search result?
        var smallestNameLength = Infinity;
        [].forEach.call(unfilteredItems, function(listItem) {
            var len = listItem.dataset.filename.length;
            if (smallestNameLength > len) {
                smallestNameLength = len;
                selectedItem = listItem;
            }
        });
    }
    if (!selectedItem) {
        console.warn('Ignoring query from URL because there is no matching file.');
        return;
    }
    selectedItem.classList.add('file-selected');
    revealInFileTree(selectedItem.dataset.filename);
    scrollElementIntoViewIfNeeded(fileList.parentNode, selectedItem);
    selectedItem.zipEntry._initialViewParams = {
        qb: qb,
        qh: qh,
        qi: qi,
    };
    viewFileInfo(selectedItem.zipEntry);
}

function scrollElementIntoViewIfNeeded(scrollableElement, element) {
    var scrollableRect = scrollableElement.getBoundingClientRect();
    var elementRect = element.getBoundingClientRect();
    if (elementRect.height >= scrollableRect.height) {
        // Show start of line if it does not fit.
        scrollableElement.scrollTop += elementRect.top - scrollableRect.top;
    } else if (elementRect.top < scrollableRect.top || elementRect.bottom > scrollableRect.bottom) {
        // Vertically center otherwise.
        scrollableElement.scrollTop +=
            elementRect.top - scrollableRect.top +
            elementRect.height / 2 - scrollableRect.height / 2;
    }
}

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
        dispatchPanelSizeChange();
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
        var newWidthPx = newWidth + 'px';
        if (leftPanel.style.width === newWidthPx) return;
        leftPanel.style.width = newWidthPx;
        rightPanel.style.paddingLeft = (newWidth + rightPanelPadding) + 'px';
        dispatchPanelSizeChange();
    }
    function dispatchPanelSizeChange() {
        // Generate an artificial resize event so that the code editor
        // re-measures its layout.
        window.dispatchEvent(new CustomEvent('resize'));
    }
}

var checkAndApplyFilter = (function() {
    var filteredFilenames = [];
    // Filter for file names
    function applyFilter(/*regex*/pattern) {
        var CLASS_FILTERED = 'file-filtered';
        var fileList = document.getElementById('file-list');
        var listItems = fileList.querySelectorAll('li[data-filename]');
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
        renderTotalFileSize();
    }
    // Filter on files containing |searchTerm|. See search-worker.js for the algorithm.
    function grepSearch(searchTerm) {
        if (!textSearchEngine) {
            return;
        }
        textSearchEngine.setResultCallback(function(filenames, found) {
            var listItems = document.querySelectorAll('#file-list li[data-filename]');
            for (var i = 0; i < listItems.length; ++i) {
                var listItem = listItems[i];
                if (filenames !== null && filenames.indexOf(listItem.dataset.filename) === -1) {
                    continue;
                }
                listItem.classList.toggle('grep-unknown', found === null);
                listItem.classList.toggle('grep-no-match', found === false);
            }
            renderTotalFileSize();
        });
        textSearchEngine.doPlaintextSearch(searchTerm, filteredFilenames);
    }
    function renderTotalFileSize() {
        var listItems = document.querySelectorAll('#file-list li[data-filename]:not(.file-filtered):not(.grep-no-match)');
        var totalUncompressedSize = 0;
        for (var i = 0; i < listItems.length; ++i) {
            var listItem = listItems[i];
            if (listItem.gtypefiltered) continue;
            totalUncompressedSize += listItem.zipEntry.uncompressedSize;
        }
        var totalSizeElem = document.getElementById('total-size');
        // parentNode = .total-size-wrapper
        totalSizeElem.parentNode.hidden = totalUncompressedSize === 0;
        totalSizeElem.title = 'Total size: ' + formatByteSize(totalUncompressedSize) + ' bytes';
        totalSizeElem.textContent = formatByteSizeSuffix(totalUncompressedSize);
        updateFileTree();
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
            feedback.textContent = (e.message+'').replace(': /' + pattern + '/i', '').replace(': /' + pattern + '/', '');
            return;
        }
        
        // Validate the grep pattern here to make sure that we don't apply the filter if the
        // pattern is invalid.
        try {
            TextSearchEngine.parsePatternAsRegExp(grepTerm);
            feedback.textContent = '';
            fileFilterElem.classList.remove('invalid');
        } catch (e) {
            fileFilterElem.classList.add('invalid');
            feedback.textContent = 'Search: ' + e.message;
            return;
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
        var storageArea = chrome.storage.sync;

        var FILTER_STORAGE_PREFIX = 'filter-';
        var fileList = document.getElementById('file-list');
        var checkboxes = document.querySelectorAll('input[data-filter-type]');

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
        [].forEach.call(checkboxes, function(checkbox) {
            if (scaleFactor !== 1) {
                checkbox.style.transformOrigin = '0 0';
                checkbox.style.transform = 'scale(' + scaleFactor + ')';
            }
            var storageKey = FILTER_STORAGE_PREFIX + checkbox.dataset.filterType;
            checkbox.checked = localStorage.getItem(storageKey) !== '0';
            checkbox.onchange = function() {
                var items = {};
                items[storageKey] = checkbox.checked;
                storageArea.set(items);
                updateFileListView();
            };
                storageArea.get(storageKey, function(items) {
                    checkbox.checked = items[storageKey] !== false;
                    updateFileListView();
                });
            function updateFileListView() {
                fileList.classList.toggle('gfilter-' + checkbox.dataset.filterType, !checkbox.checked);
                // Save filter state for renderTotalFileSize.
                var gtypefiltered = !checkbox.checked;
                [].forEach.call(fileList.querySelectorAll('li.gtype-' + checkbox.dataset.filterType), function(li) {
                    li.gtypefiltered = gtypefiltered;
                });
                renderTotalFileSize();
            }
        });
    })();
    // Bind event
    var fileFilterElem = document.getElementById('file-filter');
    fileFilterElem.addEventListener('input', function() {
        checkAndApplyFilter(true);
    });
    fileFilterElem.addEventListener('change', function() {
        updateUrlWithSearchQuery(this.value);
    });

    function updateUrlWithSearchQuery(query) {
        // Do not update the URL if we are in a permalink view.
        if (getParam('qf') || getParam('qb') || getParam('qh') || getParam('qi')) {
            return;
        }
        var params = {};
        var addonUrl = getParam('url');
        if (!addonUrl) {
          // url param may be missing if the user has not opened any file, or
          // if the file picker was used. A permalink would not work for these.
          return;
        }
        params.url = addonUrl;
        var blob = getParam('blob');
        if (blob) params.blob = blob;
        var inside = getParam('inside[]');
        if (inside) params.inside = inside;

        if (query) {
            params.q = query;
        }
        var newUrl = location.pathname + '?' + encodeQueryString(params);
        history.replaceState(null, '', newUrl);
    }
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
    var addon_url = getParam('url');
    var blob_url = getParam('blob');
    if (!addon_url && !blob_url) {
        showAdvancedOpener();
        return;
    }
    var listing_url = addon_url && get_listing_url(addon_url);
    // Only consider rewriting the URL if it is not a known add-on download.
    if (!is_addon_download_url(addon_url)) {
        if (is_listing_url(addon_url)) {
            // Prefer given URL because its slug contains an extra human-readable short name.
            listing_url = addon_url;
        }
        // This is a no-op if the URL is not recognized.
        addon_url = get_addon_download_url(listing_url || addon_url);
    }
    if (listing_url) {
        var listing_link = document.getElementById('listing-link');
        listing_link.href = listing_url;
        listing_link.title = listing_url;
    }
    var inside = getParam('inside[]');
    var zipname = getParam('zipname');

    // blob:-URL without inside parameter = looking inside an (embedded) zip file for which we don't
    // have a URL, e.g. a file selected via <input type=file>
    if (!inside.length && blob_url) {
        loadCachedUrlInViewer(blob_url, addon_url || zipname || blob_url, function(blob) {
            openAddonInViewer(addon_url, zipname, blob);
        }, function() {
            if (addon_url) {
                openAddonInViewer(addon_url, zipname);
            } else {
                var progressDiv = document.getElementById('initial-status');
                progressDiv.textContent = 'Cannot open ' + (zipname || blob_url);
                appendFileChooser();
            }
        });
        return;
    }
    if (addon_url && inside.length) {
        openEmbeddedZipFile(addon_url, inside, blob_url);
        return;
    }

    // Plain and simple: Open the add-on at the given URL.
    openAddonInViewer(addon_url, zipname);
}

function showAdvancedOpener() {
    var advancedOpenView = document.getElementById('advanced-open');
    var openForm = document.getElementById('advanced-open-form');
    var amoOptions = document.getElementById('advanced-open-amo-extension');
    var urlInput = openForm.querySelector('input[type=url]');
    var fileInput = openForm.querySelector('input[type=file]');
    // Fills in the add-on slug when a URL of addons.mozilla.org is entered.
    function maybeFillAmoForm() {
        var amoslug = get_amo_slug(urlInput.value);
        var maybeXpi = /\.xpi([?#&]|$)|\.mozilla\./i.test(urlInput.value) || !!amoslug;
        if (amoslug) {
            amoOptions.querySelector('input[name="amoslugorid"]').value = amoslug;
        }
        amoOptions.classList.toggle('disabled-site', !maybeXpi && !!urlInput.value);
    }
    function closeViewAndOpenAddonUrl(addonUrl) {
        var url = location.pathname + '?' + encodeQueryString({
            url: addonUrl,
        });
        advancedOpenView.classList.remove('visible');
        // This open dialog only appears at the start of the page, and there is
        // no data to lose, so we just replace the current URL.
        history.replaceState(history.state, null, url);
        initialize();
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
        closeViewAndOpenAddonUrl(urlInput.value);
    };
    amoOptions.onsubmit = function(e) {
        e.preventDefault();
        // Derive the AMO domain from the URL input if non-empty, otherwise try the url param.
        var amodomain = get_amo_domain(urlInput.value || getParam('url'));
        var amodescription = amoOptions.querySelector('.amodescription');
        var slugorid = amoOptions.querySelector('input[name="amoslugorid"]').value;
        amodescription.textContent = 'Searching for add-ons with slug or ID: ' + slugorid;
        var amoxpilist = amoOptions.querySelector('.amoxpilist');
        getXpis(amodomain, slugorid, 0, function(description, results, nextPage) {
            amodescription.textContent = description;
            if (results.length) {
                var a = document.createElement('a');
                a.href = 'https://' + amodomain + '/addon/' + slugorid;
                a.textContent = 'add-on listing';
                amodescription.appendChild(document.createTextNode(' ('));
                amodescription.appendChild(a);
                amodescription.appendChild(document.createTextNode(')'));
            }
            amoxpilist.textContent = '';
            appendResults(results);
            if (nextPage) {
                showMoreResultsPager(nextPage);
            }
        });

        function appendResults(results) {
            var fragment = document.createDocumentFragment();
            results.forEach(function(result) {
                var a = document.createElement('a');
                a.textContent = 'Version ' + result.version + ' (' + result.platform + '), ' + result.createdDate.toLocaleString();
                a.href = location.pathname + '?' + encodeQueryString({
                    url: result.url,
                });
                a.title = 'View source of ' + result.url;
                a.onclick = function(event) {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    closeViewAndOpenAddonUrl(result.url);
                };
                var li = document.createElement('li');
                li.appendChild(a);
                fragment.appendChild(li);
            });
            amoxpilist.appendChild(fragment);
        }
        function showMoreResultsPager(page) {
            var li = document.createElement('li');
            var button = document.createElement('button');
            button.textContent = 'Show more versions from page ' + page;
            button.onclick = function(e) {
                e.preventDefault();
                button.disabled = true;
                getXpis(amodomain, slugorid, page, function(description, results, nextPage) {
                    if (!results.length) {
                        // Odd. The button should only be shown if there are more items.
                        // There might be an intermittent (network) error,
                        // so allow the user to retry the same action.
                        button.disabled = false;
                        return;
                    }
                    appendResults(results);
                    if (nextPage) {
                        // Replace button with page separator.
                        li.textContent = 'Results from page ' + page + ':';
                        showMoreResultsPager(nextPage);
                    } else {
                        li.remove();
                    }
                });
            };
            li.appendChild(button);
            amoxpilist.appendChild(li);
        }
    };
    fileInput.onchange = function() {
        var file = fileInput.files[0];
        if (file) {
            advancedOpenView.classList.remove('visible');
            openAddonInViewer('', file.name, file);
        }
    };

    urlInput.addEventListener('input', maybeFillAmoForm);
    urlInput.value = getParam('url') || '';
    maybeFillAmoForm();

    advancedOpenView.classList.add('visible');
}

// Calls callback(description, Array<{url:String, version:String, platform:String}>)
// If there are more results: The callback will include a third parameter with a non-zero page number to use.
// If called repeatedly: Will only call the callback of the last call.
function getXpis(amodomain, slugorid, page, callback) {
    var apiUrl = 'https://' + amodomain + '/api/v4/addons/addon/' + slugorid + '/versions/';
    // Have smaller response bodies by only including one language.
    apiUrl += '?lang=en-US';
    if (page) {
        apiUrl += '&page=' + page;
    } else {
        // When the page parameter is omitted, it defaults to 1.
        page = 1;
    }
    var x = new XMLHttpRequest();
    x.open('GET', apiUrl);
    x.onloadend = function() {
        if (getXpis._pendingXhr === x) {
            getXpis._pendingXhr = null;
        }

        if (x.status === 401 || x.status === 403) {
            callback('The results are not publicly available for: ' + slugorid, []);
            return;
        }
        if (x.status !== 200) {
            callback('No results found for: ' + slugorid, []);
            return;
        }
        var nextPage = 0;
        var totalVersions = 0;
        var results = [];
        try {
            var response = JSON.parse(x.responseText);
            response.results.forEach(function(res) {
                res.files.forEach(function(file) {
                    results.push({
                        url: file.url.replace(/\.xpi\?.*$/, '.xpi'),
                        version: res.version,
                        platform: file.platform,
                        createdDate: new Date(file.created),
                    });
                });
            });
            if (response.next) {
                nextPage = page + 1;
            }
            totalVersions = response.count;
        } catch (e) {
            console.error('Failed to parse response', e);
            callback('Unexpected response from add-ons server (' + e + ').', results);
            return;
        }
        if (nextPage) {
            callback('Found ' + totalVersions + ' results', results, nextPage);
            return;
        }
        callback('Found ' + results.length + ' recent results.', results);
    };
    if (getXpis._pendingXhr) {
        getXpis._pendingXhr.abort();
    }
    x.send();
    getXpis._pendingXhr = x;
}

// |addon_url| is the canonical representation (absolute URL) of the zip file.
// |inside| is the path to the file that we want to open. Every extra item is another level inside
// the zip file, e.g. ['foo.jar','bar.zip'] is the "bar.zip" file inside "foo.jar" inside |addon_url|.
// The list must contain at least one item.
// |blob_url| is the (ephemeral) URL of the Blob, used if possible.
function openEmbeddedZipFile(addon_url, inside, blob_url) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;

    var zipname = inside[inside.length - 1];

    loadCachedUrlInViewer(blob_url, zipname, function(blob) {
        openAddonInViewer(addon_url, zipname, blob);
    }, function() {
        progressDiv.textContent = 'Loading ' + zipname;
        loadUrlInViewer(addon_url, function(blob) {
            peekIntoZipUntilEnd(0, blob);
        });
    });

    function peekIntoZipUntilEnd(index, blob) {
        var human_readable_name = inside.slice(0, index + 1).reverse().join(' in ') + ' from ' + addon_url;
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
                        openAddonInViewer(addon_url, zipname, blob);
                    }
                }, function() {
                    progressDiv.textContent = 'Cannot read ' + human_readable_name;
                    zipReader.close();
                });
            });
        }, function(error) {
            progressDiv.textContent = 'Cannot open ' + human_readable_name + ' as a zip file: ' + error;
        });
    }
}

function appendFileChooser() {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.insertAdjacentHTML('beforeend',
            '<br><br>' +
            'Visit addons.mozilla.org or addons.thunderbird.net<br>' +
            'and click on the button in the address bar to view the source of an add-on.' +
            '<br><br>Or select a .xpi/.zip file:' +
            '<br><br>');
    var fileChooser = document.createElement('input');
    fileChooser.type = 'file';
    fileChooser.accept = '.xpi,.zip,.jar';
    fileChooser.onchange = function() {
        var file = fileChooser.files[0];
        if (file) openAddonInViewer('', file.name, file);
    };
    progressDiv.appendChild(fileChooser);

    progressDiv.insertAdjacentHTML('beforeend',
            '<br><br>' +
            'Or <a class="open-different-url">click here to find and open</a> a different URL.'
    );
    var openDifferentAnchor = progressDiv.querySelector('.open-different-url');
    openDifferentAnchor.href = 'viewer.html';
    var addon_url = window.addon_url || getParam('url');
    if (addon_url) {
        openDifferentAnchor.search = '?' + encodeQueryString({
            noview: 'on',
            url: addon_url,
        });
    }
    openDifferentAnchor.onclick = function(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        showAdvancedOpener();
    };
}

// addon_url: full URL to the add-on (XPI) or zip file, may be an empty string.
// zipname: Preferred file name.
// addon_blob: Blob of the zip file.
// One (or both) of addon_url or addon_blob must be set.
function openAddonInViewer(addon_url, zipname, addon_blob) {
    // Now we have fixed the addon_url, update the global var.
    window.addon_url = addon_url;
    zipname = get_zip_name(addon_url, zipname);

    // We are switching from the initial view (selecting an add-on/zip)
    // to the next view (showing the contents of the add-on/zip file).
    // Show a link to open a new viewer, prepopulated with the current
    // settings to allow the user to modify one bit of the download.
    setViewerLink(addon_url);

    if (addon_blob) {
        handleBlob(zipname, addon_blob);
        return;
    }
    loadUrlInViewer(addon_url, function(blob) {
        handleBlob(zipname, blob);
    });
}

function loadCachedUrlInViewer(blob_url, human_readable_name, onHasBlob, onHasNoBlob) {
    if (!/^blob:/.test(blob_url)) {
        onHasNoBlob();
        return;
    }
    loadBlobUrlInViewer(blob_url, human_readable_name, onHasBlob, onHasNoBlob);
}

function loadBlobUrlInViewer(url, human_readable_name, onHasBlob, onHasNoBlob) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.textContent = 'Loading ' + human_readable_name;

    try {
        var x = new XMLHttpRequest();
        x.open('GET', url);
        x.responseType = 'blob';
        x.onerror = function() {
            onHasNoBlob('Network error for ' + url);
        };
        x.onload = function() {
            if (x.status >= 400) {
                onHasNoBlob('Failed to load ' + url + '. Server responded with ' + x.status + ' ' + x.statusText);
            } else if (x.response && x.response.size) {
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

function loadUrlInViewer(addon_url, onHasBlob) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.textContent = 'Loading ' + addon_url;

    openAddonAsZip(addon_url, onHasBlob, function(error_message) {
        progressDiv.textContent = error_message;
        appendFileChooser();
    }, progressEventHandler);

    function progressEventHandler(xhrProgressEvent) {
        if (xhrProgressEvent.lengthComputable) {
            var loaded = xhrProgressEvent.loaded;
            var total = xhrProgressEvent.total;
            progressDiv.textContent = 'Loading ' + addon_url;
            progressDiv.insertAdjacentHTML('beforeend', '<br><br>' +
                                           (formatByteSize(loaded) + ' / ' + formatByteSize(total)) + '<br>' +
                                           '<progress max="' + total + '" value="' + loaded + '">');
        } else {
            progressDiv.textContent = 'Loading ' + addon_url;
            progressDiv.insertAdjacentHTML('beforeend', '<br><br>' +
                                           'Loaded bytes: ' + formatByteSize(xhrProgressEvent.loaded) + ' (total size unknown)');
        }
    }
}

function handleBlob(zipname, blob) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = true;

    setBlobAsDownload(zipname, blob);
    textSearchEngine = new TextSearchEngine(blob);

    zip.createReader(new zip.BlobReader(blob), function(zipReader) {
        renderPanelResizer();
        zipReader.getEntries(handleZipEntries);
    }, function(error) {
        progressDiv.textContent = 'Cannot open ' + (zipname || ' this file') + ' as a zip file: ' + error;
        appendFileChooser();
    });
}

if (typeof URL === 'undefined') window.URL = window.webkitURL;
function setViewerLink(addon_url) {
    var viewerUrl = 'viewer.html';

    if (addon_url) {
        viewerUrl += '?' + encodeQueryString({
            noview: 'on',
            url: addon_url,
        });
    }

    var link = document.getElementById('open-viewer');
    link.href = viewerUrl;
    link.title = 'View the source of another extension or zip file';

}
function setBlobAsDownload(zipname, blob) {
    var dl_link = document.getElementById('download-link');
    dl_link.href = URL.createObjectURL(blob);
    dl_link.download = zipname;
    dl_link.title = 'Download zip file as ' + zipname + ' (' + formatByteSize(blob.size) + ' bytes)';
}
