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
| Destroy all objects in `disable()` | Pass | `disable()` at `extension.js:193` destroys the indicator (`:194`) and drops the reference (`:195`). |
| Disconnect all signals in `disable()` | Pass | Four connections (`:37`, `:60`, `:78`, `:174`); the ::destroy one and the menu items are all owned by the indicator and go with it. |
| Remove main loop sources in `disable()` | Pass | The extension creates none: zero `timeout_add` / `idle_add` / `setTimeout` in shipped code. |
| Cancel asynchronous work in `disable()` | Pass | Generation reads entropy asynchronously, so `disable()` can land mid-generation. The indicator holds a `Gio.Cancellable` (`:36`) cancelled from its ::destroy handler (`:37`), which aborts the read on `/dev/urandom`; the continuation checks it before touching the menu (`:117`) or reporting an error (`:131`). Covered by the disable-mid-generation scenario in `ci/selftest-hook.js`, which fails the smoke test if the shell logs "has been already disposed". |

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
| No excessive logging | Pass | Two calls, both failure paths: `:106`, `:120`. Nothing logged on success. |
| No forced `run_dispose()` | Pass | Not used. |
| No telemetry | Pass | No network access of any kind. |
| Must be functional | Pass | Verified on six shell versions in CI. |

### Scripts and binaries

| Rule | Status | Evidence |
| --- | --- | --- |
| No bundled binaries or libraries | Pass | Package is six files: metadata.json, extension.js, prefs.js, lib/generator.js, the schema XML, LICENSE. |
| Processes spawn carefully and exit cleanly | N/A | No process is spawned. Passwords are generated in-process by `lib/generator.js`. |
| Privileged subprocess must not be user-writable | N/A | No subprocess at all. No pkexec, no sudo. |
| External binaries strongly discouraged | Pass | No external binary is used; see "Generating in GJS rather than shelling out to pwgen" below. |

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
| Follow the HIG | Mostly — standard panel menu and `Adw` preferences. One inline style hardcodes a grey (`extension.js:134`) rather than following the theme. |

## Generating in GJS rather than shelling out to pwgen

The extension used to run `pwgen -s`. It no longer does, and the reasoning is
worth stating because the subprocess is the first thing a reviewer looks for:

- The guidelines accept an external binary only when there is no alternative.
  There is one here, and `pwgen(1)` is not part of any GNOME dependency chain, so
  on a system without it the extension could do nothing but tell the user to
  install a package.
- Generating passwords safely needs a cryptographically secure random source and
  unbiased selection over the character set. `lib/generator.js` reads
  `/dev/urandom` through the **async** Gio API, so no read blocks the
  compositor's main loop, and picks characters by rejection sampling — a plain
  `byte % charset.length` would make the first `256 % charset.length` characters
  more likely than the rest.
- `crypto.getRandomValues` is used instead when the GJS behind the running shell
  exposes it. GJS 1.80 (GNOME 46) does not, so `/dev/urandom` is the path that
  actually runs today. There is no third fallback: if entropy cannot be read the
  generator throws and the user is notified, never a weaker password.
- `GLib.Rand` and `Math.random()` are not cryptographically secure and are not
  used. A unit test greps the module to keep it that way.
- Every enabled character class is guaranteed to appear, and the guaranteed
  characters are placed by a Fisher-Yates shuffle over CSPRNG bytes rather than
  sitting in a fixed prefix.
- The module imports only `Gio`, which is what makes the generator testable:
  `tests/run.js` runs it under plain `gjs` with no display and no shell, with an
  injectable byte source for the deterministic cases. A test asserts the module
  never grows a shell-only import.

## Reproducing these checks

```sh
npm ci && npx eslint .   # ESLint over the extension sources
gjs -m tests/run.js      # generator unit tests, no display or shell needed
./ci/lint-package.sh     # builds the upload package and runs shexli over it
./ci/smoke-test.sh       # loads the extension into a throwaway headless shell
```

CI runs both on every push, across Fedora containers carrying GNOME Shell 46
through 50 plus the development release. See [README](README.md#testing-against-other-gnome-shell-versions).
