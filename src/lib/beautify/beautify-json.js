/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

importScripts('minify.json.js');

// Beautifies JSON
// Throws an error if the string is invalid JSON
function json_beautify(json_string) {
    var parsed;
    try {
        parsed = JSON.parse(json_string);
    } catch (e) {
        parsed = JSON.parse(JSON.minify(json_string));
    }   
    // Return a normalized, formatted JSON string
    // with 4 spaces of indention for each level
    return JSON.stringify(parsed, null, 4); 
}
