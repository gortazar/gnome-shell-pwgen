// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// ci/smoke-test.sh installs the extension and rewrites GNOME Shell's
// enabled-extensions, both of which are destructive outside a throwaway
// container: run on a developer machine it used to install into the real
// ~/.local/share/gnome-shell/extensions (through the symlinks install.sh leaves
// there, so it overwrote the working copy those point at) and replace the live
// session's extension list with just this one.
//
// The script now builds its own HOME and XDG_RUNTIME_DIR, which is the property
// checked here: every path it writes to has to come from that throwaway root, not
// from the environment it inherited.

import Gio from 'gi://Gio';

import { assert, test } from './harness.js';

// GJS 1.80 has no URL global, so derive the checkout path from the module URL.
const ROOT_DIR = import.meta.url.replace(/^file:\/\//, '').replace(/\/tests\/[^/]+$/, '');

function readText(path) {
    const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
    assert(ok, `could not read ${path}`);
    return new TextDecoder().decode(bytes);
}

// Lines that are only a comment cannot write anywhere.
function codeLines(source) {
    return source.split('\n').filter(line => !/^\s*(#|$)/.test(line));
}

test('the smoke test builds its own HOME instead of using the caller\'s', async () => {
    const source = readText(`${ROOT_DIR}/ci/smoke-test.sh`);
    const lines = codeLines(source);

    const assignsHome = lines.findIndex(line => /^\s*export\s+HOME=|^\s*HOME=/.test(line));
    assert(assignsHome !== -1,
        'ci/smoke-test.sh never assigns HOME: it would install into the real ' +
        'home directory of whoever runs it');

    // An assignment that just re-exports the inherited value is no protection.
    assert(!/^\s*(export\s+)?HOME="?\$\{?HOME/.test(lines[assignsHome]),
        `ci/smoke-test.sh derives HOME from the inherited HOME: ${lines[assignsHome].trim()}`);

    const firstUse = lines.findIndex(line => /\$\{?HOME\b/.test(line));
    assert(firstUse === -1 || firstUse >= assignsHome,
        `ci/smoke-test.sh reads HOME at "${lines[firstUse]?.trim()}" before assigning it`);
});

test('the smoke test does not write into the caller\'s XDG_RUNTIME_DIR', async () => {
    const source = readText(`${ROOT_DIR}/ci/smoke-test.sh`);
    const line = codeLines(source)
        .find(l => /^\s*(export\s+)?XDG_RUNTIME_DIR=/.test(l));

    assert(line, 'ci/smoke-test.sh never sets XDG_RUNTIME_DIR');
    // `${XDG_RUNTIME_DIR:-...}` keeps the caller's when they have one, which on a
    // desktop is the live session's /run/user/$UID.
    assert(!/\$\{?XDG_RUNTIME_DIR[:-]/.test(line),
        `ci/smoke-test.sh falls back to the inherited XDG_RUNTIME_DIR: ${line.trim()}`);
});
