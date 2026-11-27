# Development

This fork vendors `external/mpvqt` as ordinary source files; no submodule checkout is required.

Platform-specific build instructions:
- [macOS](macos/README.md)
- [Windows](windows/README.md)
- [Linux](linux/README.md)

## Qt Toolchain

Windows/macOS setup scripts and CI share these pins:

| Component | Default | Source of truth |
| --- | --- | --- |
| Qt | 6.12.0 | `qt-version.txt` |
| Qt WebEngine for Qt 6.12 | **6.140.0** (repository channel `61400`) | `install-qt.py` and official repository metadata |
| aqtinstall | 3.3.0 | `requirements-build.txt` |
| Windows libmpv | 20261108-git-55d3feb45c | `mpv-version.txt` |

As checked on 2026-11-14, Qt 6.12.0 remains the latest publicly released stable
version. Its matching WebEngine package was updated on 2026-11-11 and is officially
labelled **Qt WebEngine 6.140.0**, without an RC suffix. The installer build version
is `6.12.0-0-202611110526`, belonging to the Qt 6.12.0 kit. CMake reports Core
`6.12.0` and WebEngine `6.140.0`; the different version numbers are expected.
The `2.0.4-Lain` release used the earlier WebEngine RC package; the updated
package is selected for the `2.0.5-Lain` CI build and `2.0.6-Lain`.

Use `install-qt.py`, not plain `aqt install-qt`, with the pinned Python requirements.
The adapter handles the new Windows base-package path and the versioned WebEngine
repository, avoiding an obsolete July WebEngine build selected by ordinary aqt.
It delegates package parsing, download verification, extraction and relocation to aqt.
Each installation reads the build version and installation directory from official
metadata, allowing package revisions in the same channel without changing the Qt Core pin.
If the matching package is missing, installation fails rather than silently mixing versions.
Supported installer targets are Windows x64, Linux x64 and universal macOS.

The default kit requires CMake 3.25+. On macOS it requires Xcode 16/macOS 15 SDK or
newer and a deployment target of macOS 14.4 or newer. CMake derives the deployment
target from the chosen Qt kit and uses the same value in the application Info.plist.
Other dependencies, such as Homebrew's libmpv bottles, may require a newer OS.
The release CI therefore sets macOS 15.0 explicitly and verifies bundled libraries.

For an older kit when investigating compatibility, explicitly set `QT_VERSION=6.11.3`;
`6.9.3` is also available as the conservative upstream baseline. Keep this environment override
for setup, build, run, test and bundle scripts, and use a clean build directory when
switching kits. Windows/macOS Actions also accept a `qt_version` input; empty uses
the shared pin. There is no automatic downgrade. Linux distribution builds still
use system Qt; see the Linux instructions for an opt-in build with the latest kit.

Fixes to JS signal listeners and bundled MpvQt input-node ownership do not establish
that all Qt/WebEngine memory regressions, including QTBUG-141377, are resolved.
Retest long playback sessions before distributing builds with a new kit.

Official references:
- [Current Qt 6.12 releases](https://download.qt.io/official_releases/qt/6.12/)
- [Qt 6.12.0 release files](https://download.qt.io/official_releases/qt/6.12/6.12.0/)
- [Windows WebEngine channel label](https://download.qt.io/online/qtsdkrepository/windows_x86/extensions/qtwebengine/6120/61400/main/Updates.xml)
- [Windows WebEngine package metadata](https://download.qt.io/online/qtsdkrepository/windows_x86/extensions/qtwebengine/6120/61400/msvc2022_64/Updates.xml)
- [Qt 6.12 macOS requirements](https://doc.qt.io/qt-6.12/macos.html)

See [CONTRIBUTING.md](../CONTRIBUTING.md) for automated tests and the playback acceptance checklist.
Application changes reviewed through upstream `6482a5f` (2026-11-14) are recorded
in [UPSTREAM.md](../UPSTREAM.md); that sync does not change the dependency pins above.

## Bundled Windows Subtitle Fonts

Windows packages include unmodified Noto Sans CJK SC and Noto Serif CJK SC,
Regular and Bold. `fonts.json` pins each font and its SIL Open Font License 1.1
to an immutable Noto CJK commit and SHA-256 digest. No Microsoft fonts are redistributed.
The Windows setup script and CI run:

```sh
python dev/install-fonts.py -O deps/fonts
python dev/install-fonts.py -O deps/fonts --check
```

CMake locates `dev/windows/deps/fonts` or `deps/fonts`, or accepts an explicit
`BUNDLED_FONTS_DIR`. It verifies every font/license before deploying them next to
the build-tree executable and in both Windows packages. The `fonts/` directory
contains only fonts; `licenses/fonts/` holds the licenses and source manifest.
Fonts are application-local, never installed into the system font directory.

MPV receives `sub-fonts-dir` before any media is opened. Default/Sans-Serif maps to
Noto Sans and Serif maps to Noto Serif when bundled fonts are available. Explicit
font selections and manual MPV settings remain supported. ASS font styles and
embedded fonts are not forced off. QML/connection-page system fonts and fonts
provided by the Jellyfin server's web UI are deliberately unchanged.

Package tests disable the subtitle system-font provider and verify actual libass
font selection for Chinese/CJK SRT and ASS using all four fonts, not just file presence.
The downloader's offline/cache/integrity checks run with
`python -m unittest discover -s tests -p 'test_install_*.py'` alongside Qt adapter tests.

## Web Debugger

To get browser devtools, use remote debugging:

1. Run with `--remote-debugging-port=9222`
2. Open Chromium/Chrome and navigate to `chrome://inspect/#devices`
3. Make sure "Discover Network Targets" is checked and `localhost:9222` is configured

## QML Logging

The `console.log()` statements in QML are not printed to the console by default. The simplest workaround for this is to add the following command line argument:

`--log-level debug`

For Qt Creator users, click Projects in the left sidebar, select the "Run Settings" tab, and paste that into the "Command line arguments" text field.
