// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Unit tests for lib/generator.js. Runs under plain `gjs`, no display and no
// GNOME Shell: the module under test only imports Gio/GLib.

import Gio from 'gi://Gio';

import {
    CHARSETS,
    bufferedSource,
    generate,
    generateMany,
    randomBytes,
    randomIntBelow,
    shuffle,
} from '../lib/generator.js';

import { assert, assertEquals, assertThrows, test } from './harness.js';

// A byte source that hands out a fixed script of bytes, so every draw is
// predictable. Throws when exhausted, which turns "read more bytes than
// expected" into a test failure rather than a silent difference.
function scriptedSource(script) {
    const bytes = Uint8Array.from(script);
    let offset = 0;
    return {
        get consumed() {
            return offset;
        },
        async bytes(n) {
            if (offset + n > bytes.length)
                throw new Error(`scripted source exhausted after ${offset} bytes`);
            const out = bytes.slice(offset, offset + n);
            offset += n;
            return out;
        },
    };
}

const ALL_CLASSES = {
    lowercase: true,
    uppercase: true,
    digits: true,
    symbols: true,
};

const everyChar = classes => Object.keys(classes)
    .filter(name => classes[name])
    .map(name => CHARSETS[name])
    .join('');

test('randomBytes returns the requested number of bytes', async () => {
    const bytes = await randomBytes(32);
    assert(bytes instanceof Uint8Array, 'expected a Uint8Array');
    assertEquals(bytes.length, 32, 'wrong length');
});

test('randomBytes from the real source is not constant', async () => {
    const a = await randomBytes(32);
    const b = await randomBytes(32);
    assert(String(a) !== String(b), 'two reads returned identical bytes');
    assert(a.some(byte => byte !== 0), 'all bytes were zero');
});

test('randomIntBelow rejects out-of-range bytes instead of taking a modulo', async () => {
    // With bound 10 the acceptance limit is 250, so 250..255 must all be
    // discarded and the draw retried. A `byte % 10` implementation would stop at
    // the first byte and answer 0.
    const source = scriptedSource([250, 251, 252, 253, 254, 255, 3]);
    assertEquals(await randomIntBelow(10, source), 3, 'wrong value');
    assertEquals(source.consumed, 7, 'did not consume every rejected byte');
});

test('randomIntBelow accepts a byte below the limit immediately', async () => {
    const source = scriptedSource([7]);
    assertEquals(await randomIntBelow(10, source), 7, 'wrong value');
    assertEquals(source.consumed, 1, 'consumed more bytes than needed');
});

test('randomIntBelow widens the draw for bounds above 256', async () => {
    const source = scriptedSource([1, 2]);
    assertEquals(await randomIntBelow(1000, source), (1 * 256 + 2) % 1000, 'wrong value');
    assertEquals(source.consumed, 2, 'expected a two-byte draw');
});

test('randomIntBelow(1) needs no entropy at all', async () => {
    const source = scriptedSource([]);
    assertEquals(await randomIntBelow(1, source), 0, 'wrong value');
    assertEquals(source.consumed, 0, 'consumed entropy for a single-value range');
});

test('randomIntBelow rejects non-positive bounds', async () => {
    await assertThrows(() => randomIntBelow(0), 'bound 0 was accepted');
    await assertThrows(() => randomIntBelow(-5), 'negative bound was accepted');
    await assertThrows(() => randomIntBelow(1.5), 'fractional bound was accepted');
});

test('randomIntBelow is roughly uniform over the range', async () => {
    // Chi-square goodness of fit over 26 buckets, 26 000 draws. The critical
    // value for 25 degrees of freedom at p=0.001 is 52.6; a modulo-biased
    // implementation over a 26-value range lands far above it.
    const buckets = new Array(26).fill(0);
    const draws = 26000;
    const source = bufferedSource();
    for (let i = 0; i < draws; i++)
        buckets[await randomIntBelow(26, source)]++;

    const expected = draws / buckets.length;
    const chiSquare = buckets.reduce(
        (sum, observed) => sum + ((observed - expected) ** 2) / expected, 0);
    assert(chiSquare < 52.6, `distribution looks skewed (chi-square ${chiSquare.toFixed(1)})`);
    assert(buckets.every(count => count > 0), 'some values never came up');
});

test('shuffle permutes in place using the given source', async () => {
    // Fisher-Yates walks i from the end down to 1, drawing randomIntBelow(i + 1)
    // each step. Drawing 0 every time swaps each position with index 0.
    const array = [1, 2, 3, 4];
    const source = scriptedSource([0, 0, 0]);
    const result = await shuffle(array, source);
    assert(result === array, 'expected the same array back');
    assertEquals(array, [2, 3, 4, 1], 'wrong permutation');
    assertEquals(source.consumed, 3, 'expected one draw per position but the first');
});

test('shuffle can leave an array untouched', async () => {
    // Each draw picking i itself is the identity permutation. Bounds are 4, 3, 2,
    // so the accepted bytes are 3, 2, 1.
    const array = [1, 2, 3, 4];
    await shuffle(array, scriptedSource([3, 2, 1]));
    assertEquals(array, [1, 2, 3, 4], 'wrong permutation');
});

test('generate honours the requested length', async () => {
    for (const length of [4, 14, 64, 128]) {
        const password = await generate({ length, classes: ALL_CLASSES });
        assertEquals(password.length, length, `wrong length for ${length}`);
    }
});

test('generate only uses characters from the enabled classes', async () => {
    const classes = { lowercase: true, uppercase: true, digits: false, symbols: false };
    const allowed = everyChar(classes);
    for (let i = 0; i < 50; i++) {
        const password = await generate({ length: 20, classes });
        for (const char of password)
            assert(allowed.includes(char), `unexpected character ${JSON.stringify(char)}`);
    }
});

test('generate includes at least one character from every enabled class', async () => {
    const cases = [
        ALL_CLASSES,
        { lowercase: true, uppercase: true, digits: true, symbols: false },
        { lowercase: true, uppercase: true, digits: false, symbols: true },
        { lowercase: true, uppercase: false, digits: false, symbols: false },
    ];
    for (const classes of cases) {
        const enabled = Object.keys(classes).filter(name => classes[name]);
        for (let i = 0; i < 50; i++) {
            const password = await generate({ length: enabled.length, classes });
            for (const name of enabled) {
                assert([...password].some(char => CHARSETS[name].includes(char)),
                    `class ${name} missing from a password of length ${enabled.length}`);
            }
        }
    }
});

test('guaranteed characters are not pinned to fixed positions', async () => {
    // Without the shuffle the one guaranteed digit would sit at the same index in
    // every password. Collect where the first digit lands across many samples.
    const classes = { lowercase: true, uppercase: false, digits: true, symbols: false };
    const positions = new Set();
    for (let i = 0; i < 200; i++) {
        const password = await generate({ length: 6, classes });
        positions.add([...password].findIndex(char => CHARSETS.digits.includes(char)));
    }
    assert(positions.size > 1,
        `the guaranteed digit always landed at index ${[...positions][0]}`);
});

test('generate rejects a length that cannot hold every enabled class', async () => {
    await assertThrows(
        () => generate({ length: 3, classes: ALL_CLASSES }),
        'length below the number of enabled classes was accepted');
});

test('generate rejects an empty class selection', async () => {
    await assertThrows(
        () => generate({ length: 12, classes: {} }),
        'no enabled classes was accepted');
    await assertThrows(
        () => generate({
            length: 12,
            classes: { lowercase: false, uppercase: false, digits: false, symbols: false },
        }),
        'all classes disabled was accepted');
});

test('generate rejects a non-integer or non-positive length', async () => {
    await assertThrows(() => generate({ length: 0, classes: ALL_CLASSES }), '0 accepted');
    await assertThrows(() => generate({ length: -8, classes: ALL_CLASSES }), 'negative accepted');
    await assertThrows(() => generate({ length: 12.5, classes: ALL_CLASSES }), 'fraction accepted');
});

test('generateMany returns the requested number of distinct passwords', async () => {
    const passwords = await generateMany({ length: 14, classes: ALL_CLASSES, count: 5 });
    assertEquals(passwords.length, 5, 'wrong count');
    assertEquals(new Set(passwords).size, 5, 'generated the same password twice');
    for (const password of passwords)
        assertEquals(password.length, 14, 'wrong length');
});

test('generateMany rejects a non-positive count', async () => {
    await assertThrows(
        () => generateMany({ length: 14, classes: ALL_CLASSES, count: 0 }),
        'count 0 was accepted');
});

test('a failing entropy source refuses to produce a password', async () => {
    // The failure mode that matters: never a weak fallback, always an error.
    const broken = {
        async bytes() {
            throw new Error('no entropy');
        },
    };
    await assertThrows(
        () => generate({ length: 14, classes: ALL_CLASSES, source: broken }),
        'a password was produced without entropy');
});

test('every class charset is non-empty and free of duplicates', async () => {
    for (const [name, charset] of Object.entries(CHARSETS)) {
        assert(charset.length > 0, `${name} is empty`);
        assertEquals(new Set(charset).size, charset.length, `${name} has duplicate characters`);
    }
});

// --- Cancellation ------------------------------------------------------------
//
// The shell can disable the extension while a generation is in flight. What must
// not happen then is the read continuing and the promise resolving into a
// teardown that has already run: the menu section it would update is disposed by
// then, and touching it logs a stack of Gjs-CRITICALs.

test('generate rejects when handed an already-cancelled cancellable', async () => {
    const cancellable = new Gio.Cancellable();
    cancellable.cancel();

    await assertThrows(
        () => generate({ length: 14, classes: ALL_CLASSES, cancellable }),
        'a password was produced despite a cancelled cancellable');
});

test('cancelling mid-generation stops it with Gio CANCELLED', async () => {
    const cancellable = new Gio.Cancellable();
    // A long password needs many draws, so the read is certainly still in flight
    // when cancel() runs on this same tick.
    const promise = generate({ length: 128, classes: ALL_CLASSES, cancellable });
    cancellable.cancel();

    let error = null;
    try {
        await promise;
    } catch (caught) {
        error = caught;
    }
    assert(error !== null, 'generation resolved after being cancelled');
    // The cancellation has to come from Gio rather than a JavaScript-side check:
    // only then is the outstanding read on /dev/urandom actually torn down.
    assert(error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED),
        `expected Gio.IOErrorEnum.CANCELLED, got ${error}`);
});

test('randomBytes rejects when its cancellable is cancelled', async () => {
    const cancellable = new Gio.Cancellable();
    cancellable.cancel();

    await assertThrows(() => randomBytes(32, cancellable),
        'bytes were produced despite a cancelled cancellable');
});

test('generateMany stops when cancelled part way through', async () => {
    const cancellable = new Gio.Cancellable();
    const promise = generateMany({
        length: 64, classes: ALL_CLASSES, count: 20, cancellable,
    });
    cancellable.cancel();

    await assertThrows(() => promise, 'generateMany finished after being cancelled');
});

test('a cancelled buffered source stops handing out bytes it still holds', async () => {
    // The buffer can satisfy several draws without another read, so cancellation
    // has to be noticed even when no read is pending.
    const cancellable = new Gio.Cancellable();
    const source = bufferedSource(randomBytes, cancellable);
    await source.bytes(1);
    cancellable.cancel();

    await assertThrows(() => source.bytes(1),
        'the source kept serving bytes after being cancelled');
});
