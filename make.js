#!/usr/bin/env node
// Build tool, adapted from PDF.js
/* jshint node:true */
/* globals cat, cd, cp, echo, env, exec, exit, find, ls, mkdir, mv, process, rm,
           sed, target, test */

'use strict';
require('shelljs/make');
var builder = require('./external/builder');
var path = require('path');


var ROOT_DIR = __dirname + '/';
var BUILD_DIR = ROOT_DIR + 'dist/';
var SRC_DIR = ROOT_DIR + 'src/';
var CHROME_BUILD_DIR = BUILD_DIR + 'chrome/';
var OPERA_BUILD_DIR = BUILD_DIR + 'opera/';
var OPERA_NEX_PEM = ROOT_DIR + 'crxviewer.pem';

function getBuildConfig(options) {
    var dest_dir = options.build_dir;
    var setup = {
        defines: {
            CHROME: false,
            OPERA: false
        },
        copy: [
            [SRC_DIR + '*.css', dest_dir],
            [SRC_DIR + 'lib', dest_dir],
            [SRC_DIR + 'icons/*.png', dest_dir + 'icons']
        ],
        preprocess: [
            [SRC_DIR + '*.html', dest_dir],
            [SRC_DIR + '*.js', dest_dir],
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

target.all = function() {
    target.chrome();
    target.opera();
};

target.chrome = function() {
    echo();
    echo('Building Chrome extension...');
    var setup = getBuildConfig({
        build_dir: CHROME_BUILD_DIR,
        defines: {
            CHRONE: true
        },
        copy: [
            [SRC_DIR + 'manifest.json', CHROME_BUILD_DIR]
        ]
    });
    cleanDirectory(CHROME_BUILD_DIR);
    builder.build(setup);

    cd(CHROME_BUILD_DIR);
    exec('lessc "' + SRC_DIR + 'crxviewer.less" "' + CHROME_BUILD_DIR + 'crxviewer.css"');
    rm('-f', '../crxviewer.zip');
    exec('7z a ../crxviewer.zip * -tzip');
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
    cleanDirectory(OPERA_BUILD_DIR);
    builder.build(setup);
    cp(SRC_DIR + 'manifest_opera.json', OPERA_BUILD_DIR + 'manifest.json');

    cd(BUILD_DIR);
    exec('lessc "' + SRC_DIR + 'crxviewer.less" "' + OPERA_BUILD_DIR + 'crxviewer.css"');
    exec('chromium --pack-extension="' + OPERA_BUILD_DIR + '" --pack-extension-key="' + OPERA_NEX_PEM + '"');
    mv('-f', path.basename(OPERA_BUILD_DIR) + '.crx', 'crxviewer.nex');
};
