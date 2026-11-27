# Contributing to Jellyfin Desktop

## Running Tests

Jellyfin Desktop uses Qt Test for native tests, Node.js for playback and connection
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

### Web Adapter and Installer Tests

These suites do not need a running GUI, libmpv or a Jellyfin server:

```sh
node --test tests/test_mpvPlayers.js tests/test_connectivity.js
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
Connection tests cover cancellation before WebChannel starts, overlapping requests
to the same URL, listener cleanup, address validation, repeated submissions, and
saved-server startup without overwriting manual input or reviving cancelled work.
They also check that the form is usable before the bridge is ready, button cancellation
and immediate retry, visible validation with error cleanup on editing, bridge failure
and timeout recovery, and Chinese region/script language tags.

The native `test_systemcomponent` suite also starts HTTP servers on loopback with
automatically assigned ports. It checks real Qt reply cancellation during HEAD/GET,
timeout recovery, invalid server responses, HEAD rejection, retry cancellation,
request IDs, IPv6 and encoded reverse-proxy paths. Timeout tests invoke the production
deadline handlers with a zero delay; they cover a 30-second reply timeout, the shared
60-second budget across retries, and a new attempt to the same URL. They do not wait
for a real timeout or contact external servers. Only the IPv6 network case is skipped if IPv6 loopback is unavailable.

The native `test_playercomponent` suite covers millisecond position/duration caches,
100 ms position notifications, unavailable properties and file boundaries, reactive
video visibility while paused, audio-device repair saved to an isolated profile,
and disconnected-device recovery. These checks do not require a real audio device.

The native window-manager suite also checks that raising a visible or hidden window
preserves fullscreen/maximized state and restores a minimized window. It uses Qt's
offscreen platform and software scene graph, so it does not require a GPU.
The logging suite runs initialization/rotation scenarios in child processes with a
five-second deadline. It checks missing or blocked log directories, repeated rotation,
rotation after cleanup, log retention, and token masking without replacing Qt Test's
own message handler.

### Packaged Playback Smoke Test

With Node.js 22+, FFmpeg and a desktop session, run the actual application with
synthetic local media, an isolated profile, and inaudible output:

```sh
node tests/smoke_packaged_player.cjs /path/to/application /tmp/player-smoke
```

Linux can use Xvfb. The test drives the injected playback adapter through a local
WebEngine debugger. A local HTTP fixture first checks the packaged connection bridge,
refreshing native settings on reload despite stale session storage, redirects and
encoded base paths, cancellation during HEAD, replacing a pending GET
to the same address, Escape and the Cancel button restoring the real connection form,
keyboard focus, visible address validation, and layout in a 360-pixel viewport.
It saves screenshots of the form, progress, validation error and small-window layout
alongside `result.json` and the application log. It then checks
MPV's selected audio IDs, pause/resume/seek, zero volume
and subtitle delay. It also verifies that the native SyncPlay position is in
milliseconds, native duration uses the same units, paused video stays visible,
invalid audio-device settings reach MPV as `auto`, and stopping clears the native
timeline and video output. Its single-track file simulates transcoding output; it does
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

- Connections: test IPv6 and reverse-proxy URLs, saved-server startup, Esc/button cancellation and immediately connecting again; verify recovery after a stalled network request and that cancelling does not change the saved server. Check invalid-address messages, focus returning to the address field, Chinese language tags and layout at high zoom or in a small window.
- Direct play and direct stream: select the second/third audio track before and during playback; also test media with non-contiguous track IDs and a fallback transcoding URL.
- Forced transcoding: select a non-default original audio track, switch it during playback, change bitrate and seek; the single output audio track must remain audible and in sync.
- Subtitles: switch embedded/external/off selections, select a different media source on the details page, set an offset and reload the stream; preserve the offset on reload and reset it for a new item.
- Volume and buffering: set volume to zero and restart playback, restore 29%, test slow networking and SyncPlay pause/resume; verify server playback reports and UI buffering indicators.
- Lifecycle and UI: repeatedly start/stop and advance episodes, navigate between servers, toggle fullscreen from windowed/maximized mode and observe memory over a long session; check for a white WebEngine layer covering MPV. Test Esc with playing/paused video, including starting video after entering fullscreen, and verify it reaches the web UI when browsing or playing only audio.
- Hardware: test supported hardware decoders, high-bitrate 4K, refresh-rate switching, HDMI audio passthrough and device changes on real Windows/macOS/Linux machines; compare with an older Qt kit if a regression appears.

Record Qt Core/WebEngine/libmpv versions, OS, GPU/driver, playback method and logs.
Sanitize server addresses, tokens and private media names before sharing logs.
