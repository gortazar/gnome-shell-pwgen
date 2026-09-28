// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// The release workflow and install.sh are two halves of one contract, and the
// half that runs on a user's machine cannot be fixed after the fact: install.sh
// refuses an asset with no published checksum, so a release that forgets the
// .sha256 is a release nobody can install. Neither half is exercised by any other
// test — the workflow runs on a tag, once, in a repository no test can reach — so
// what is checkable statically is checked here.
//
// These are assertions about text, not a YAML parse: gjs has no YAML reader, and
// GitHub rejects a malformed workflow on its own. What it cannot catch is the two
// halves drifting apart, which is what this file is for.

import Gio from 'gi://Gio';

import { assert, test } from './harness.js';

// GJS 1.80 has no URL global, so derive the checkout path from the module URL.
const ROOT_DIR = import.meta.url.replace(/^file:\/\//, '').replace(/\/tests\/[^/]+$/, '');
const WORKFLOW = `${ROOT_DIR}/.github/workflows/release.yml`;

function readText(path) {
    const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
    assert(ok, `could not read ${path}`);
    return new TextDecoder().decode(bytes);
}

function metadata() {
    return JSON.parse(readText(`${ROOT_DIR}/metadata.json`));
}

test('metadata.json declares the version the release is named after', async () => {
    const version = metadata()['version-name'];
    assert(version, 'metadata.json has no "version-name"');
    // The release workflow compares this against the tag with the leading v
    // stripped, so anything else there can only ever fail the release.
    assert(/^\d+\.\d+$/.test(version),
        `"version-name" should look like 0.2, got ${JSON.stringify(version)}`);
});

test('the release workflow can be started without pushing a tag', async () => {
    const source = readText(WORKFLOW);
    // An agent building this repository can push a branch but not a tag, so a
    // workflow that only answers to `on: push: tags` cannot be used by one.
    assert(/workflow_dispatch:/.test(source),
        'release.yml has no workflow_dispatch trigger');
    assert(/tags:\s*\["v\*"\]|tags:\s*\n\s*-\s*['"]?v\*/.test(source),
        'release.yml does not trigger on v* tags');
    // On a dispatch run the tag does not exist, so the release has to create it at
    // a commit rather than assume one.
    assert(/--target/.test(source),
        'release.yml does not target a commit, so a dispatch run has no tag to release');
});

test('the release workflow runs the checks before publishing', async () => {
    const source = readText(WORKFLOW);
    const check = source.indexOf('nix flake check');
    const publish = source.indexOf('gh release create');
    assert(check !== -1, 'release.yml never runs nix flake check');
    assert(publish !== -1, 'release.yml never creates a release');
    assert(check < publish, 'release.yml publishes before running the checks');
});

test('the release publishes the checksum install.sh insists on', async () => {
    const workflow = readText(WORKFLOW);
    const installer = readText(`${ROOT_DIR}/install.sh`);

    // install.sh exits rather than install an asset with no checksum beside it, so
    // this is not a nicety: a release without the .sha256 cannot be installed by
    // the command the release notes print.
    assert(/sha256/.test(installer),
        'install.sh no longer verifies a checksum — this test and release.yml need revisiting');
    assert(/sha256sum "\$zip" > "\$zip\.sha256"/.test(workflow),
        'release.yml does not publish a .sha256 beside the zip');
});

test('the release refuses a tag that disagrees with metadata.json', async () => {
    const source = readText(WORKFLOW);
    assert(/version-name/.test(source),
        'release.yml does not read version-name from metadata.json');
    assert(/refusing to publish/.test(source),
        'release.yml does not fail when the tag and metadata.json disagree');
});

test('the release notes install the extension the way the README does', async () => {
    const workflow = readText(WORKFLOW);
    const readme = readText(`${ROOT_DIR}/README.md`);
    const command = /curl -fsSL \S+install\.sh \| sh/;

    const inNotes = workflow.match(command);
    const inReadme = readme.match(command);
    assert(inNotes, 'the release notes do not open with the install command');
    assert(inReadme, 'README.md does not carry the install command');
    assert(inNotes[0] === inReadme[0],
        `the release notes and README disagree: ${inNotes[0]} vs ${inReadme[0]}`);
});
