// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// install.sh is the only installation path for someone who is not going to clone
// this repository, so the things that make it one are checked rather than trusted:
// it downloads a built artefact instead of building, it refuses an asset that does
// not match its published checksum, and it never destroys an existing install on
// the way to failing.
//
// The tests run the script for real, with a stub `curl` on PATH serving fixtures
// from a throwaway directory. Nothing here touches the network, and PREFIX points
// at a temporary tree, so the developer's own extensions directory is never
// written to — ci/smoke-test.sh has already, once, written through a real one.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { assert, test } from './harness.js';

// GJS 1.80 has no URL global, so derive the checkout path from the module URL.
const ROOT_DIR = import.meta.url.replace(/^file:\/\//, '').replace(/\/tests\/[^/]+$/, '');
const INSTALLER = `${ROOT_DIR}/install.sh`;
const UUID = 'pwgen-generator@pwgen-gs.patxi';
const ASSET = `${UUID}.shell-extension.zip`;

function readText(path) {
    const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
    assert(ok, `could not read ${path}`);
    return new TextDecoder().decode(bytes);
}

function writeText(path, text, mode) {
    const file = Gio.File.new_for_path(path);
    file.replace_contents(new TextEncoder().encode(text), null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    if (mode !== undefined)
        GLib.chmod(path, mode);
}

function exists(path) {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}

// Runs a command to completion and returns { status, stdout, stderr }. Synchronous
// on purpose: these are short-lived shell scripts, and the harness's main loop is
// only needed by the code under test that uses the async Gio API.
function run(argv, envOverrides = {}, cwd = null) {
    const launcher = new Gio.SubprocessLauncher({
        flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE,
    });
    if (cwd)
        launcher.set_cwd(cwd);
    for (const [key, value] of Object.entries(envOverrides)) {
        if (value === null)
            launcher.unsetenv(key);
        else
            launcher.setenv(key, value, true);
    }
    const proc = launcher.spawnv(argv);
    const [, stdout, stderr] = proc.communicate_utf8(null, null);
    return {
        status: proc.get_exit_status(),
        stdout: stdout ?? '',
        stderr: stderr ?? '',
    };
}

function mkdtemp() {
    const dir = GLib.dir_make_tmp('pwgen-installer-XXXXXX');
    assert(dir, 'could not create a temporary directory');
    return dir;
}

function rmrf(path) {
    run(['rm', '-rf', path]);
}

// A stub `curl` that answers from a fixture directory instead of the network. It
// understands only the shape install.sh uses: `curl ... <url> -o <path>`. A URL
// with no fixture behind it fails the way curl -f does on a 404, which is what a
// release missing that asset looks like.
function stubCurl(binDir, fixtureDir) {
    writeText(`${binDir}/curl`, `#!/bin/sh
# Test stub. Serves $fixtureDir by the basename of the requested URL.
url=""
out=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o) out="$2"; shift 2 ;;
        -*) shift ;;
        *) url="$1"; shift ;;
    esac
done
name="\${url##*/}"
if [ -f "${fixtureDir}/$name" ]; then
    if [ -n "$out" ]; then cp "${fixtureDir}/$name" "$out"; else cat "${fixtureDir}/$name"; fi
    exit 0
fi
echo "curl: (22) The requested URL returned error: 404" >&2
exit 22
`, 0o755);
}

const SCHEMA_XML = 'org.gnome.shell.extensions.pwgen-generator.gschema.xml';

// The payload a real release carries: the packed extension. Built here with `zip`
// so the test does not depend on a release existing.
function makeAsset(fixtureDir, workDir, { schemaXml = true } = {}) {
    const stage = `${workDir}/stage`;
    GLib.mkdir_with_parents(`${stage}/schemas`, 0o755);
    GLib.mkdir_with_parents(`${stage}/lib`, 0o755);
    writeText(`${stage}/metadata.json`, readText(`${ROOT_DIR}/metadata.json`));
    writeText(`${stage}/extension.js`, '// test fixture\n');
    writeText(`${stage}/prefs.js`, '// test fixture\n');
    writeText(`${stage}/lib/generator.js`, '// test fixture\n');
    writeText(`${stage}/schemas/gschemas.compiled`, 'not really compiled\n');
    // The packed zip carries both the schema source and the compiled form, which is
    // what makes recompiling on the way in safe.
    if (schemaXml)
        writeText(`${stage}/schemas/${SCHEMA_XML}`, readText(`${ROOT_DIR}/schemas/${SCHEMA_XML}`));

    const zipped = run(['zip', '-qr', `${fixtureDir}/${ASSET}`, '.'], {}, stage);
    assert(zipped.status === 0, `could not build the fixture zip: ${zipped.stderr}`);
}

function writeChecksum(fixtureDir, contents) {
    if (contents !== undefined) {
        writeText(`${fixtureDir}/${ASSET}.sha256`, contents);
        return;
    }
    const sum = run(['sha256sum', ASSET], {}, fixtureDir);
    assert(sum.status === 0, `sha256sum failed: ${sum.stderr}`);
    writeText(`${fixtureDir}/${ASSET}.sha256`, sum.stdout);
}

// One throwaway world per test: fixtures the stub curl serves, a bin/ holding that
// stub, and a PREFIX standing in for the extensions directory.
function world({ asset = true, checksum = undefined, badChecksum = false,
    schemaXml = true } = {}) {
    const root = mkdtemp();
    const fixtures = `${root}/fixtures`;
    const bin = `${root}/bin`;
    const prefix = `${root}/extensions`;
    GLib.mkdir_with_parents(fixtures, 0o755);
    GLib.mkdir_with_parents(bin, 0o755);
    GLib.mkdir_with_parents(prefix, 0o755);

    if (asset) {
        makeAsset(fixtures, root, { schemaXml });
        if (badChecksum)
            writeChecksum(fixtures, `${'0'.repeat(64)}  ${ASSET}\n`);
        else if (checksum !== false)
            writeChecksum(fixtures, checksum);
    }
    stubCurl(bin, fixtures);

    return {
        root, fixtures, bin, prefix,
        dest: `${prefix}/${UUID}`,
        install(extraEnv = {}) {
            return run(['sh', INSTALLER], {
                PATH: `${bin}:${GLib.getenv('PATH')}`,
                PREFIX: prefix,
                // The installer must never consult these, but if it did, a test
                // must not be what installs into a real home directory.
                HOME: `${root}/home`,
                XDG_DATA_HOME: `${root}/home/.local/share`,
                ...extraEnv,
            });
        },
        cleanup() {
            rmrf(root);
        },
    };
}

test('install.sh downloads a built artefact instead of building one', async () => {
    const source = readText(INSTALLER);
    // The old installer compiled schemas and symlinked the checkout. Either one
    // means the user needs this repository, which is what a release exists to
    // avoid.
    assert(!/compile-schemas\.sh/.test(source),
        'install.sh runs compile-schemas.sh: that is installing a checkout, not a release');
    assert(!/ln -s/.test(source),
        'install.sh symlinks a checkout; scripts/install-local.sh is where that belongs');
    assert(/releases/.test(source), 'install.sh does not fetch from the releases URL');
    assert(source.includes(UUID) && source.includes('.shell-extension.zip'),
        'install.sh does not name the packed extension asset');
    assert(/sha256/.test(source), 'install.sh does not look at a checksum');
    // A downloading installer that needs root is a downloading installer nobody
    // should pipe into a shell.
    assert(!/\bsudo\b/.test(source), 'install.sh uses sudo');
});

test('install.sh unpacks the release asset into PREFIX', async () => {
    const w = world();
    try {
        const result = w.install();
        assert(result.status === 0,
            `install.sh failed: ${result.stderr}${result.stdout}`);
        for (const entry of ['metadata.json', 'extension.js', 'prefs.js',
            'lib/generator.js', 'schemas/gschemas.compiled']) {
            assert(exists(`${w.dest}/${entry}`),
                `${entry} is missing from the install at ${w.dest}`);
        }
        // Nothing outside PREFIX: the throwaway HOME must stay untouched.
        assert(!exists(`${w.root}/home/.local/share/gnome-shell`),
            'install.sh wrote into HOME even though PREFIX was set');
    } finally {
        w.cleanup();
    }
});

test('recompiling the schema never removes the compiled one it was given', async () => {
    // glib-compile-schemas over a directory with no .gschema.xml deletes the
    // gschemas.compiled that is already there. The shell reads only the compiled
    // file, so an asset packed without the source would be installed broken —
    // silently, since the installer ignores the tool's exit status.
    const w = world({ schemaXml: false });
    try {
        const result = w.install();
        assert(result.status === 0, `install.sh failed: ${result.stderr}`);
        assert(exists(`${w.dest}/schemas/gschemas.compiled`),
            'the compiled schema was removed by the recompile step');
    } finally {
        w.cleanup();
    }
});

test('VERSION picks a particular release', async () => {
    const w = world();
    try {
        const result = w.install({ VERSION: 'v0.2' });
        assert(result.status === 0, `install.sh failed: ${result.stderr}`);
        assert(/v0\.2/.test(result.stdout + result.stderr),
            'install.sh never says which version it installed');
    } finally {
        w.cleanup();
    }
});

test('a checksum mismatch aborts the install', async () => {
    const w = world({ badChecksum: true });
    try {
        const result = w.install();
        assert(result.status !== 0,
            'install.sh accepted an asset that did not match its published checksum');
        assert(!exists(w.dest),
            'install.sh left an unverified asset unpacked in the extensions directory');
    } finally {
        w.cleanup();
    }
});

test('a release with no published checksum aborts the install', async () => {
    const w = world({ checksum: false });
    try {
        const result = w.install();
        assert(result.status !== 0,
            'install.sh installed an asset it could not verify at all');
        assert(!exists(w.dest), 'install.sh unpacked an unverifiable asset');
    } finally {
        w.cleanup();
    }
});

test('a missing asset aborts the install', async () => {
    const w = world({ asset: false });
    try {
        const result = w.install();
        assert(result.status !== 0, 'install.sh reported success with nothing downloaded');
        assert(/could not download|404/i.test(result.stderr + result.stdout),
            `install.sh does not say the download failed: ${result.stderr}`);
        assert(!exists(w.dest), 'install.sh created the destination for a failed download');
    } finally {
        w.cleanup();
    }
});

test('a failed install leaves the previous one in place', async () => {
    const w = world({ asset: false });
    try {
        // Someone who already has the extension installed runs the installer again
        // and the download fails. Removing what works before knowing the
        // replacement is good would uninstall their extension for them.
        GLib.mkdir_with_parents(w.dest, 0o755);
        writeText(`${w.dest}/metadata.json`, '{"uuid": "previous install"}');

        const result = w.install();
        assert(result.status !== 0, 'install.sh reported success with nothing downloaded');
        assert(exists(`${w.dest}/metadata.json`),
            'install.sh deleted the existing install before the download succeeded');
        assert(/previous install/.test(readText(`${w.dest}/metadata.json`)),
            'the existing install was replaced by a failed download');
    } finally {
        w.cleanup();
    }
});

test('a missing unzip is reported rather than half-installed', async () => {
    const w = world();
    try {
        // PATH holding only the stub curl: no unzip anywhere.
        const result = w.install({ PATH: w.bin });
        assert(result.status !== 0, 'install.sh carried on without unzip');
        assert(/unzip/.test(result.stderr + result.stdout),
            `install.sh does not name the missing tool: ${result.stderr}`);
        assert(!exists(w.dest), 'install.sh created the destination without unzip');
    } finally {
        w.cleanup();
    }
});
