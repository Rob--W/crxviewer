/**
 * (c) 2026 Subham Mahesh
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Generates third-party-licenses.js for the License & Credits page:
 * - the license of this project (LICENSE),
 * - every npm package that is bundled into src/lib/ (see external/bundles.js;
 *   found by asking esbuild which files each bundle contains), with the
 *   name, version, license and license text from the package itself,
 * - third-party code embedded inside those npm packages, and libraries copied
 *   into src/lib/ without npm, both described in components.json.
 */
/* jshint node:true, esversion:8 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT_DIR = path.join(__dirname, '..', '..') + '/';
var bundles = require('../bundles');
var LICENSE_FILE_NAMES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license', 'license.md', 'LICENCE', 'COPYING'];

function read(file) {
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function findLicenseText(packageDir) {
    for (var i = 0; i < LICENSE_FILE_NAMES.length; ++i) {
        var file = path.join(packageDir, LICENSE_FILE_NAMES[i]);
        if (fs.existsSync(file)) return read(file).trim();
    }
    return null;
}

function firstCopyrightLine(text) {
    var match = /^.*Copyright.*$/im.exec(text || '');
    return match ? match[0].trim() : '';
}

function personToString(person) {
    if (!person) return '';
    if (typeof person === 'string') return person;
    return person.name + (person.email ? ' <' + person.email + '>' : '');
}

function repositoryUrl(pkg) {
    var repo = pkg.repository;
    var url = typeof repo === 'string' ? repo : repo && repo.url;
    if (!url) return pkg.homepage || '';
    return url.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
}

function describeNpmPackage(name, usedFor) {
    var packageDir = path.join(ROOT_DIR, 'node_modules', name);
    var pkg = JSON.parse(read(path.join(packageDir, 'package.json')));
    var licenseText = findLicenseText(packageDir);
    if (!licenseText) {
        throw new Error('No license file found for npm package ' + name);
    }
    return {
        name: name,
        version: pkg.version,
        license: typeof pkg.license === 'string' ? pkg.license : (pkg.license && pkg.license.type) || '',
        copyright: firstCopyrightLine(licenseText) || personToString(pkg.author),
        homepage: repositoryUrl(pkg) || pkg.homepage || '',
        usedFor: usedFor,
        source: 'npm',
        licenseText: licenseText,
    };
}

// The first block comment of a file, without the comment markers.
function licenseFromHeader(file, startsWith) {
    var source = read(path.join(ROOT_DIR, file));
    var start = startsWith ? source.indexOf(startsWith) : source.indexOf('/*') + 2;
    if (start < 0) {
        throw new Error('License text not found in ' + file);
    }
    var end = source.indexOf('*/', start);
    var lines = source.slice(start, end).split('\n').map(function(line) {
        return line.replace(/^\s*\*?\s?/, '').replace(/\s+$/, '');
    });
    // Remove the common indentation and surrounding blank lines.
    while (lines.length && !lines[0]) lines.shift();
    while (lines.length && !lines[lines.length - 1]) lines.pop();
    return lines.join('\n');
}

function describeVendored(item) {
    var spec = item.licenseText;
    var text;
    if (spec.fromHeader) {
        text = licenseFromHeader(spec.fromHeader, spec.startsWith);
    } else if (spec.file) {
        text = read(path.join(ROOT_DIR, spec.file)).trim();
    } else if (spec.template) {
        text = read(path.join(__dirname, spec.template + '.template'))
            .replace('{{copyright}}', spec.copyright).trim();
    }
    if (!text) throw new Error('No license text for ' + item.name);
    // E.g. credits for code that the library is based on.
    var notice = item.additionalNotice ?
        licenseFromHeader(item.additionalNotice.fromHeader, item.additionalNotice.startsWith) : '';
    return {
        name: item.name,
        version: item.version,
        license: item.license,
        copyright: spec.copyright || firstCopyrightLine(text),
        homepage: item.homepage,
        usedFor: item.usedFor,
        files: item.files,
        note: item.note || '',
        notice: notice,
        source: 'included in lib/',
        licenseText: text,
    };
}

// Every npm package in any bundle; a package used by several bundles is listed once.
function getNpmComponents() {
    var byName = new Map();
    bundles.BUNDLES.forEach(function(bundle) {
        bundles.getBundledPackageNames(bundle).forEach(function(name) {
            if (byName.has(name)) {
                byName.get(name).usedFor += '; ' + bundle.usedFor;
            } else {
                var component = describeNpmPackage(name, bundle.usedFor);
                component.bundle = bundle.id;
                byName.set(name, component);
            }
        });
    });
    return Array.from(byName.values());
}

// Third-party code copied inside a bundled npm package, listed after that package.
function withEmbedded(npmComponents, embedded) {
    var result = [];
    npmComponents.forEach(function(component) {
        result.push(component);
        embedded.filter(function(item) {
            return item.embeddedIn === component.name;
        }).forEach(function(item) {
            var text = read(path.join(ROOT_DIR, item.licenseFile)).trim();
            result.push({
                name: item.name,
                version: item.version,
                license: item.license,
                copyright: firstCopyrightLine(text),
                homepage: item.homepage,
                usedFor: item.usedFor,
                note: item.note || '',
                source: 'npm',
                bundle: component.bundle,
                embeddedIn: component.name,
                licenseText: text,
            });
        });
    });
    return result;
}

function generate(outputFile) {
    var config = JSON.parse(read(path.join(__dirname, 'components.json')));
    var project = config.project;
    var data = {
        generatedAt: new Date().toISOString().slice(0, 10),
        project: {
            name: project.name,
            license: project.license,
            originalWork: project.originalWork,
            modifications: project.modifications,
            licenseText: read(path.join(ROOT_DIR, project.licenseFile)).trim(),
        },
        components: config.vendored.map(describeVendored).concat(withEmbedded(getNpmComponents(), config.embedded || [])),
    };
    var output =
        '// Generated by external/licenses/generate.js (node make.js licenses). Do not edit.\n' +
        '/* exported LICENSE_DATA */\n' +
        'var LICENSE_DATA = ' + JSON.stringify(data, null, 1) + ';\n';
    fs.writeFileSync(outputFile, output);
    return data;
}

exports.generate = generate;

if (require.main === module) {
    var data = generate(process.argv[2] || 'third-party-licenses.js');
    data.components.forEach(function(c) {
        console.log(c.license.padEnd(14) + c.name + ' ' + c.version);
    });
}
