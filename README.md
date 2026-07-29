# Password Generator

A GNOME Shell extension that generates secure passwords with [`pwgen`](https://linux.die.net/man/1/pwgen)
and copies them to the clipboard.

A panel icon opens a menu with a **Generate & Copy** action. Generated passwords are
copied to the clipboard and also listed in the menu, where each one can be clicked to
copy it again.

## Requirements

- GNOME Shell 46
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
