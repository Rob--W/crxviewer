/**
 * (c) 2026 Subham Mahesh
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals LICENSE_DATA */
'use strict';

// Renders the license data generated at build time (third-party-licenses.js,
// see external/licenses/generate.js) on license.html.
(function() {
    var data = typeof LICENSE_DATA === 'object' ? LICENSE_DATA : null;
    if (!data) {
        document.getElementById('generated-note').textContent =
            'The list of components is generated when the add-on is built (node make.js firefox).';
        return;
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }
    function licenseDetails(text, label) {
        var details = el('details', 'license-text');
        details.appendChild(el('summary', '', label));
        details.appendChild(el('pre', '', text));
        return details;
    }

    // License of the project itself.
    document.querySelector('#project-license pre').textContent = data.project.licenseText;

    // Contributors of the original work.
    var contributors = data.project.originalWork && data.project.originalWork.contributors;
    if (contributors && contributors.length) {
        document.getElementById('original-contributors').textContent = contributors.join(', ');
    }

    // Count per license, e.g. "MIT · 32".
    var counts = {};
    data.components.forEach(function(c) {
        counts[c.license] = (counts[c.license] || 0) + 1;
    });
    var countsElem = document.getElementById('license-counts');
    countsElem.appendChild(el('span', 'license-badge', data.components.length + ' components'));
    Object.keys(counts).sort(function(a, b) {
        return counts[b] - counts[a];
    }).forEach(function(license) {
        countsElem.appendChild(el('span', 'license-badge', license + ' · ' + counts[license]));
    });
    document.getElementById('generated-note').textContent =
        'This list was generated from the components included in this build on ' + data.generatedAt + '.';

    function renderGroup(title, description, components) {
        if (!components.length) return;
        var container = document.getElementById('components');
        container.appendChild(el('h3', 'group-title', title));
        var card = el('div', 'card');
        if (description) card.appendChild(el('p', 'detail', description));
        components.forEach(function(c) {
            var item = el('div', 'component');
            var head = el('div', 'component-head');
            head.appendChild(el('span', 'component-name', c.name));
            head.appendChild(el('span', 'component-version', c.version));
            head.appendChild(el('span', 'license-badge', c.license));
            item.appendChild(head);
            if (c.copyright) item.appendChild(el('span', 'detail', c.copyright));
            if (c.usedFor) item.appendChild(el('span', 'detail', 'Used for: ' + c.usedFor));
            if (c.files && c.files.length) item.appendChild(el('span', 'detail', 'Files: ' + c.files.join(', ')));
            if (c.homepage) {
                var line = el('span', 'detail');
                var a = el('a', '', c.homepage.replace(/^https?:\/\//, ''));
                a.href = c.homepage;
                a.target = '_blank';
                line.appendChild(a);
                item.appendChild(line);
            }
            if (c.note) item.appendChild(el('p', 'notice', c.note));
            if (c.notice) item.appendChild(el('p', 'notice', c.notice));
            item.appendChild(licenseDetails(c.licenseText, 'Show the ' + c.license + ' license text'));
            card.appendChild(item);
        });
        container.appendChild(card);
    }

    renderGroup('Libraries copied into lib/',
        'Copied into the add-on as-is.',
        data.components.filter(function(c) { return c.source !== 'npm'; }));
    // Packages bundled from npm, grouped by the bundle they are part of.
    var bundleGroups = {
        codemirror: ['Code editor: CodeMirror 6 and its dependencies',
            'Bundled from npm into lib/codemirror/zen-editor.js.'],
        zip: ['Zip files: zip.js', 'Bundled from npm into lib/zip.js/zip.js.'],
        beautify: ['Code formatting: js-beautify', 'Bundled from npm into lib/beautify/beautifier.js.'],
        json: ['Reading manifest.json: strip-json-comments', 'Bundled from npm into lib/strip-json-comments.js.'],
        md5: ['MD5 hashing', 'Bundled from npm into lib/noble-md5.js.'],
    };
    Object.keys(bundleGroups).forEach(function(bundle) {
        renderGroup(bundleGroups[bundle][0], bundleGroups[bundle][1],
            data.components.filter(function(c) { return c.source === 'npm' && c.bundle === bundle; }));
    });
    // Any other bundle (in case one is added without a title above).
    renderGroup('Other bundled packages', 'Bundled from npm into lib/.',
        data.components.filter(function(c) { return c.source === 'npm' && !bundleGroups[c.bundle]; }));
})();
