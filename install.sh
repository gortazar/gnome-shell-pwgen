#!/bin/sh
# Install the Password Generator GNOME Shell extension from its latest release.
#
#     curl -fsSL https://raw.githubusercontent.com/gortazar/gnome-shell-pwgen/main/install.sh | sh
#
# Downloads the packed extension from GitHub, verifies it against the checksum published
# beside it, and unpacks it into your extensions directory. Nothing is built, nothing needs
# root, and nothing outside ~/.local/share/gnome-shell/extensions is touched.
#
# To install from a checkout instead — symlinked, so edits are picked up — use
# scripts/install-local.sh.
#
# Options, as environment variables:
#   VERSION=v0.2   install a particular release instead of the latest
#   PREFIX=...     install somewhere other than $XDG_DATA_HOME/gnome-shell/extensions
set -eu

REPO="${REPO:-gortazar/gnome-shell-pwgen}"
UUID="pwgen-generator@pwgen-gs.patxi"
ASSET="$UUID.shell-extension.zip"
VERSION="${VERSION:-latest}"
PREFIX="${PREFIX:-${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions}"

say() { echo "pwgen: $*"; }
die() { echo "pwgen: $*" >&2; exit 1; }

for tool in curl unzip; do
    command -v "$tool" >/dev/null 2>&1 \
        || die "$tool is needed and was not found on PATH"
done

if [ "$VERSION" = "latest" ]; then
    base="https://github.com/$REPO/releases/latest/download"
else
    base="https://github.com/$REPO/releases/download/$VERSION"
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT INT TERM

say "downloading $ASSET ($VERSION)"
curl -fsSL "$base/$ASSET" -o "$tmp/$ASSET" \
    || die "could not download $base/$ASSET"

# The checksum is published by the same workflow that built the zip, so a release without
# one is a release that did not come from that workflow. Its everyday job is catching a
# truncated download, which otherwise shows up much later as an extension that will not
# load.
curl -fsSL "$base/$ASSET.sha256" -o "$tmp/$ASSET.sha256" \
    || die "no checksum published beside $ASSET in $VERSION — refusing to install unverified code"

if command -v sha256sum >/dev/null 2>&1; then
    ( cd "$tmp" && sha256sum -c "$ASSET.sha256" >/dev/null ) \
        || die "the download does not match its published checksum"
    say "checksum ok"
elif command -v shasum >/dev/null 2>&1; then
    ( cd "$tmp" && shasum -a 256 -c "$ASSET.sha256" >/dev/null ) \
        || die "the download does not match its published checksum"
    say "checksum ok"
else
    die "neither sha256sum nor shasum is on PATH, so the download cannot be verified"
fi

# Unpacked beside the download first, and only then swapped into place. Removing the
# installed extension before knowing the replacement is sound would uninstall a working
# extension for anyone whose download fails.
staged="$tmp/staged"
mkdir -p "$staged"
unzip -q -o "$tmp/$ASSET" -d "$staged" || die "could not unpack $ASSET"
[ -f "$staged/metadata.json" ] || die "$ASSET does not look like a packed extension"

dest="$PREFIX/$UUID"
mkdir -p "$PREFIX"
rm -rf "$dest"
mv "$staged" "$dest"

# The zip ships the compiled schema, but a schema compiled by a newer glib than yours is
# worth recompiling if the tool is here.
#
# Only when the schema source travelled with it. Pointed at a directory holding no
# .gschema.xml, glib-compile-schemas does not leave the existing gschemas.compiled alone —
# it *removes* it ("No schema files found: removed existing output file"), which would
# uninstall the settings of an asset that shipped only the compiled form.
if command -v glib-compile-schemas >/dev/null 2>&1 \
    && [ -n "$(find "$dest/schemas" -maxdepth 1 -name '*.gschema.xml' -print -quit 2>/dev/null)" ]; then
    glib-compile-schemas "$dest/schemas" 2>/dev/null || true
fi

say "installed to $dest"

if command -v gnome-extensions >/dev/null 2>&1; then
    # Enabling only works once the shell has noticed the new directory, which on Wayland
    # means after a re-login. Try anyway: on X11, and on a second install, it works now.
    if gnome-extensions enable "$UUID" 2>/dev/null; then
        say "enabled"
    else
        say "log out and back in, then run: gnome-extensions enable $UUID"
    fi
else
    say "log out and back in, then enable it in the Extensions app"
fi
