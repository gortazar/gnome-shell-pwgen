// SPDX-FileCopyrightText: 2026 Patxi Gortázar <patxi.gortazar@gmail.com>
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Entry point for the headless unit tests: `gjs -m tests/run.js`.

import './generator-test.js';
import './purity-test.js';
import './ci-hook-test.js';
import './ci-scripts-test.js';

import { run } from './harness.js';

run();
