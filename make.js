#!/usr/bin/env node
/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Build tool, adapted from PDF.js
/* jshint node:true */
/* globals cd, cp, echo, exec, find, grep, mkdir, rm, target, test */

'use strict';
require('shelljs/make');
var builder = require('./external/builder');


var ROOT_DIR = __dirname + '/';
var BUILD_DIR = ROOT_DIR + 'dist/';
var SRC_DIR = ROOT_DIR + 'src/';
var XUL_SRC_DIR = ROOT_DIR + 'xul/';
var CHROME_BUILD_DIR = BUILD_DIR + 'chrome/';
var OPERA_BUILD_DIR = BUILD_DIR + 'opera/';
var FIREFOX_BUILD_DIR = BUILD_DIR + 'firefox/';
var WEB_BUILD_DIR = BUILD_DIR + 'web/';
var XUL_BUILD_DIR = BUILD_DIR + 'xul/';
var ALLOWED_FILES = [
    'manifest.json',
    '.css',
    '.html',
    '.js',
    '.png',
];

function getVersionString() {
    cd(ROOT_DIR);
    var gitHash = exec('git log --format=%H -n1', {silent: true}).stdout.trim();
    return gitHash || '(unknown version)';
}

function getBuildConfig(options) {
    var dest_dir = options.build_dir;
    var setup = {
        defines: {
            CHROME: false,
            FIREFOX: false,
            OPERA: false,
            WEB: false,
            XUL: false,
            VERSION: getVersionString(),
        },
        mkdirs: [
            dest_dir + 'icons',
        ],
        copy: [
            [SRC_DIR + 'lib', dest_dir],
            [SRC_DIR + 'icons/*.png', dest_dir + 'icons']
        ],
        preprocess: [
            [SRC_DIR + '*.html', dest_dir],
            [SRC_DIR + '*.js', dest_dir],
            [SRC_DIR + 'lib/crx-to-zip.js', dest_dir + 'lib'],
        ]
    };
    if (options.defines)
        for (var key in options.defines)
            setup.defines[key] = options.defines[key];
    if (options.copy) [].push.apply(setup.copy, options.copy);
    if (options.preprocess) [].push.apply(setup.preprocess, options.preprocess);

    return setup;
}
function cleanDirectory(dir) {
    if (test('-d', dir))
        rm('-rf', dir + '*'); // Append wildcard to preserve the directory
    else
        mkdir('-p', dir);
}

function build(setup, output_root_dir) {
    cleanDirectory(output_root_dir);
    builder.build(setup);
    exec(ROOT_DIR + '/node_modules/.bin/lessc --strict-math=on "' + SRC_DIR + 'crxviewer.less" "' + output_root_dir + 'crxviewer.css"');
    cd(output_root_dir);
    rm('lib/beautify/jsbeautifier/get-jsb.sh');
}

function lintDir(dest_dir) {
    var warningCount = 0;
    find(dest_dir).forEach(function(filepath) {
        if (/\/\.[^\/]*$/.test(filepath)) {
            echo('WARNING: Found dot file: ' + filepath);
            ++warningCount;
            return;
        }
        if (test('-d', filepath)) {
            return;
        }
        var unprocessed = grep('//#', filepath).trim();
        if (unprocessed) {
            echo('WARNING: unprocessed text in' + filepath);
            echo(unprocessed);
            ++warningCount;
        }
        if (!ALLOWED_FILES.some(function(p) {
            return p.test ? p.test(filepath) : filepath.endsWith(p);
        })) {
            echo('WARNING: Unrecognized file: ' + filepath);
            ++warningCount;
        }
    });
    if (warningCount) {
        process.nextTick(function() {
            echo('WARNING: ' + warningCount + ' warnings in ' + dest_dir);
        });
    }
}

target.all = function() {
    target.chrome();
    target.opera();
    target.firefox();
    target.web();
    target.xul();
};

target.chrome = function() {
    echo();
    echo('Building Chrome extension...');
    var setup = getBuildConfig({
        build_dir: CHROME_BUILD_DIR,
        defines: {
            CHROME: true
        },
        copy: [
            [SRC_DIR + 'manifest.json', CHROME_BUILD_DIR]
        ]
    });
    build(setup, CHROME_BUILD_DIR);

    cd(CHROME_BUILD_DIR);
    rm('-f', '../crxviewer.zip');
    exec('7z a ../crxviewer.zip * -tzip');
    lintDir(CHROME_BUILD_DIR);
};

target.opera = function() {
    echo();
    echo('Building Opera extension...');
    var setup = getBuildConfig({
        build_dir: OPERA_BUILD_DIR,
        defines: {
            OPERA: true
        }
    });
    build(setup, OPERA_BUILD_DIR);
    cp(SRC_DIR + 'manifest_opera.json', OPERA_BUILD_DIR + 'manifest.json');

    cd(OPERA_BUILD_DIR);
    rm('-f', '../crxviewer_opera.zip');
    exec('7z a ../crxviewer_opera.zip * -tzip');
    lintDir(OPERA_BUILD_DIR);
};

target.firefox = function() {
    echo();
    echo('Building Firefox addon...');
    var setup = getBuildConfig({
        build_dir: FIREFOX_BUILD_DIR,
        defines: {
            FIREFOX: true
        }
    });
    build(setup, FIREFOX_BUILD_DIR);
    cp(SRC_DIR + 'manifest_firefox.json', FIREFOX_BUILD_DIR + 'manifest.json');

    cd(FIREFOX_BUILD_DIR);
    // Split incognito is not supported in Firefox.
    rm('incognito-events.js');
    rm('-f', '../crxviewer_firefox.zip');
    exec('7z a ../crxviewer_firefox.zip * -tzip');
    lintDir(FIREFOX_BUILD_DIR);
};

target.web = function() {
    echo();
    echo('Building online demo...');
    var dest_dir = WEB_BUILD_DIR;
    var setup = {
        defines: {
            CHROME: false,
            FIREFOX: false,
            OPERA: false,
            XUL: false,
            WEB: true,
            VERSION: getVersionString(),
        },
        copy: [
            [SRC_DIR + 'search-worker.js', dest_dir],
            [SRC_DIR + 'search-tools.js', dest_dir],
            [SRC_DIR + 'lib', dest_dir],
            [SRC_DIR + 'chrome-platform-info.js', dest_dir],
        ],
        preprocess: [
            [SRC_DIR + 'crxviewer.html', dest_dir],
            [SRC_DIR + 'crxviewer.js', dest_dir],
            [SRC_DIR + 'cws_pattern.js', dest_dir],
            [SRC_DIR + 'lib/crx-to-zip.js', dest_dir + 'lib'],
        ]
    };
    build(setup, WEB_BUILD_DIR);
    lintDir(WEB_BUILD_DIR);
};

target.xul = function() {
    echo();
    echo('Building XUL extension...');
    var dest_dir = XUL_BUILD_DIR;
    var setup = {
        defines: {
            CHROME: false,
            FIREFOX: false,
            OPERA: false,
            WEB: false,
            XUL: true,
            VERSION: getVersionString(),
        },
        copy: [
            [SRC_DIR + 'search-worker.js', dest_dir],
            [SRC_DIR + 'search-tools.js', dest_dir],
            [SRC_DIR + 'lib', dest_dir],
            [SRC_DIR + 'chrome-platform-info.js', dest_dir],
        ],
        preprocess: [
            [SRC_DIR + 'crxviewer.html', dest_dir],
            [SRC_DIR + 'crxviewer.js', dest_dir],
            [SRC_DIR + 'cws_pattern.js', dest_dir],
            [SRC_DIR + 'lib/crx-to-zip.js', dest_dir + 'lib'],
        ]
    };
    build(setup, XUL_BUILD_DIR);
    cd(XUL_BUILD_DIR);
    mkdir('content');
    mv('*.*', 'lib', 'content');
    cp('-r', XUL_SRC_DIR + '/*', XUL_BUILD_DIR);
    rm('-f', '../crxviewer_xul.zip');
    exec('7z a ../crxviewer_xul.zip * -tzip');
    ALLOWED_FILES.push(
      'chrome.manifest',
      'install.rdf',
      'options.xul',
      'MatchPattern.jsm',
    );
    lintDir(XUL_BUILD_DIR);
};
