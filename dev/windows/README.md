# Building Jellyfin Desktop on Windows

## Quick Start

### Setup and build
```cmd
dev\windows\setup.bat
dev\windows\build.bat
```
After first-time tool installation, reopen the terminal before running `build.bat`.
### Run the application
```cmd
dev\windows\run.bat
```
### Run the unit tests
```cmd
dev\windows\test.bat
```

## Prerequisites

- **winget** (Windows Package Manager)
- **Node.js 18+** (optional for local builds, required for the JavaScript playback tests)

`setup.bat` installs everything else:
- Visual Studio 2022 Build Tools (v143 toolset)
- CMake 3.25+, Ninja, 7-Zip, Inno Setup
- Python 3.13, isolated aqtinstall 3.3.0, Qt 6.12.0
- Matching Qt WebEngine **6.140.0-rc** from the versioned repository
- libmpv (AVX2 + fallback), VC++ redistributable
- Noto Sans CJK SC / Noto Serif CJK SC subtitle fonts (Regular + Bold, SIL OFL 1.1)
- MinGW, WiX (for packaging)

The RC label is significant: the default is the newest Qt kit, not an entirely
stable component set. See [Qt toolchain policy](../README.md#qt-toolchain) and the
[Chinese build guide](../../BUILD-Windows.md) for validation limits and manual setup.

To select the stable-pairing fallback instead, use the same terminal for all scripts:

```cmd
set QT_VERSION=6.11.3
dev\windows\setup.bat
dev\windows\build.bat
dev\windows\test.bat
```

Use a clean build directory when switching Qt versions. `set QT_VERSION=` restores
the shared default. Version 6.9.3 is another explicit fallback. Setup can be rerun
to repair a partial Qt/WebEngine installation and update pinned MPV dependencies.
It also verifies or repairs the app-local subtitle fonts; no fonts are installed
into Windows. See [font packaging](../README.md#bundled-windows-subtitle-fonts)
for the source manifest, licensing, and subtitle-versus-web-UI behavior.

## Directory Structure

- `dev/windows/deps/` - Downloaded dependencies (Qt, mpv, etc.)
- `build/` - Build output (safe to delete)
- `build/src/Jellyfin Desktop.exe` - Built executable

## Scripts

- `setup.bat` - Download all dependencies
- `build.bat` - Configure and build
- `bundle.bat` - Create installer and portable ZIP
- `run.bat` - Run executable (sets up Qt/mpv in PATH)
- `test.bat` - Run unit tests (sets up Qt/mpv in PATH)
- `common.bat` - Shared variables (sourced by other scripts)
- `install-mpv.bat` - Validates and updates the pinned MPV archives (called by setup)

## Clean Build

```cmd
rmdir /s /q build
dev\windows\build.bat
```

## Troubleshooting

### Black Screen / GPU Issues

Disable WebEngine GPU acceleration for diagnosis:
```cmd
dev\windows\run.bat --disable-gpu --log-level debug
```
This does not disable MPV hardware decoding; adjust that separately in player settings.

Common causes:
- Outdated GPU drivers
- Missing DirectX components
- Hardware acceleration incompatibility

### Log Files

```
%LOCALAPPDATA%\Jellyfin Desktop\profiles\<profile-id>\logs\
```

## Notes

- The default Qt kit uses the VS 2022 toolset (v143)
- Qt/MPV pins are centralized in `dev/qt-version.txt` and `dev/mpv-version.txt`
- `run.bat` adds Qt/mpv to PATH; `bundle.bat` creates standalone packages
