#!/bin/bash
# Loads the extension into a throwaway headless GNOME Shell, triggers a password
# generation, and fails if anything errors. Intended for CI containers, where it
# is the only way to find out whether the extension still works on a given GNOME
# Shell version.
#
# Requires: gnome-shell, glib2 tools, dbus-daemon, pwgen. Must not run as root
# (mutter refuses). Set KEEP_LOG=1 to keep the shell log on success.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="pwgen-generator@pwgen-gs.patxi"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
LOG="$(mktemp -t pwgen-shell-XXXXXX.log)"

# Keep gdbus / gnome-extensions output parseable regardless of container locale.
export LC_ALL=C
export UUID LOG
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-$(mktemp -d)}"
chmod 700 "$XDG_RUNTIME_DIR"

say() { printf '\n=== %s\n' "$*"; }

if [ "$(id -u)" = 0 ]; then
    echo "refusing to run as root: mutter will not start" >&2
    exit 1
fi

say "GNOME Shell version"
gnome-shell --version

say "Installing extension into $EXT_DIR"
mkdir -p "$EXT_DIR/schemas"
cp "$SRC/extension.js" "$SRC/prefs.js" "$SRC/metadata.json" "$EXT_DIR/"
cp "$SRC"/schemas/*.gschema.xml "$EXT_DIR/schemas/"
glib-compile-schemas "$EXT_DIR/schemas"

# Append the activation hook to the installed copy only; $SRC is left alone.
cat "$SRC/ci/selftest-hook.js" >> "$EXT_DIR/extension.js"
export PWGEN_SELFTEST=1

say "Running headless shell"
# The session bus must outlive the shell, so both live inside dbus-run-session.
status=0
dbus-run-session -- "$SRC/ci/run-in-session.sh" || status=$?

say "Shell log"
cat "$LOG"

if [ "$status" -ne 0 ]; then
    echo >&2
    echo "FAIL: in-session checks failed (exit $status)" >&2
    exit "$status"
fi

# The extension reports its own failures to the journal rather than to our exit
# code, so the log has to be checked too.
if grep -qi "Password Generator Error" "$LOG"; then
    echo "FAIL: extension logged an error" >&2
    exit 1
fi
if grep -qi "clipboard read-back mismatch" "$LOG"; then
    echo "FAIL: password did not reach the clipboard" >&2
    exit 1
fi

[ -n "${KEEP_LOG:-}" ] || rm -f "$LOG"
say "PASS"
