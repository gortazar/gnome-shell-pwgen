#!/bin/bash
# Install and setup the pwgen-generator GNOME Shell Extension

UUID="pwgen-generator@pwgen-gs.patxi"
TARGET_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"

echo "1. Compiling schemas..."
./compile-schemas.sh

echo "2. Creating extension directory at $TARGET_DIR..."
mkdir -p "$TARGET_DIR"

echo "3. Linking files..."
ln -sf "$(pwd)/extension.js" "$TARGET_DIR/extension.js"
ln -sf "$(pwd)/prefs.js" "$TARGET_DIR/prefs.js"
ln -sf "$(pwd)/metadata.json" "$TARGET_DIR/metadata.json"
mkdir -p "$TARGET_DIR/schemas"
ln -sf "$(pwd)/schemas/org.gnome.shell.extensions.pwgen-generator.gschema.xml" "$TARGET_DIR/schemas/org.gnome.shell.extensions.pwgen-generator.gschema.xml"
ln -sf "$(pwd)/schemas/gschemas.compiled" "$TARGET_DIR/schemas/gschemas.compiled"

echo "--------------------------------------------------------"
echo "Extension installed successfully!"
echo "--------------------------------------------------------"
echo "Since you are on Wayland, you must log out and log back in to reload GNOME Shell."
echo "Once logged back in, enable the extension by running:"
echo "  gnome-extensions enable $UUID"
echo "Or using the Extensions app / Extension Manager."
