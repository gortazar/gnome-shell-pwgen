# Password Generator

A GNOME Shell extension that generates secure passwords with [`pwgen`](https://linux.die.net/man/1/pwgen)
and copies them to the clipboard.

A panel icon opens a menu with a **Generate & Copy** action. Generated passwords are
copied to the clipboard and also listed in the menu, where each one can be clicked to
copy it again.

## Requirements

- GNOME Shell 46, 47, 48 or 49 (each verified by `ci/smoke-test.sh`)
- `pwgen` (`sudo apt install pwgen`)

## Installation

```sh
./install.sh
gnome-extensions enable pwgen-generator@pwgen-gs.patxi
```

`install.sh` compiles the GSettings schema and symlinks this checkout into
`~/.local/share/gnome-shell/extensions/`, so edits to the working tree are picked up
by the installed extension without reinstalling — subject to the reload caveat below.

## Reloading after a code change

**GNOME Shell must be restarted for any change to `extension.js` or `prefs.js` to take
effect. `gnome-extensions disable` followed by `enable` is not enough.**

GNOME Shell caches an extension's ES module for the lifetime of the shell process.
Disabling and re-enabling calls `disable()` / `enable()` on the module that is already
in memory; it never re-reads the file from disk. The shell will keep running the old
code, silently, with no error — including stack traces pointing at line numbers that no
longer exist in the file you just edited.

How to actually reload:

- **Wayland:** log out and log back in. There is no way to restart the shell in place.
- **X11:** <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`, press <kbd>Enter</kbd>.

To check whether a change is live, add a `console.log()` at module scope (outside any
class) and watch for it:

```sh
journalctl --user -f | grep -i "Password Generator"
```

If the message does not appear after a reload attempt, the old module is still loaded.

## Testing against other GNOME Shell versions

`metadata.json` declares only the versions that have been verified, so a newer
shell refuses to load the extension outright. To find out whether the code actually
still works on a newer version, the extension has to be loaded by that version.

`ci/smoke-test.sh` does that in a throwaway headless shell, without touching your
session:

```sh
./ci/smoke-test.sh
```

It installs the extension into a scratch prefix, starts `gnome-shell --headless`
on a private D-Bus session, disables extension version validation (otherwise a
newer shell reports `OUT_OF_DATE` and never runs the code), and then checks that:

1. the extension reaches the `ENABLED` state, queried over D-Bus;
2. generating a password actually works; and
3. the shell log contains no `Password Generator Error` or
   `clipboard read-back mismatch`.

Check 2 is the one that matters. A load-only test would not have caught the
`communicate_utf8_async` bug, because that only fired when the menu item was
activated. There is no way to click a menu item from outside the shell —
`org.gnome.Shell.Eval` is locked behind unsafe mode, which has no D-Bus property
and no command-line flag — so `ci/selftest-hook.js` is appended to the *installed
copy* of `extension.js` and calls `_generatePassword()` from inside the shell,
printing the result for the harness to grep. The repository file is never
modified.

Requirements, all of which the shell fails hard without:

- **Not root** — mutter refuses to start.
- **A system D-Bus** (`dbus-daemon --system`) — the shell reads keyboard settings
  from it at startup, and aborts if it cannot connect, even though nothing needs
  to answer.
- **No `/run/systemd/seats`** — if present, the shell selects its systemd login
  manager and aborts when logind is unreachable. In containers, mount a tmpfs
  over `/run`.
- `--no-x11` is passed to the shell, because Xwayland cannot start without a
  writable `/tmp/.X11-unix` and its failure kills the whole shell.

### CI

`.github/workflows/ci.yml` runs that smoke test across a matrix of Fedora
containers, since Fedora ships exactly one GNOME per release:

| image | GNOME Shell |
| --- | --- |
| `fedora:40` | 46 |
| `fedora:41` | 47 |
| `fedora:42` | 48 |
| `fedora:43` | 49 |
| `fedora:rawhide` | next (non-gating) |

Every job prints the version it actually got, so the table never has to be trusted.
The workflow also runs on a weekly schedule, because new GNOME releases break
extensions without anyone touching the repository.

When a newer version passes, add it to `shell-version` in `metadata.json`.

## Publishing to extensions.gnome.org

EGO requires the package to pass [`shexli`](https://pypi.org/project/shexli/)
before upload. `ci/lint-package.sh` builds the package that would be uploaded and
runs it:

```sh
./ci/lint-package.sh
```

It installs shexli into a throwaway venv if it is not already on `PATH`, so no
setup is needed. Two things it deliberately does differently from running
`shexli .` by hand:

- It lints the **package**, not the checkout. Pointed at the repository root,
  shexli reports `.git` as bundled binaries and `ci/` as unreachable JavaScript —
  none of which is ever uploaded. The staged file set matches what
  `gnome-extensions pack` ships.
- It fails on errors and warnings by reading the JSON report, because **shexli
  exits 0 even when it reports errors**, so its exit status cannot be used as a
  gate.

`manual_review` findings do not fail the build. This extension gets one for
`St.Clipboard.get_default()`, which is unavoidable for a clipboard tool; the
guideline is that clipboard access be *declared*, which `metadata.json` does in
its description. Expect a human reviewer to look at it.

To build the upload artifact itself:

```sh
gnome-extensions pack --force .
```

## Preferences

Available from **Preferences...** in the menu, or `gnome-extensions prefs pwgen-generator@pwgen-gs.patxi`:

| Setting | Default | Description |
| --- | --- | --- |
| Password Length | 14 | Length of each generated password (4–128) |
| Use Numbers | on | Include digits (`pwgen -n`, otherwise `-0`) |
| Use Symbols | on | Include non-alphabetic symbols (`pwgen -y`) |
| Number of Passwords | 1 | How many passwords to generate (1–50) |

Passwords are always generated with `pwgen -s` (completely random, secure).

## Troubleshooting

Extension errors are logged to the journal:

```sh
journalctl --user -b | grep -i "Password Generator"
```

If a password is generated but does not reach the clipboard, look for a
`clipboard read-back mismatch` warning — the extension verifies the copy by reading the
clipboard back. The warning reports character counts only and never logs password
material.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
