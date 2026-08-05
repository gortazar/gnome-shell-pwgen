#!/bin/bash
# Builds the package that would be uploaded to extensions.gnome.org and runs
# shexli over it -- the static analysis EGO asks you to run before uploading.
#
# Lints the *package*, not the checkout: pointed at the repository root, shexli
# reports the .git directory as bundled binaries and ci/ as unreachable
# JavaScript, none of which is ever uploaded.
#
# Uses shexli from PATH if present, otherwise installs it into a throwaway venv.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
STAGE="$WORK/package"
ZIP="$WORK/extension.zip"
trap 'rm -rf "$WORK"' EXIT

say() { printf '\n=== %s\n' "$*"; }

if ! command -v shexli >/dev/null 2>&1; then
    say "Installing shexli into a temporary venv"
    python3 -m venv "$WORK/venv"
    # shellcheck disable=SC1091
    . "$WORK/venv/bin/activate"
    pip install -q -U pip
    pip install -q -U shexli
fi
say "shexli: $(command -v shexli)"

# The same file set `gnome-extensions pack` ships. Anything not listed here is
# not uploaded, so it must not be linted either.
say "Assembling package"
mkdir -p "$STAGE/schemas" "$STAGE/lib"
cp "$SRC/metadata.json" "$SRC/extension.js" "$SRC/prefs.js" "$SRC/LICENSE" "$STAGE/"
cp "$SRC"/schemas/*.gschema.xml "$STAGE/schemas/"
cp "$SRC"/lib/*.js "$STAGE/lib/"
[ -f "$SRC/stylesheet.css" ] && cp "$SRC/stylesheet.css" "$STAGE/"
[ -d "$SRC/locale" ] && cp -r "$SRC/locale" "$STAGE/"
(cd "$STAGE" && zip -qr "$ZIP" .)
unzip -l "$ZIP" | tail -n +2

say "Running shexli"
# shexli exits 0 even when it reports errors, so the exit code cannot be the
# gate. Read the severity counts out of the JSON instead.
shexli --format json "$ZIP" > "$WORK/report.json"
shexli "$ZIP" || true

python3 - "$WORK/report.json" <<'PY'
import json, sys

with open(sys.argv[1]) as fh:
    counts = json.load(fh)['summary'].get('severity_counts', {})

blocking = counts.get('error', 0) + counts.get('warning', 0)
review = counts.get('manual_review', 0)

print()
print(f"errors={counts.get('error', 0)} warnings={counts.get('warning', 0)} "
      f"manual_review={review}")

# manual_review is not a defect: it flags things a human reviewer will look at,
# and this extension touches the clipboard by design. Only errors and warnings
# should stop a release.
if blocking:
    print('FAIL: shexli reported errors or warnings')
    sys.exit(1)
if review:
    print('note: manual_review findings are expected here (clipboard access)')
print('PASS')
PY
