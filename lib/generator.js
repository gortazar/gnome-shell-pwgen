// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// This program is free software; you can redistribute it and/or modify it under
// the terms of the GNU General Public License as published by the Free Software
// Foundation; either version 2 of the License, or (at your option) any later
// version. See the LICENSE file for the full text.
//
// In-process password generation. Deliberately free of any gnome-shell import
// (no St, Clutter, Shell, no resource:/// URI) so the same file that runs in the
// compositor also runs under plain `gjs` in CI. tests/purity-test.js enforces it.

import Gio from 'gi://Gio';

/** Character classes a password can draw from. */
export const CHARSETS = {
    lowercase: 'abcdefghijklmnopqrstuvwxyz',
    uppercase: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    digits: '0123456789',
    // The printable non-alphanumeric ASCII set, matching what `pwgen -y` drew
    // from before generation moved in-process.
    symbols: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~',
};

// Read in blocks rather than a byte at a time: rejection sampling asks for one or
// two bytes per character, and a syscall per byte would be wasteful.
const CHUNK_SIZE = 256;

/**
 * Reads `count` bytes from the OS entropy pool.
 *
 * Prefers `crypto.getRandomValues` when the GJS behind the running shell exposes
 * it (GJS 1.80, which ships with GNOME 46, does not), and otherwise reads
 * /dev/urandom through the async Gio API so the compositor's main loop keeps
 * running. There is no third path: if neither works this rejects, and the caller
 * reports a failure rather than falling back to a weak generator.
 *
 * @param {number} count how many bytes to read
 * @param {Gio.Cancellable} [cancellable] aborts the read; see {@link generate}
 * @returns {Promise<Uint8Array>}
 */
export async function randomBytes(count, cancellable = null) {
    if (!Number.isInteger(count) || count < 0)
        throw new Error(`randomBytes: invalid count ${count}`);
    // Throws a genuine Gio CANCELLED error when the cancellable is already
    // cancelled: GJS turns the GError out-parameter into an exception. Doing it
    // this way keeps this module free of a GLib import, and covers the
    // getRandomValues path below, which Gio never sees.
    cancellable?.set_error_if_cancelled();
    if (count === 0)
        return new Uint8Array(0);

    const webcrypto = globalThis.crypto;
    if (webcrypto && typeof webcrypto.getRandomValues === 'function')
        return webcrypto.getRandomValues(new Uint8Array(count));

    return readUrandom(count, cancellable);
}

function readUrandom(count, cancellable = null) {
    return new Promise((resolve, reject) => {
        const file = Gio.File.new_for_path('/dev/urandom');
        file.read_async(GLib_PRIORITY_DEFAULT, cancellable, (source, openResult) => {
            let stream;
            try {
                stream = source.read_finish(openResult);
            } catch (error) {
                reject(error);
                return;
            }

            // A short read is possible in principle; keep asking until the
            // request is filled, and treat end-of-stream as a hard failure.
            const out = new Uint8Array(count);
            let filled = 0;

            const readMore = () => {
                stream.read_bytes_async(count - filled, GLib_PRIORITY_DEFAULT, cancellable,
                    (bytesSource, readResult) => {
                        try {
                            const bytes = bytesSource.read_bytes_finish(readResult);
                            const chunk = bytes.toArray();
                            if (chunk.length === 0)
                                throw new Error('/dev/urandom returned no data');
                            out.set(chunk, filled);
                            filled += chunk.length;
                            if (filled < count) {
                                readMore();
                                return;
                            }
                            stream.close_async(GLib_PRIORITY_DEFAULT, null, () => {});
                            resolve(out);
                        } catch (error) {
                            stream.close_async(GLib_PRIORITY_DEFAULT, null, () => {});
                            reject(error);
                        }
                    });
            };

            readMore();
        });
    });
}

// GLib is not imported here on purpose: the priority constant is all that would
// be needed from it, and Gio's default priority is the same value.
const GLib_PRIORITY_DEFAULT = 0;

/**
 * Wraps {@link randomBytes} in a buffer so small draws do not each cost a read.
 *
 * Every function below takes a source of this shape — an object with an
 * `async bytes(n)` method — which is also what the tests inject to make draws
 * deterministic.
 *
 * @param {(count: number, cancellable?: Gio.Cancellable) => Promise<Uint8Array>} [read] entropy reader
 * @param {Gio.Cancellable} [cancellable] passed to every read, and checked before
 *   each draw so a cancellation is noticed even while the buffer still has bytes
 * @returns {{bytes: (count: number) => Promise<Uint8Array>}}
 */
export function bufferedSource(read = randomBytes, cancellable = null) {
    let buffer = new Uint8Array(0);
    let offset = 0;

    return {
        async bytes(count) {
            cancellable?.set_error_if_cancelled();
            if (buffer.length - offset < count) {
                buffer = await read(Math.max(count, CHUNK_SIZE), cancellable);
                offset = 0;
                if (buffer.length < count)
                    throw new Error('entropy source returned too few bytes');
            }
            const out = buffer.subarray(offset, offset + count);
            offset += count;
            return out;
        },
    };
}

/**
 * Uniform random integer in `[0, bound)`.
 *
 * Uses rejection sampling: `byte % bound` would make the first `256 % bound`
 * values more likely than the rest, which for a 94-character set is a measurable
 * bias in every generated password.
 *
 * @param {number} bound exclusive upper bound, a positive integer
 * @param {{bytes: (count: number) => Promise<Uint8Array>}} [source] entropy source
 * @returns {Promise<number>}
 */
export async function randomIntBelow(bound, source = bufferedSource()) {
    if (!Number.isInteger(bound) || bound < 1)
        throw new Error(`randomIntBelow: invalid bound ${bound}`);
    if (bound === 1)
        return 0;

    const width = Math.ceil(Math.log2(bound) / 8) || 1;
    const range = 2 ** (8 * width);
    // Largest multiple of `bound` that fits the draw; anything at or above it is
    // discarded so the accepted values divide evenly.
    const limit = range - (range % bound);

    for (;;) {
        const bytes = await source.bytes(width);
        let value = 0;
        for (const byte of bytes)
            value = value * 256 + byte;
        if (value < limit)
            return value % bound;
    }
}

/**
 * Fisher-Yates shuffle in place, driven by the CSPRNG.
 *
 * @param {Array} array shuffled in place and returned
 * @param {{bytes: (count: number) => Promise<Uint8Array>}} [source] entropy source
 * @returns {Promise<Array>} the same array
 */
export async function shuffle(array, source = bufferedSource()) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = await randomIntBelow(i + 1, source);
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

function enabledClasses(classes) {
    return Object.keys(CHARSETS).filter(name => classes?.[name]);
}

/**
 * Generates one password.
 *
 * Every enabled class is guaranteed to appear: one character is drawn per class
 * first, the remainder from the union of all enabled classes, and the result is
 * shuffled — so the guaranteed characters land in random positions instead of a
 * predictable prefix.
 *
 * Pass a `cancellable` to abort a generation that is no longer wanted: the
 * extension cancels when its indicator is destroyed, so an in-flight read does
 * not outlive the menu it would update. A cancelled generation rejects with Gio's
 * CANCELLED error and never resolves with a partial or weaker password.
 *
 * @param {object} options
 * @param {number} options.length number of characters, at least one per class
 * @param {object} options.classes `{lowercase, uppercase, digits, symbols}` booleans
 * @param {Gio.Cancellable} [options.cancellable] aborts the generation
 * @param {object} [options.source] entropy source, for tests
 * @returns {Promise<string>}
 */
export async function generate({
    length, classes, cancellable = null,
    source = bufferedSource(randomBytes, cancellable),
}) {
    const enabled = enabledClasses(classes);
    if (enabled.length === 0)
        throw new Error('generate: no character classes enabled');
    if (!Number.isInteger(length) || length < 1)
        throw new Error(`generate: invalid length ${length}`);
    if (length < enabled.length) {
        throw new Error(`generate: length ${length} cannot hold one character ` +
            `from each of the ${enabled.length} enabled classes`);
    }

    const pool = enabled.map(name => CHARSETS[name]).join('');
    const chars = [];
    for (const name of enabled) {
        const charset = CHARSETS[name];
        chars.push(charset[await randomIntBelow(charset.length, source)]);
    }
    while (chars.length < length)
        chars.push(pool[await randomIntBelow(pool.length, source)]);

    await shuffle(chars, source);
    return chars.join('');
}

/**
 * Generates `count` independent passwords.
 *
 * @param {object} options same as {@link generate}, plus `count`
 * @returns {Promise<string[]>}
 */
export async function generateMany({
    length, classes, count, cancellable = null,
    source = bufferedSource(randomBytes, cancellable),
}) {
    if (!Number.isInteger(count) || count < 1)
        throw new Error(`generateMany: invalid count ${count}`);

    const passwords = [];
    for (let i = 0; i < count; i++)
        passwords.push(await generate({ length, classes, cancellable, source }));
    return passwords;
}
