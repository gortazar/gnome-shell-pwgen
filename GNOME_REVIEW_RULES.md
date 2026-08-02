# extensions.gnome.org review conformance

A self-audit of this extension against the
[GNOME Shell Extensions Review Guidelines](https://gjs.guide/extensions/review-guidelines/review-guidelines.html),
kept in the repository so a reviewer can see what was checked and how.

Line references are to the reviewed files. Everything marked verified was checked
against a running GNOME Shell, not by reading the code.

## Use of AI

This extension was written with AI assistance (Claude), used as a coding tool.

I have reviewed every line of the submitted code, I understand what it does, and
I am able to explain and maintain it. I audited it against the review guidelines
rule by rule — that audit is the checklist below — and acted on what it found:
the license was changed, a global prototype patch was removed, and a missing
GNOME Shell version was added.

The guidelines reject submissions containing unnecessary code, inconsistent
style, imaginary APIs, or leftover LLM-prompt comments. Against those specific
criteria:

- **Imaginary APIs.** Every call is exercised on real GNOME Shell builds in CI,
  across versions 46, 47, 48, 49, 50 and the 51 development release. A
  hallucinated API cannot survive that — the extension would fail to enable.
- **Unnecessary code.** The package is five files. `shexli` reports no unused or
  unreachable JavaScript.
- **Style.** Consistent with the original hand-written code: same indentation,
  same comment conventions, same naming.
- **Prompt residue.** Comments explain *why* a decision was made, not what to
  generate. No prompts, no placeholders, no `TODO: implement`.

## Rules

### Lifecycle

| Rule | Status | Evidence |
| --- | --- | --- |
| Only use initialization for static resources | Pass | Module scope holds imports, one function declaration and `GObject.registerClass` only. No instances, no signals, no sources, no patching of shared state. |
| Destroy all objects in `disable()` | Pass | `disable()` at `extension.js:220` destroys the indicator (`:221`) and drops the reference (`:222`). |
| Disconnect all signals in `disable()` | Pass | The only three connections (`:67`, `:85`, `:201`) are on menu items owned by the indicator and go with it. |
| Remove main loop sources in `disable()` | Pass | The extension creates none: zero `timeout_add` / `idle_add` / `setTimeout` in shipped code. |

An earlier revision called `Gio._promisify()` at module scope. That patches a
prototype shared with the rest of the shell, at import time, and never restores
it — against "don't modify anything before `enable()`". It was replaced with a
local Promise wrapper (`extension.js:26`).

### Imports

| Rule | Status | Evidence |
| --- | --- | --- |
| No deprecated modules (ByteArray, Lang, Mainloop) | Pass | None imported. |
| No Gtk/Gdk/Adw in the shell process | Pass | `extension.js` imports Gio, GLib, GObject, St and shell modules only. |
| No Clutter/Meta/St/Shell in preferences | Pass | `prefs.js` imports Adw, Gio, Gtk only. |

### Code

| Rule | Status | Evidence |
| --- | --- | --- |
| Not obfuscated or minified | Pass | Plain, commented JavaScript. |
| No excessive logging | Pass | Two calls, both failure paths: `:146`, `:177`. Nothing logged on success. |
| No forced `run_dispose()` | Pass | Not used. |
| No telemetry | Pass | No network access of any kind. |
| Must be functional | Pass | Verified on six shell versions in CI. |

### Scripts and binaries

| Rule | Status | Evidence |
| --- | --- | --- |
| No bundled binaries or libraries | Pass | Package is five files: metadata.json, extension.js, prefs.js, the schema XML, LICENSE. |
| Processes spawn carefully and exit cleanly | Pass | `Gio.Subprocess` (`:120`) with `communicate_utf8_async`, which waits for exit. Failures are caught and reported. |
| Privileged subprocess must not be user-writable | N/A | No privileged subprocess. No pkexec, no sudo. The "sudo apt install pwgen" string at `:162` is notification text shown to the user, never executed. |
| External binaries strongly discouraged | See note | The extension is a pwgen frontend; see "Why pwgen" below. |

### Clipboard

| Rule | Status | Evidence |
| --- | --- | --- |
| Clipboard access declared in the description | Pass | `metadata.json` description: "copies them to the clipboard". |
| Not shared with third parties | Pass | The value never leaves the machine. |
| No default keyboard shortcuts | Pass | The extension registers no shortcuts. |

Generated passwords are deliberately **not displayed** in the menu. Items are
labelled `Password 1`, `Password 2` and so on, because the panel menu is visible
to bystanders, screen sharing and recording. The value is reachable only through
the clipboard.

### metadata.json

| Rule | Status | Evidence |
| --- | --- | --- |
| `uuid` well formed, not gnome.org | Pass | `pwgen-generator@pwgen-gs.patxi`. |
| `name` does not conflict | Pass | No extension of this name found on extensions.gnome.org. |
| `url` points at the repository | Pass | Resolves (HTTP 200). |
| `shell-version` — released versions only | Pass | `46, 47, 48, 49, 50`, each verified in CI. 51 is tested but not claimed, as it is still in development. |
| `session-modes`, `donations`, `version` omitted | Pass | Not used, so not present. |

### GSettings

| Rule | Status | Evidence |
| --- | --- | --- |
| Schema ID based on `org.gnome.shell.extensions` | Pass | `org.gnome.shell.extensions.pwgen-generator` |
| Schema path based on `/org/gnome/shell/extensions` | Pass | `/org/gnome/shell/extensions/pwgen-generator/` |
| Schema XML included in the package | Pass | Present; the compiled `gschemas.compiled` is deliberately excluded. |
| Filename matches `<schema-id>.gschema.xml` | Pass | `org.gnome.shell.extensions.pwgen-generator.gschema.xml` |

### Legal

| Rule | Status | Evidence |
| --- | --- | --- |
| GPL-compatible license | Pass | GPL-2.0-or-later, matching GNOME Shell. See below. |
| Code of Conduct, no political content | Pass | — |
| No copyrighted or trademarked material | Pass | No third-party assets; icons are stock symbolic names. |

The project was previously Apache-2.0, which is **not** GPLv2-compatible: its
patent-termination and indemnification clauses are further restrictions that
GPLv2 forbids. Since the extension imports GNOME Shell modules and subclasses
`PanelMenu.Button`, it forms a combined work with GPL-2+ code, so it was
relicensed to GPL-2.0-or-later. SPDX headers are on both source files and
`LICENSE` ships inside the package.

### Recommendations

| Recommendation | Status |
| --- | --- |
| No unnecessary files | Followed — `shexli` reports zero warnings on the package. |
| Use a linter | Followed — ESLint (flat config, `eslint.config.js`) and `shexli` both run in CI on every push. |
| Follow the HIG | Mostly — standard panel menu and `Adw` preferences. One inline style hardcodes a grey (`extension.js:191`) rather than following the theme. |

## Why pwgen rather than generating in GJS

The guidelines discourage external binaries, so to state the reasoning plainly:

- Generating passwords safely needs a cryptographically secure random source and
  unbiased selection over a character set. GJS exposes no CSPRNG; `GLib.Rand` is
  not cryptographically secure. Doing this correctly means reading `/dev/urandom`
  and implementing rejection sampling by hand — exactly the kind of code that
  fails quietly and produces weak passwords.
- `pwgen -s` is a long-established, widely packaged tool that already does this,
  and reusing it is more trustworthy than a bespoke implementation inside a
  panel applet.
- Being a frontend for pwgen is the stated purpose of the extension, not an
  implementation detail.
- Nothing is bundled. `pwgen` is a distribution package, and when it is missing
  the extension catches the spawn error and tells the user how to install it,
  rather than failing silently. That path is covered by a test.

## Reproducing these checks

```sh
npm ci && npx eslint .   # ESLint over the extension sources
./ci/lint-package.sh     # builds the upload package and runs shexli over it
./ci/smoke-test.sh       # loads the extension into a throwaway headless shell
```

CI runs both on every push, across Fedora containers carrying GNOME Shell 46
through 50 plus the development release. See [README](README.md#testing-against-other-gnome-shell-versions).
