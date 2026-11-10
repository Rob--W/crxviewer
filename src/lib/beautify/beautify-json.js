/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: comments are removed with strip-json-comments
 * (bundled from npm into lib/strip-json-comments.js) instead of JSON.minify. */

/* globals stripJsonComments */

importScripts('../strip-json-comments.js');

// Beautifies JSON
// Throws an error if the string is invalid JSON
function json_beautify(json_string) {
    var parsed;
    try {
        parsed = JSON.parse(json_string);
    } catch (e) {
        parsed = JSON.parse(stripJsonComments(json_string, {trailingCommas: true}));
    }   
    // Return a normalized, formatted JSON string
    // with 4 spaces of indention for each level
    return JSON.stringify(parsed, null, 4); 
}
