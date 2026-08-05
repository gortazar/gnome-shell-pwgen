// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// ci/selftest-hook.js is concatenated onto the installed copy of extension.js by
// ci/smoke-test.sh, so the two files share one module scope. That is easy to get
// wrong in a way no other check catches: the hook once relied on extension.js
// importing GLib, and dropping that import turned the whole shell matrix red with
// a ReferenceError while the unit tests, ESLint and the package lint all passed.
//
// So the coupling is pinned here: the hook must bind everything it uses, and its
// bindings must not collide with extension.js's (a duplicate declaration is a
// SyntaxError, which would break loading just as thoroughly).

import Gio from 'gi://Gio';

import { assert, test } from './harness.js';

// GJS 1.80 has no URL global, so derive the checkout path from the module URL.
const ROOT_DIR = import.meta.url.replace(/^file:\/\//, '').replace(/\/tests\/[^/]+$/, '');

function readText(path) {
    const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
    assert(ok, `could not read ${path}`);
    return new TextDecoder().decode(bytes);
}

// Local names introduced by `import X from`, `import * as X from` and
// `import {a, b as c} from`.
function importedNames(source) {
    const names = new Set();
    const re = /import\s+([^'"]+?)\s+from\s+['"][^'"]+['"]/g;
    let match;
    while ((match = re.exec(source)) !== null) {
        for (const clause of match[1].split(/\s*,\s*(?![^{]*\})/)) {
            const braced = clause.match(/^\{(.*)\}$/s);
            if (braced) {
                for (const specifier of braced[1].split(','))
                    addBinding(names, specifier);
            } else {
                addBinding(names, clause);
            }
        }
    }
    return names;
}

function addBinding(names, specifier) {
    const text = specifier.trim().replace(/^\*\s+/, '');
    if (!text)
        return;
    const aliased = text.match(/\bas\s+([A-Za-z_$][\w$]*)$/);
    names.add(aliased ? aliased[1] : text);
}

test('the CI self-test hook binds every namespace it uses', async () => {
    const hook = readText(`${ROOT_DIR}/ci/selftest-hook.js`);
    const bound = importedNames(hook);

    // Namespaces that exist only as a binding some import created. Anything the
    // hook reaches for as `Name.member` has to be one of its own.
    for (const namespace of ['GLib', 'Gio', 'GObject', 'St', 'Clutter', 'Main']) {
        if (!new RegExp(`(^|[^\\w$.])${namespace}\\s*\\.`, 'm').test(hook))
            continue;
        assert(bound.has(namespace) ||
            new RegExp(`(const|let|var)\\s+${namespace}\\b`).test(hook),
            `ci/selftest-hook.js uses ${namespace}. but does not bind ${namespace} ` +
            'itself — it would only work while extension.js happens to import it');
    }
});

test('the CI self-test hook does not redeclare extension.js bindings', async () => {
    const hook = importedNames(readText(`${ROOT_DIR}/ci/selftest-hook.js`));
    const extension = importedNames(readText(`${ROOT_DIR}/extension.js`));

    for (const name of hook) {
        assert(!extension.has(name),
            `ci/selftest-hook.js imports ${name}, which extension.js also ` +
            'imports: appending it would be a duplicate declaration');
    }
});
