#!/usr/bin/env sh
# Jellyfin Desktop - macOS dependency installer
# Run once to install all build dependencies
set -eu

SCRIPT_DIR="$(cd "$(dirname "${0}")" && pwd)"
. "${SCRIPT_DIR}/common.sh"

echo "[1/5] Checking Xcode Command Line Tools..."
if ! xcode-select -p > /dev/null 2>&1; then
    echo "Installing Xcode Command Line Tools..."
    xcode-select --install
    echo "Please re-run this script after installation completes"
    exit 0
fi

echo "[2/5] Checking Homebrew..."
if ! command -v brew > /dev/null; then
    echo "error: Homebrew not found. Install from https://brew.sh" >&2
    exit 1
fi

echo "[3/5] Installing build tools..."
brew install python@3.13 mpv ninja cmake create-dmg
mkdir -p "${DEPS_DIR}"
"$(brew --prefix python@3.13)/bin/python3.13" -m venv "${DEPS_DIR}/python"
"${DEPS_DIR}/python/bin/python" -m pip install -r "${SCRIPT_DIR}/../requirements-build.txt"

echo "[4/5] Installing Qt ${QT_VERSION}..."
"${DEPS_DIR}/python/bin/python" "${SCRIPT_DIR}/../install-qt.py" mac desktop "${QT_VERSION}" clang_64 \
    -m qtwebengine qtwebchannel qtpositioning -O "${DEPS_DIR}/qt"

echo "[5/5] Generating CMakePresets.json..."
BREW_PREFIX="$(brew --prefix)"
sed -e "s|@QT_VERSION@|${QT_VERSION}|g" \
    -e "s|@BREW_PREFIX@|${BREW_PREFIX}|g" \
    "${SCRIPT_DIR}/../CMakePresets.json.in" > "${PROJECT_ROOT}/CMakePresets.json"

echo ""
echo "Setup complete. Run build.sh to build."
