/**
 * (c) 2026 Subham Mahesh
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Entry point for js-beautify (MIT license), used by lib/beautify/worker-beautify.js.
 * Bundled by `node make.js bundles` into src/lib/beautify/beautifier.js, which
 * exposes the global `beautifier` with the functions js, css and html.
 * Only the beautifier core is bundled, not the command-line tool.
 */

import jsBeautify from 'js-beautify/js/src/index.js';

self.beautifier = {
    js: jsBeautify.js,
    css: jsBeautify.css,
    html: jsBeautify.html,
};
