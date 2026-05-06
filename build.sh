#!/usr/bin/env bash
# Local build script — run on the machine you want to build for.
# Output lands in dist/
set -euo pipefail

cd "$(dirname "$0")"

# ── Linux prerequisite check ─────────────────────────────────────────────────
if [[ "$(uname)" == "Linux" ]]; then
  if ! dpkg -l libwebkit2gtk-4.0-dev &>/dev/null 2>&1; then
    echo "Missing Linux prerequisite: libwebkit2gtk-4.0-dev"
    echo "Install with:"
    echo "  sudo apt-get install python3-gi python3-gi-cairo gir1.2-gtk-3.0 gir1.2-webkit2-4.0 libgtk-3-dev libwebkit2gtk-4.0-dev"
    exit 1
  fi
fi

echo "→ Installing Python dependencies..."
pip install -r requirements.txt -r requirements-build.txt

echo "→ Building with PyInstaller..."
pyinstaller minicountant.spec --noconfirm

echo ""
echo "Build complete. Output in dist/:"
ls -lh dist/
