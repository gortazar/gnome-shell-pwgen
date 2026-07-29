#!/bin/bash
# Runs inside dbus-run-session, started by smoke-test.sh. Boots a headless shell
# on the session bus, then checks the extension from the outside via D-Bus.
# Expects $UUID and $LOG in the environment.
set -euo pipefail

: "${UUID:?}" "${LOG:?}"

SHELL_BUS=(--session --dest org.gnome.Shell --object-path /org/gnome/Shell)

shell_up() { gdbus introspect "${SHELL_BUS[@]}" >/dev/null 2>&1; }
shell_eval() {
    gdbus call "${SHELL_BUS[@]}" --method org.gnome.Shell.Eval "$1"
}

# metadata.json only lists versions we have already verified. Without this a
# newer shell reports OUT_OF_DATE and never runs the code -- which is precisely
# the thing this test exists to find out.
gsettings set org.gnome.shell disable-extension-version-validation true
gsettings set org.gnome.shell enabled-extensions "['$UUID']"

# --no-x11: containers have no writable /tmp/.X11-unix, and Xwayland failing to
# start is fatal to the whole shell. Nothing here needs X.
gnome-shell --headless --no-x11 --virtual-monitor 1280x720 >"$LOG" 2>&1 &
SHELL_PID=$!

# A plain "kill; wait" deadlocks whenever the shell does not honour SIGTERM,
# which is exactly what happens on some versions when startup goes wrong: the
# job then hangs instead of reporting the failure. Escalate on a deadline.
cleanup() {
    kill "$SHELL_PID" 2>/dev/null || return 0
    for _ in $(seq 1 10); do
        kill -0 "$SHELL_PID" 2>/dev/null || return 0
        sleep 1
    done
    kill -9 "$SHELL_PID" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 60); do
    shell_up && break
    kill -0 $SHELL_PID 2>/dev/null || { echo "shell exited during startup" >&2; exit 1; }
    sleep 1
done
shell_up || { echo "shell never took its bus name" >&2; exit 1; }

# 1. Did the extension load and enable? state 1 == ENABLED.
info=$(gdbus call "${SHELL_BUS[@]}" \
    --method org.gnome.Shell.Extensions.GetExtensionInfo "$UUID")
echo "extension info: $info"
state=$(sed -n "s/.*'state': <\([0-9.]*\)>.*/\1/p" <<<"$info")
case "$state" in
    1|1.0) echo "extension state: ENABLED" ;;
    *)     echo "extension is not enabled (state=${state:-unknown})" >&2; exit 1 ;;
esac

# 2. Does generating actually work? A load-only test would not have caught the
# communicate_utf8_async bug, which fired only on activation. The hook appended
# by smoke-test.sh runs the real code path and reports through the log.
for _ in $(seq 1 40); do
    grep -q "PWGEN_SELFTEST result=" "$LOG" && break
    kill -0 $SHELL_PID 2>/dev/null || { echo "shell died before self-test" >&2; exit 1; }
    sleep 1
done

result=$(sed -n 's/.*PWGEN_SELFTEST \(result=.*\)/\1/p' "$LOG" | head -1)
echo "self-test: ${result:-<none>}"
case "$result" in
    "result=ok passwords="[1-9]*) ;;
    "")  echo "self-test never reported: generation hung or the hook never ran" >&2; exit 1 ;;
    *)   echo "self-test failed" >&2; exit 1 ;;
esac
