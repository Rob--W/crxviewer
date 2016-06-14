#!/usr/bin/env node
// Build tool, adapted from PDF.js
/* jshint node:true */
/* globals cat, cd, cp, echo, env, exec, exit, find, ls, mkdir, mv, process, rm,
           sed, target, test */

'use strict';
require('shelljs/make');
var builder = require('./external/builder');


var ROOT_DIR = __dirname + '/';
var BUILD_DIR = ROOT_DIR + 'dist/';
var SRC_DIR = ROOT_DIR + 'src/';
var CHROME_BUILD_DIR = BUILD_DIR + 'chrome/';
var OPERA_BUILD_DIR = BUILD_DIR + 'opera/';
var WEB_BUILD_DIR = BUILD_DIR + 'web/';

function getBuildConfig(options) {
    var dest_dir = options.build_dir;
    var setup = {
        defines: {
            CHROME: false,
            OPERA: false
        },
        copy: [
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

function build(setup, output_root_dir) {
    cleanDirectory(output_root_dir);
    builder.build(setup);
    exec(ROOT_DIR + '/node_modules/.bin/lessc --strict-math=on "' + SRC_DIR + 'crxviewer.less" "' + output_root_dir + 'crxviewer.css"');
    cd(output_root_dir);
    rm('lib/beautify/jsbeautifier/get-jsb.sh');
    rm('lib/zip.js/VERSION');
}

target.all = function() {
    target.chrome();
    target.opera();
    target.web();
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
};

target.web = function() {
    echo();
    echo('Building online demo...');
    var dest_dir = WEB_BUILD_DIR;
    var setup = {
        defines: {
            CHROME: false,
            OPERA: false
        },
        copy: [
            [SRC_DIR + '*.css', dest_dir],
            [SRC_DIR + 'lib', dest_dir],
            [SRC_DIR + 'chrome-platform-info.js', dest_dir],
            [SRC_DIR + 'cws_pattern.js', dest_dir]
        ],
        preprocess: [
            [SRC_DIR + 'crxviewer.html', dest_dir],
            [SRC_DIR + 'crxviewer.js', dest_dir]
        ]
    };
    build(setup, WEB_BUILD_DIR);
};
