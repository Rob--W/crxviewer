# Zen Source Viewer for Firefox

A modified, Firefox-only version of Rob Wu's
[Chrome extension source viewer (CRX Viewer)](https://github.com/Rob--W/crxviewer).
View the source code of Firefox and Thunderbird add-ons (xpi / zip) without
installing them.

**Modifications by Subham Mahesh (2026):**

  - Redesigned, minimal user interface for the viewer, popup and options page (light and dark mode).
  - Files are shown as a collapsible folder tree, like a file explorer.
  - Code is shown in a CodeMirror 6 editor: editing, search and replace (Ctrl/Cmd+F),
    go to line, code folding, bracket matching, autocompletion, multiple cursors and
    JSON checking. Edited files can be downloaded alone or as a new zip.
  - A Changes panel, like on GitHub, lists edited files with +added / −removed line
    counts. Each file's changes can be viewed as an inline or side-by-side diff, and
    reverted one change at a time, per file, or all at once.
  - Reduced to Firefox only; the Chrome, Opera and online-demo builds were removed,
    as was support for Chrome, Edge and Opera extensions (CRX files and their stores).
  - Added a License & Credits page (`license.html`).
  - New name (Zen Source Viewer), add-on ID (`zen-source-viewer@subhammahesh`) and ensō icon (`src/icons/icon.svg`).

Every modified source file carries a "Modified by Subham Mahesh" notice.

## Building

```
npm install
node make.js firefox
```

The add-on is written to `dist/firefox/` and packaged as `dist/zen-source-viewer.zip`.

All third-party libraries are installed from npm and bundled into `src/lib/` with
esbuild (not minified, so they can be reviewed). The bundles are listed in
`external/bundles.js`:

  - CodeMirror 6 → `src/lib/codemirror/zen-editor.js`
  - zip.js (`@zip.js/zip.js`) → `src/lib/zip.js/zip.js`, with a small layer that keeps
    the zip.js 1.x callback API used by the viewer (`external/zipjs/zip-compat.js`)
  - js-beautify → `src/lib/beautify/beautifier.js`
  - strip-json-comments → `src/lib/strip-json-comments.js`
  - `@noble/hashes` (MD5) → `src/lib/noble-md5.js`

After updating these packages (`npm install`), rebuild the bundles with:

```
node make.js bundles
```

## Features

This add-on adds a button to the address bar on add-on pages of:

  - addons.mozilla.org (Firefox add-ons)
  - addons.thunderbird.net (Thunderbird add-ons)

Upon clicking the button, two actions become available:

  - Download the add-on as a zip file
  - View source

The default action (showing the above options) can be changed via the "Primary action on click"
menu that appears when you right-click on the button.

The "View source" option opens a new tab with the viewer, with the following features:

  - Download as zip, and download a zip with your edits, at the upper-right corner.
  - A folder tree of all files, with an option to filter files with a regular expression.
  - Find files containing a string, or with content matching a regular expression.
  - Quickly jump between search results, or to a specific line.
  - Automatic beautification (formatting) of code.
  - Syntax highlighting and editing (CodeMirror 6), with a Changes panel and diffs.
  - Image preview.
  - Show hashes (md5, sha1, sha256, sha384, sha512) of the file content, and the add-on ID
    from its signature or manifest.json.
  - View content of embedded zip files.
  - Find and open older versions of an add-on on addons.mozilla.org.
  - View the contents of any URL of an XPI or zip file, or a file from your computer.
  - Link to a file and search result within an add-on.

There is also an option to show a context menu entry on links to Firefox add-ons
(XPI files and add-on pages). It can be toggled on the options page.

## Copyright and license

Original work: (c) 2013–2026 Rob Wu <rob@robwu.nl> (https://robwu.nl/), with contributions from
Peter Wu, xnumad, Ng Yik Phang, utkarshspat, Patrick Kettner, cyrozap, Snazzah and Damien.
Modifications: (c) 2026 Subham Mahesh

This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.

Third-party components (CodeMirror 6 with its dependencies, zip.js, js-beautify,
strip-json-comments and @noble/hashes, plus code they include from zlib, Acorn and Esprima)
remain under their own licenses (MIT, BSD-3-Clause, BSD-2-Clause, Zlib). The full list, with
every license text, is generated at build time by `external/licenses/generate.js` and shown on
the add-on's License & Credits page (`license.html`). Run `node make.js licenses` to generate
it into `src/` for testing.
