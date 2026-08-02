// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Lint configuration. Not shipped in the extension package.

import js from '@eslint/js';

// GJS provides these; they are not Node or browser globals.
const gjsGlobals = {
    console: 'readonly',
    log: 'readonly',
    logError: 'readonly',
    print: 'readonly',
    printerr: 'readonly',
    setTimeout: 'readonly',
    clearTimeout: 'readonly',
    setInterval: 'readonly',
    clearInterval: 'readonly',
    TextDecoder: 'readonly',
    TextEncoder: 'readonly',
};

export default [
    {
        ignores: ['node_modules/**'],
    },
    {
        files: ['extension.js', 'prefs.js'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: gjsGlobals,
        },
    },
    {
        // Not a standalone module: this fragment is appended to a copy of
        // extension.js by ci/smoke-test.sh, so it inherits that file's imports.
        files: ['ci/selftest-hook.js'],
        ...js.configs.recommended,
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...gjsGlobals,
                GLib: 'readonly',
                Main: 'readonly',
                St: 'readonly',
            },
        },
    },
];
