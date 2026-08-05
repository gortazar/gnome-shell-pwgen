#!/bin/bash
# Loads the extension into a throwaway headless GNOME Shell, triggers a password
# generation, and fails if anything errors. In CI it is the only way to find out
# whether the extension still works on a given GNOME Shell version; on a developer
# machine it is how a CI failure gets reproduced.
#
# Everything happens in a throwaway session: its own HOME, its own runtime dir,
# its own session bus and a virtual monitor. Your own session is untouched.
#
# Requires: gnome-shell, glib2 tools, dbus-daemon. Must not run as root
# (mutter refuses). Set KEEP_LOG=1 to keep the shell log on success.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UUID="pwgen-generator@pwgen-gs.patxi"

# The script installs an extension and rewrites GNOME Shell's enabled-extensions
# list, so it must never see a real home directory. Run against one it would
# install into ~/.local/share/gnome-shell/extensions -- over the symlinks
# install.sh leaves there, so `cp` writes straight into the working copy they
# point at -- and reduce the live session's extension list to this one extension
# alone, through a dconf database that is per-user and not per-bus.
WORK="$(mktemp -d -t pwgen-smoke-XXXXXX)"
export HOME="$WORK/home"
export XDG_RUNTIME_DIR="$WORK/run"
mkdir -p "$HOME" "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"

EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
LOG="$WORK/shell.log"

# Keep gdbus / gnome-extensions output parseable regardless of container locale.
export LC_ALL=C
export UUID LOG

say() { printf '\n=== %s\n' "$*"; }

cleanup() {
    local status=$?
    if [ -n "${KEEP_LOG:-}" ] && [ -f "$LOG" ]; then
        # $WORK is about to go; put the log somewhere that outlives it.
        local kept
        kept="$(mktemp -t pwgen-shell-XXXXXX.log)"
        cp "$LOG" "$kept"
        echo "shell log kept at $kept"
    fi
    rm -rf "$WORK"
    return $status
}
trap cleanup EXIT

if [ "$(id -u)" = 0 ]; then
    echo "refusing to run as root: mutter will not start" >&2
    exit 1
fi

# Both of these make the shell abort during startup with a stack trace that says
# nothing about the real cause, so check them up front. Neither is fixable from
# here: they need root.
#
# The seats directory only matters because it makes the shell choose its systemd
# login manager; that choice is fine when logind actually answers, which is the
# normal case on a developer's machine and never the case in a CI container. So
# ask logind rather than assume, otherwise this refuses to run in exactly the
# place a CI failure has to be reproduced.
if [ -e /run/systemd/seats ] && ! gdbus introspect --system \
        --dest org.freedesktop.login1 --object-path /org/freedesktop/login1 \
        >/dev/null 2>&1; then
    echo "/run/systemd/seats exists and logind does not answer on the system bus:" >&2
    echo "the shell will pick its systemd login manager and abort. Remove the" >&2
    echo "directory (as root) or start logind." >&2
    exit 1
fi
if [ ! -e /run/dbus/system_bus_socket ] && [ ! -e /var/run/dbus/system_bus_socket ]; then
    echo "no system D-Bus: the shell reads keyboard settings from it during" >&2
    echo "startup and aborts. Start one with 'dbus-daemon --system --fork'." >&2
    exit 1
fi

say "GNOME Shell version"
gnome-shell --version

say "Installing extension into $EXT_DIR"
mkdir -p "$EXT_DIR/schemas" "$EXT_DIR/lib"
cp "$SRC/extension.js" "$SRC/prefs.js" "$SRC/metadata.json" "$EXT_DIR/"
cp "$SRC"/schemas/*.gschema.xml "$EXT_DIR/schemas/"
cp "$SRC"/lib/*.js "$EXT_DIR/lib/"
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

# The log lives in $WORK; the EXIT trap copies it out when KEEP_LOG is set and
# removes the whole throwaway tree either way.
say "PASS"
