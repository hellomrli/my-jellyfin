# Building Jellyfin Desktop on Linux

## Quick Start

### Setup and build

```bash
dev/linux/setup.sh   # First time: install dependencies (Debian/Ubuntu)
dev/linux/build.sh   # Configure, build, and optionally install
```

## Prerequisites

- **Debian/Ubuntu** (or derivative) with `apt-get`

`setup.sh` installs everything else:

- Build tooling: `devscripts`, `equivs`, `ninja-build`, `cmake`
- Build-time packages from [`../../debian/control`](../../debian/control)'s `Build-Depends`, including the required Qt6 modules (`qt6-base-dev`, `qt6-base-private-dev`, `qt6-declarative-dev`, `qt6-webengine-dev`, `qt6-wayland-dev`), `libmpv-dev`, `libcec-dev`, and the rest of the native toolchain
- Runtime QML plugins from `debian/control`'s `Depends:` field (`qml6-module-qtwebengine`, `qml6-module-qtwebchannel`, `qml6-module-qtquick-controls`, `qml6-module-qtquick-window`, `qml6-module-qtqml-workerscript`, `qml6-module-qtquick-templates`, `qml6-module-qt-labs-platform`), none of these are pulled in transitively by the `-dev` packages above, so they're installed separately

## Optional Latest Qt Build

Distribution builds intentionally use system Qt. To test the shared Qt 6.12.0 pin
instead, install the native dependencies above plus Python venv support and
Node.js 18+, then run from the repository root:

```bash
QT_DEPS="$HOME/.cache/jellyfin-desktop-build"
QT_VERSION="$(cat dev/qt-version.txt)"
python3 -m venv "$QT_DEPS/python"
"$QT_DEPS/python/bin/python" -m pip install -r dev/requirements-build.txt
"$QT_DEPS/python/bin/python" dev/install-qt.py linux desktop "$QT_VERSION" linux_gcc_64 \
  -m qtwebengine qtwebchannel qtpositioning qtserialport -O "$QT_DEPS/qt"
cmake -S . -B build -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DQTROOT="$QT_DEPS/qt/$QT_VERSION/gcc_64" \
  -DUSE_STATIC_MPVQT=ON -DREQUIRE_NODE_TESTS=ON
cmake --build build
ctest --test-dir build --output-on-failure
```

Use CMake 3.25+ and a clean build directory rather than reusing one configured for
system Qt. The matching WebEngine is **6.140.0-rc**, not a stable module release;
read the [Qt toolchain policy](../README.md#qt-toolchain) before choosing this kit.
For an explicit fallback, replace `QT_VERSION` with `6.11.3` or `6.9.3` and rebuild.
The input-node memory fix requires bundled MpvQt; installing system MpvQt does not
apply the patch in `external/mpvqt`.

## Install

`build.sh` asks for confirmation separately before each `sudo` step:

1. **Install Binary** @ `/usr/local/bin/jellyfin-desktop`
2. **Desktop integration** (`.desktop` file, icon, appdata metadata) @ `/usr/local/share/{applications,icons,metainfo}/`

Answer `n` to either prompt to skip it. The built binary at `build/src/jellyfin-desktop` still runs without installing.

## Directory Structure

- `build/` - Build output (safe to delete)
- `build/src/jellyfin-desktop` - Built executable

## Scripts

- `setup.sh` - Install build and runtime dependencies
- `build.sh` - Initialize submodules, configure, build, and optionally install

## Clean Build

```bash
rm -rf build
dev/linux/build.sh
```

## Troubleshooting

### Missing Qt6 packages

```
error: Qt6 dev packages not found. Run setup.sh first
```

Run `dev/linux/setup.sh`.

## Notes

- Data/config/cache/log file locations are documented in the [main README](../../README.md#file-locations)
