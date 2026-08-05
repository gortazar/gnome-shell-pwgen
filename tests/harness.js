// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Minimal async test harness for plain `gjs -m`. Not shipped in the extension
// package: nothing under tests/ is uploaded to extensions.gnome.org.

import GLib from 'gi://GLib';
import System from 'system';

const cases = [];

export function test(name, fn) {
    cases.push({ name, fn });
}

export function assert(cond, message) {
    if (!cond)
        throw new Error(message || 'assertion failed');
}

export function assertEquals(actual, expected, message) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    assert(a === e, `${message || 'not equal'}: expected ${e}, got ${a}`);
}

export async function assertThrows(fn, message) {
    try {
        await fn();
    } catch {
        return;
    }
    throw new Error(message || 'expected a throw, but nothing was thrown');
}

// Runs every registered case in order and exits with 1 if any failed. The loop
// is needed because the code under test uses the async Gio API, which only makes
// progress while a main loop is running.
export function run() {
    const loop = new GLib.MainLoop(null, false);
    let failures = 0;

    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
        (async () => {
            for (const { name, fn } of cases) {
                try {
                    await fn();
                    print(`ok   ${name}`);
                } catch (error) {
                    failures++;
                    print(`FAIL ${name}`);
                    print(`     ${error.message || error}`);
                    if (error.stack)
                        print(`     ${String(error.stack).split('\n').join('\n     ')}`);
                }
            }
            print(`\n${cases.length - failures}/${cases.length} passed`);
            loop.quit();
        })();

        return GLib.SOURCE_REMOVE;
    });

    loop.run();
    System.exit(failures === 0 ? 0 : 1);
}
