# Contributing to Jellyfin Desktop

## Running Tests

Jellyfin Desktop uses Qt Test for native unit tests, Node.js for playback-adapter
regressions, and Python unittest for Qt installer package selection.

### Building Tests

Tests are built automatically when you build the project:

```sh
cmake -B build -DUSE_STATIC_MPVQT=ON -DREQUIRE_NODE_TESTS=ON
cmake --build build
```

Install the platform dependencies first and select the intended Qt kit with
`-DQTROOT=/path/to/Qt/kit` if not using system Qt. `REQUIRE_NODE_TESTS=ON` makes
Node.js 18+ mandatory; without it, local builds warn and omit the JS suite when
Node is unavailable. CI requires it. The MpvQt ownership test is built only with
`USE_STATIC_MPVQT=ON`, because the fix is in the bundled library, not system MpvQt.

### Running Tests

Run all tests using CTest:

```sh
ctest --test-dir build --output-on-failure
```

Or run individual test executables directly:

```sh
cd build
./tests/test_systemcomponent
```

The Windows/macOS `dev/*/test.*` scripts set up runtime Qt/MPV paths for unbundled
builds. The window-manager test uses Qt's offscreen platform in CTest.

### Playback Adapter and Installer Tests

These suites do not need a running GUI, libmpv or a Jellyfin server:

```sh
node --test tests/test_mpvPlayers.js
python -m pip install -r dev/requirements-build.txt
python -m unittest discover -s tests -p 'test_install_qt.py' -v
```

Use a virtual environment for the Python dependency (the platform setup scripts
already create one under `dev/windows/deps/python` or `dev/macos/deps/python`).
Installer tests exercise aqt's real package parser with in-memory metadata; they
do not download Qt. Package dry-runs can separately verify live repository paths:

```sh
python dev/install-qt.py windows desktop 6.12.0 win64_msvc2022_64 \
  -m qtwebengine qtwebchannel qtpositioning qtserialport --dry-run
```

The JS tests cover direct/transcoded audio mapping, embedded/external subtitles,
pre-play selections, subtitle offset on stream reload, integer/zero volume,
buffering events, signal cleanup, playback-state reset and SyncPlay position units.

### Packaged Playback Smoke Test

With Node.js 22+, FFmpeg and a desktop session, run the actual application with
synthetic local media, an isolated profile, and inaudible output:

```sh
node tests/smoke_packaged_player.cjs /path/to/application /tmp/player-smoke
```

Linux can use Xvfb. The test drives the injected playback adapter through a local
WebEngine debugger, checks MPV's selected audio IDs, pause/resume/seek, zero volume
and subtitle delay. It also verifies that the native SyncPlay position is in
milliseconds. Its single-track file simulates transcoding output; it does
not exercise a real server's transcoder, network, hardware decoding or audio output.

Windows CI runs `tests/verify_windows_package.ps1` after packaging. It hides the
development Qt kit, tests the portable package's primary and baseline MPV DLLs,
checks neither DLL was modified, and tests silent install/playback/uninstall.
It verifies the bundled Noto fonts/licenses against `dev/fonts.json`, disables
the subtitle system-font provider, and requires actual libass font selection for
both families and weights using CJK SRT/ASS fixtures. It also checks default/reset,
explicit and manual font settings without forcing ASS styles or disabling attachments.
macOS CI verifies the DMG, audits bundled Mach-O dependencies and minimum OS with
`tests/verify_macos_bundle.py`, checks the ad-hoc signature and runs the smoke test
on the extracted app without the development Qt kit. Verification logs are kept
as Actions artifacts even when a check fails; failed packages are not uploaded.
Only the Windows build/test/package workflow runs automatically for this fork.
macOS, AppImage and the Linux Qt matrix remain optional manual workflows.

### MPV Input-Node Leak Check (Linux)

With the normal native build dependencies installed, build the bundled MpvQt test
under AddressSanitizer/LeakSanitizer using GCC or Clang:

```sh
cmake -S . -B /tmp/jellyfin-desktop-asan -G Ninja \
  -DUSE_STATIC_MPVQT=ON -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_FLAGS="-fsanitize=address -fno-omit-frame-pointer" \
  -DCMAKE_EXE_LINKER_FLAGS="-fsanitize=address"
cmake --build /tmp/jellyfin-desktop-asan --target test_mpvcontroller
ASAN_OPTIONS=detect_leaks=1:halt_on_error=1 \
  /tmp/jellyfin-desktop-asan/tests/test_mpvcontroller
```

This exercises repeated sync/async calls, nested node allocation and failure
paths. It is not a whole-application Qt/WebEngine memory-leak certification.

### Writing Tests

Tests are located in the `tests/` directory. To add a new test:

1. Create a test file in `tests/` (e.g., `test_mycomponent.cpp`)
2. Use `QTEST_APPLESS_MAIN` for headless unit tests
3. Add the test to `tests/CMakeLists.txt`

Example test structure:

```cpp
#include <QtTest/QtTest>
#include "../src/mycomponent/MyComponent.h"

class TestMyComponent : public QObject
{
  Q_OBJECT

private slots:
  void testMyFunction_data();
  void testMyFunction();
};

void TestMyComponent::testMyFunction_data()
{
  QTest::addColumn<QString>("input");
  QTest::addColumn<QString>("expected");

  QTest::newRow("test case 1") << "input1" << "output1";
  QTest::newRow("test case 2") << "input2" << "output2";
}

void TestMyComponent::testMyFunction()
{
  QFETCH(QString, input);
  QFETCH(QString, expected);

  QString result = MyComponent::myFunction(input);
  QCOMPARE(result, expected);
}

QTEST_APPLESS_MAIN(TestMyComponent)
#include "test_mycomponent.moc"
```

For more information on Qt Test, see the [Qt Test documentation](https://doc.qt.io/qt-6/qtest-overview.html).

## Playback Acceptance Checklist

Automated tests and a local-file smoke test do not replace these checks against
a real Jellyfin server and the target operating system after a Qt/libmpv upgrade:

- Direct play and direct stream: select the second/third audio track before and during playback; also test media with non-contiguous track IDs and a fallback transcoding URL.
- Forced transcoding: select a non-default original audio track, switch it during playback, change bitrate and seek; the single output audio track must remain audible and in sync.
- Subtitles: switch embedded/external/off selections, select a different media source on the details page, set an offset and reload the stream; preserve the offset on reload and reset it for a new item.
- Volume and buffering: set volume to zero and restart playback, restore 29%, test slow networking and SyncPlay pause/resume; verify server playback reports and UI buffering indicators.
- Lifecycle and UI: repeatedly start/stop and advance episodes, navigate between servers, toggle fullscreen from windowed/maximized mode and observe memory over a long session; check for a white WebEngine layer covering MPV.
- Hardware: test supported hardware decoders, high-bitrate 4K, refresh-rate switching, HDMI audio passthrough and device changes on real Windows/macOS/Linux machines; compare with an older Qt kit if a regression appears.

Record Qt Core/WebEngine/libmpv versions, OS, GPU/driver, playback method and logs.
Sanitize server addresses, tokens and private media names before sharing logs.
