/**
 * (c) 2026 Subham Mahesh
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Entry point for strip-json-comments (MIT license), which makes it possible
 * to parse manifest.json files that contain comments or trailing commas.
 * Bundled by `node make.js bundles` into src/lib/strip-json-comments.js, which
 * exposes the global `stripJsonComments` (in pages and in workers).
 */

import stripJsonComments from 'strip-json-comments';

self.stripJsonComments = stripJsonComments;
