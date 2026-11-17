#!/usr/bin/env bash
set -euo pipefail

UUID="dynamic-island@ubuntu26.gnome.org"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEST_DIR="${HOME}/.local/share/gnome-shell/extensions/${UUID}"

if ! command -v glib-compile-schemas >/dev/null 2>&1; then
  echo "Error: glib-compile-schemas not found. Install libglib2.0-bin." >&2
  exit 1
fi

echo "Compiling GSettings schemas..."
glib-compile-schemas "${EXT_ROOT}/schemas"

echo "Installing extension to ${DEST_DIR}..."
rm -rf "${DEST_DIR}"
mkdir -p "${DEST_DIR}"
cp -r "${EXT_ROOT}/metadata.json" "${EXT_ROOT}/extension.js" "${EXT_ROOT}/prefs.js" \
  "${EXT_ROOT}/stylesheet.css" "${EXT_ROOT}/src" "${EXT_ROOT}/schemas" "${DEST_DIR}/"

echo "Installation complete."
echo "If running Wayland for the first time with this UUID, log out and back in, then run:"
echo "  gnome-extensions enable ${UUID}"
