# Building Jellyfin Desktop on macOS

## Quick Start

### Setup and build
```bash
dev/macos/setup.sh   # First time: install dependencies
dev/macos/build.sh   # Build
```
### Run the application
```bash
dev/macos/run.sh
```
### Run the unit tests
```bash
dev/macos/test.sh
```

## Prerequisites

- **Xcode 16 / macOS 15 SDK or newer** for the default Qt kit; compatible Command Line Tools can be installed with `xcode-select --install`
- **Homebrew**: https://brew.sh
- **Node.js 18+** (optional locally, required for the JavaScript playback tests)

`setup.sh` installs everything else:
- CMake 3.25+, Ninja, create-dmg
- Python 3.13, isolated aqtinstall 3.3.0, Qt 6.12.0
- Matching Qt WebEngine **6.140.0** from the versioned repository (package updated 2026-11-11)
- mpv

The default kit supports macOS **14.4+** on both Intel and Apple Silicon. CMake
uses the selected kit's deployment minimum for compiler flags and Info.plist;
an explicitly lower `CMAKE_OSX_DEPLOYMENT_TARGET` is rejected. Homebrew dependencies
may require a newer OS. See [Qt toolchain policy](../README.md#qt-toolchain) for
official sources and the current WebEngine package information.

Release CI deliberately targets **macOS 15+** to match its Homebrew dependencies,
and audits the native architecture and minimum OS of every bundled Mach-O image.
DMGs are ad-hoc signed for bundle integrity, not Developer ID signed or notarized.

For an older kit when investigating compatibility, keep this override set while
using all development scripts:

```bash
export QT_VERSION=6.11.3
dev/macos/setup.sh
dev/macos/build.sh
dev/macos/test.sh
```

Use a clean build directory when switching Qt kits. `unset QT_VERSION` restores the
default. Qt 6.11 requires macOS 13+; Qt 6.9.3 is another explicit fallback with a
Qt minimum of macOS 12. Neither fallback lowers the requirements of your libmpv
or other native dependencies automatically.

## Directory Structure

- `dev/macos/deps/` - Downloaded dependencies (Qt)
- `build/` - Build output (safe to delete)
- `build/src/Jellyfin Desktop.app` - Dev build (unbundled, for run.sh)
- `build/output/Jellyfin Desktop.app` - Release build (bundled, from bundle.sh)

## Scripts

- `setup.sh` - Install all dependencies
- `build.sh` - Configure and build
- `bundle.sh` - Create DMG for distribution
- `run.sh` - Run the built app (passes arguments through)
- `test.sh` - Run unit tests (sets up Qt/mpv in PATH)
- `common.sh` - Shared variables (sourced by other scripts)

## Clean Build

```bash
rm -rf build
dev/macos/build.sh
```

## Troubleshooting

### Black Screen / GPU Issues

Disable WebEngine GPU acceleration for diagnosis:
```bash
dev/macos/run.sh --disable-gpu --log-level debug
```
This does not disable MPV hardware decoding; adjust that separately in player settings.

### Log Files

```
~/Library/Logs/Jellyfin Desktop/<profile-id>/
```

## Notes

- Qt/MPV downloads are not proof of a working macOS application. Run the build, tests and playback acceptance checklist on macOS before distributing the DMG.
- Local setup and CI use the same Qt pin from `dev/qt-version.txt`.
