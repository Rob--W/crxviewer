/**
 * (c) 2016 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* globals Prism, console */
/* jshint esversion:6 */
'use strict';

console.log('Testing available and used language mappings');
// There is no point in mapping file extensions to languages if prism does not support it.
const recognizedLangs =
    Prism.rob.extToLanguage.toString()
    .match(/return '[^']+/g)
    .map(s => s.replace(/return '/, ''));

for (let lang of recognizedLangs) {
    console.assert(Prism.languages[lang], 'Prism lang definition not found: ' + lang);
}

console.log('Testing whether all available languages are used');
// There is no point in importing languages that we don't use.
let supportedlangs = new Set(Object.keys(Prism.languages));
// Some implementation details that prism.js adds to Prism.languages.
supportedlangs.delete('extend');
supportedlangs.delete('insertBefore');
supportedlangs.delete('DFS');
supportedlangs.delete('clike');
for (let lang of supportedlangs) {
    let recognized = recognizedLangs.includes(lang);
    if (!recognized) { // Maybe it is an alias.
        for (let otherLang of recognizedLangs) {
            if (Prism.languages[otherLang] === Prism.languages[lang]) {
                recognized = true;
                break;
            }
        }
    }
    if (recognized) {
        supportedlangs.delete(lang);
    }
}
for (let lang of supportedlangs) {
    console.assert(false, 'Prism language imported, but not used: ' + lang);
}

console.log('Language detection');
let langExpectations = [
    // A few random cases.
    ['javascript', 'js'],
    ['javascript', '.js'],
    ['markup', 'html'],

    // Backup.
    ['javascript', 'js~'],
    ['javascript', 'js.bak'],

    // Unknown.
    ['', 'js.yadayadayada'],
    ['', ''],
    ['', '.'],
    ['', '~'],
    ['', '', 'a'],

    // Not based on file name.
    ['markup', '', '<'],
    ['markup', 'yadayadayada', '<'],
];
for (let [expected, filename, code] of langExpectations) {
    let actual = Prism.rob.detectLanguage(code, filename);
    console.assert(actual === expected, `detectLanguage('${code}', '${filename}'); expected ${expected}, got ${actual}`);
}

