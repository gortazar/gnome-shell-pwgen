// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// The generator has to stay loadable outside gnome-shell, otherwise these tests
// cannot run in CI at all. Importing St, Clutter, Shell or a resource:/// URI
// would break that, so it is checked rather than trusted.

import Gio from 'gi://Gio';

import { assert, test } from './harness.js';

// import.meta.url points at this file inside the checkout, so the paths below
// follow the sources wherever the repository sits.
// GJS 1.80 has no URL global, so the paths are derived from the module URL by
// hand. import.meta.url points at this file inside the checkout, so they follow
// the sources wherever the repository sits.
const ROOT_DIR = import.meta.url.replace(/^file:\/\//, '').replace(/\/tests\/[^/]+$/, '');
const LIB_DIR = `${ROOT_DIR}/lib`;

const FORBIDDEN = [
    /from\s+['"]resource:\/\//,
    /from\s+['"]gi:\/\/St['"]/,
    /from\s+['"]gi:\/\/Clutter['"]/,
    /from\s+['"]gi:\/\/Shell['"]/,
    /from\s+['"]gi:\/\/Meta['"]/,
    /from\s+['"]gi:\/\/Gtk['"]/,
    /from\s+['"]gi:\/\/Adw['"]/,
];

function readText(path) {
    const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
    assert(ok, `could not read ${path}`);
    return new TextDecoder().decode(bytes);
}

function libFiles() {
    const dir = Gio.File.new_for_path(LIB_DIR);
    const enumerator = dir.enumerate_children('standard::name',
        Gio.FileQueryInfoFlags.NONE, null);
    const names = [];
    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        if (info.get_name().endsWith('.js'))
            names.push(`${LIB_DIR}/${info.get_name()}`);
    }
    enumerator.close(null);
    return names;
}

test('lib/ imports nothing that only exists inside gnome-shell', async () => {
    const files = libFiles();
    assert(files.length > 0, `no JavaScript found in ${LIB_DIR}`);
    for (const path of files) {
        const source = readText(path);
        for (const pattern of FORBIDDEN)
            assert(!pattern.test(source), `${path} imports ${pattern}`);
    }
});

test('nothing in the extension spawns an external process', async () => {
    const root = ROOT_DIR;
    for (const name of ['extension.js', 'prefs.js', 'lib/generator.js']) {
        const source = readText(`${root}/${name}`);
        for (const pattern of [/Gio\.Subprocess/, /GLib\.spawn/, /Gio\.AppInfo/]) {
            assert(!pattern.test(source), `${name} still matches ${pattern}`);
        }
    }
});

test('the generator never uses a non-cryptographic random source', async () => {
    const source = readText(`${LIB_DIR}/generator.js`);
    for (const pattern of [/Math\.random/, /GLib\.random/, /Gio\.random/])
        assert(!pattern.test(source), `generator.js matches ${pattern}`);
});
