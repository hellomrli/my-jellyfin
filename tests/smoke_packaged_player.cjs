// Runs the actual packaged Qt/WebEngine/MPV application with synthetic local media.
// Requires Node.js 22+, ffmpeg, and a desktop session (Xvfb is sufficient on Linux).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');

async function connectivity(command, baseUrl, requests, output) {
    const evaluate = async expression => {
        const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        assert.ok(!response.exceptionDetails, JSON.stringify(response.exceptionDetails));
        return response.result.value;
    };
    const waitForRequest = async (method, url) => {
        for (let i = 0; i < 100; i++) {
            if (requests.some(request => request.method === method && request.url === url)) return;
            await delay(50);
        }
        throw Error(`Connection probe did not reach the local server: ${method} ${url}`);
    };
    const start = async url => evaluate(`window.connectionProbe = window.jmpCheckServerConnectivity(${JSON.stringify(url)})
        .then(url => ({ url }), error => ({ error: error.message })); true`);
    const screenshot = async filename => {
        const { data } = await command('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(output, filename), Buffer.from(data, 'base64'));
    };

    const oldZoom = await evaluate(`(async () => {
        await window.initCompleted;
        const oldZoom = window.jmpInfo.settings.main.allowBrowserZoom;
        await new Promise(resolve => window.api.settings.setValue('main', 'allowBrowserZoom', !oldZoom, resolve));
        sessionStorage.setItem('settings', JSON.stringify({ main: { allowBrowserZoom: oldZoom } }));
        sessionStorage.setItem('settingsDescriptions', '{}');
        window.beforeSmokeReload = true;
        return oldZoom;
    })()`);
    assert.equal(typeof oldZoom, 'boolean');
    await command('Page.reload', { ignoreCache: true });
    let refreshed = false;
    for (let attempt = 0; attempt < 150 && !refreshed; attempt++) {
        await delay(100);
        const response = await command('Runtime.evaluate', { expression: `!window.beforeSmokeReload && !!window.api?.settings && !!document.getElementById('connect-form')`, returnByValue: true });
        refreshed = response.result?.value === true;
    }
    assert.ok(refreshed, 'Native settings must become ready after reload');
    assert.equal(await evaluate('window.jmpInfo.settings.main.allowBrowserZoom'), !oldZoom);
    assert.ok(await evaluate('!!window.jmpInfo.settingsDescriptions.audio?.length && sessionStorage.getItem("settings") === null'));
    await evaluate(`new Promise(resolve => window.api.settings.setValue('main', 'allowBrowserZoom', ${oldZoom}, resolve))`);

    await screenshot('connection-form.png');

    // Exercise the packaged JS/C++ bridge, including request IDs and redirect serialization.
    const resolved = await evaluate(`window.jmpCheckServerConnectivity(${JSON.stringify(baseUrl + '/redirect')})`);
    assert.equal(resolved, baseUrl + '/proxy%2Fbase/web/');
    assert.ok(requests.some(request => request.method === 'GET' && request.url === '/proxy%2Fbase/System/Info/Public'));

    await start(baseUrl + '/slow/web/');
    await waitForRequest('HEAD', '/slow/web/');
    const cancelled = await evaluate('window.jmpCheckServerConnectivity.abort(); window.connectionProbe');
    assert.deepEqual(cancelled, { error: 'Connection cancelled' });

    const sameUrl = baseUrl + '/replace/web/';
    await start(sameUrl);
    await waitForRequest('GET', '/replace/System/Info/Public');
    const replaced = await evaluate(`Promise.all([window.connectionProbe,
        window.jmpCheckServerConnectivity(${JSON.stringify(sameUrl)})])`);
    assert.deepEqual(replaced, [{ error: 'Connection cancelled' }, sameUrl]);
    assert.equal(requests.filter(request => request.method === 'GET' && request.url === '/replace/System/Info/Public').length, 2);

    // Drive the real connection form and Escape key while the server keeps HEAD pending.
    await evaluate(`(() => {
        const address = document.getElementById('address');
        address.value = ${JSON.stringify(baseUrl + '/ui-slow/web/')};
        address.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('connect-button').click();
        return true;
    })()`);
    await waitForRequest('HEAD', '/ui-slow/web/');
    assert.equal(await evaluate("document.getElementById('address').disabled"), true);
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    const form = await evaluate(`(() => ({
        disabled: document.getElementById('address').disabled,
        spinner: document.getElementById('spinner').style.display,
        savedServer: window.jmpInfo.settings.main.userWebClient,
        url: window.location.href
    }))()`);
    assert.equal(form.disabled, false);
    assert.equal(form.spinner, 'none');
    assert.ok(!form.savedServer);
    assert.equal(form.url, 'qrc:///web-client/extension/find-webclient.html');

    // A pointer-accessible Cancel must stop native work and restore focus too.
    await evaluate(`(() => {
        const address = document.getElementById('address');
        address.value = ${JSON.stringify(baseUrl + '/ui-click-slow/web/')};
        address.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('connect-button').click();
        return true;
    })()`);
    await waitForRequest('HEAD', '/ui-click-slow/web/');
    const progress = await evaluate(`(() => ({
        addressHidden: getComputedStyle(document.getElementById('address')).display === 'none',
        connectHidden: getComputedStyle(document.getElementById('connect-button')).display === 'none',
        cancelVisible: getComputedStyle(document.getElementById('cancel-button')).display !== 'none',
        cancelFocused: document.activeElement.id === 'cancel-button',
        status: document.getElementById('connection-status').textContent,
        busy: document.getElementById('connect-form').getAttribute('aria-busy')
    }))()`);
    assert.equal(progress.addressHidden, true);
    assert.equal(progress.connectHidden, true);
    assert.equal(progress.cancelVisible, true);
    assert.equal(progress.cancelFocused, true);
    assert.ok(progress.status);
    assert.equal(progress.busy, 'true');
    await screenshot('connection-progress.png');
    const clickedCancel = await evaluate(`(() => {
        document.getElementById('cancel-button').click();
        return {
            disabled: document.getElementById('address').disabled,
            focused: document.activeElement.id,
            cancelHidden: document.getElementById('cancel-button').hidden,
            errorHidden: document.getElementById('connection-error').hidden,
            busy: document.getElementById('connect-form').getAttribute('aria-busy')
        };
    })()`);
    assert.deepEqual(clickedCancel, { disabled: false, focused: 'address', cancelHidden: true, errorHidden: true, busy: 'false' });

    const beforeInvalid = requests.length;
    const invalid = await evaluate(`(() => {
        const address = document.getElementById('address');
        address.value = 'ftp://invalid.test/';
        address.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('connect-button').click();
        const error = document.getElementById('connection-error');
        return {
            visible: getComputedStyle(error).display !== 'none', message: error.textContent,
            invalid: address.getAttribute('aria-invalid'), focused: document.activeElement.id,
            savedServer: window.jmpInfo.settings.main.userWebClient, url: window.location.href
        };
    })()`);
    assert.equal(invalid.visible, true);
    assert.match(invalid.message, /HTTP.*HTTPS/);
    assert.equal(invalid.invalid, 'true');
    assert.equal(invalid.focused, 'address');
    assert.ok(!invalid.savedServer);
    assert.equal(invalid.url, form.url);
    assert.equal(requests.length, beforeInvalid);
    await screenshot('connection-error.png');

    // Error text and buttons must fit a small window without horizontal scrolling.
    await command('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 1, mobile: false });
    const layout = await evaluate(`(() => ({
        width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
        buttonRight: document.getElementById('connect-button').getBoundingClientRect().right
    }))()`);
    assert.equal(layout.width, 360);
    assert.ok(layout.scrollWidth <= layout.width, JSON.stringify(layout));
    assert.ok(layout.buttonRight <= layout.width, JSON.stringify(layout));
    await screenshot('connection-small-window.png');
    await command('Emulation.clearDeviceMetricsOverride');
    const edited = await evaluate(`(() => {
        const address = document.getElementById('address');
        address.value = ${JSON.stringify(baseUrl)};
        address.dispatchEvent(new Event('input', { bubbles: true }));
        return {
            errorHidden: document.getElementById('connection-error').hidden,
            invalid: address.getAttribute('aria-invalid'), disabled: document.getElementById('connect-button').disabled
        };
    })()`);
    assert.deepEqual(edited, { errorHidden: true, invalid: 'false', disabled: false });
    return {
        redirects: true, encodedBasePath: true, cancelResolve: true, replaceSameUrl: true, escapeRestoresForm: true,
        cancelButton: true, cancelFocus: true, visibleValidation: true, validationClearsOnEdit: true, smallWindow: true
    };
}

async function playback({ directUrl, transcodeUrl, fontTests }) {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const waitFor = async predicate => {
        for (let i = 0; i < 150; i++) {
            if (await predicate()) return;
            await sleep(100);
        }
        throw Error('Playback state did not arrive');
    };
    await window.initCompleted;
    await sleep(750);
    window.api.player.userCommand('set ao null');
    const mpvCommand = command => new Promise(resolve => window.api.player.userCommand(command, resolve));
    const setSetting = (section, key, value) => new Promise(resolve => window.api.settings.setValue(section, key, value, resolve));
    const nativeValue = method => new Promise(resolve => window.api.player[method](resolve));
    // No system font may satisfy the Windows bundle test.
    if (fontTests) await mpvCommand('set sub-font-provider none');
    const settings = new Map([['volume', 0.29]]);
    const events = [];
    let playingCount = 0;
    const player = new window._mpvVideoPlayer({
        events: { trigger(_player, name) { events.push(name); if (name === 'playing') playingCount++; } },
        loading: { show() {}, hide() {} }, appRouter: { showVideoOsd() {} },
        appSettings: { get(key) { return settings.get(key); }, set(key, value) { settings.set(key, value); } },
        dashboard: { default: { setBackdropTransparency() {} } },
        confirm: async () => { throw Error('Do not retry synthetic media'); }, appHost: {}, globalize: {}
    });
    player.setMute(true);
    const opts = {
        item: { Id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, fullscreen: false,
        playMethod: 'DirectPlay', url: directUrl,
        mediaSource: {
            Id: 'smoke', DefaultAudioStreamIndex: 2, DefaultSubtitleStreamIndex: -1,
            MediaStreams: [{ Type: 'Video', Index: 0 }, { Type: 'Audio', Index: 1 }, { Type: 'Audio', Index: 2 }]
        }
    };
    await player.play(opts);
    await waitFor(() => playingCount > 0 && player.currentTime() > 500);
    window.api.player.userCommand('print-text "SMOKE_DIRECT_AID=${=aid}"');
    const direct = {
        duration: player.duration(), nativeDuration: await nativeValue('getDuration'),
        position: player.currentTime(), volume: player.getVolume(),
        videoVisible: await nativeValue('isVideoWindowVisible')
    };
    if (fontTests) {
        const renderFrames = async () => {
            const start = await player.currentTimeAsync();
            await waitFor(async () => await player.currentTimeAsync() >= start + 600);
        };
        const reportFont = name => mpvCommand(`print-text "SMOKE_SUB_FONT_${name}=\${sub-font}"`);
        await mpvCommand('print-text "SMOKE_SUB_FONT_PROVIDER=${sub-font-provider}"');
        await reportFont('DEFAULT');
        await mpvCommand('print-text SMOKE_FONT_SRT_BEGIN');
        await mpvCommand(`sub-add ${JSON.stringify(fontTests.plainUrl)} select`);
        await renderFrames();
        await mpvCommand('print-text SMOKE_FONT_SRT_END');
        await setSetting('subtitles', 'font', 'Noto Serif CJK SC');
        await reportFont('EXPLICIT');
        await renderFrames();
        await setSetting('subtitles', 'font', '');
        await reportFont('RESET');
        await renderFrames();
        await setSetting('subtitles', 'font', 'serif');
        await reportFont('SERIF');
        await setSetting('other', 'other_conf', 'sub-font=Noto Serif CJK SC');
        await setSetting('subtitles', 'font', 'sans-serif');
        await reportFont('MANUAL');
        await setSetting('other', 'other_conf', '');
        await reportFont('SANS');
        // ASS explicitly requests both families and weights; sub-font must not replace them.
        await mpvCommand('print-text SMOKE_FONT_ASS_BEGIN');
        await mpvCommand(`sub-add ${JSON.stringify(fontTests.assUrl)} select`);
        await renderFrames();
        await mpvCommand('print-text SMOKE_FONT_ASS_END');
        await mpvCommand('print-text "SMOKE_ASS_OVERRIDE=${sub-ass-override}"');
        await mpvCommand('print-text "SMOKE_EMBEDDED_FONTS=${embeddedfonts}"');
    }
    player.pause();
    await waitFor(() => player.paused());
    const pausedVideoVisible = await nativeValue('isVideoWindowVisible');
    // Reproduce the malformed persisted setting that used to break audio output.
    await setSetting('audio', 'device', false);
    await waitFor(() => window.jmpInfo.settings.audio.device === 'auto');
    const repairedAudioDevice = await new Promise(resolve => window.api.settings.value('audio', 'device', resolve));
    await mpvCommand('print-text "SMOKE_AUDIO_DEVICE=${=audio-device}"');
    const repairedAudioDeviceInWeb = window.jmpInfo.settings.audio.device;
    player.unpause();
    await waitFor(() => !player.paused());
    player.currentTime(5000);
    // SyncPlay uses the native position getter, which must return milliseconds.
    await waitFor(async () => await player.currentTimeAsync() >= 5000);
    const seekPosition = await player.currentTimeAsync();
    player.setVolume(0);
    const nativeVolume = await new Promise(resolve => window.api.player.volume(resolve));
    player.setSubtitleOffset(1.5);
    const previousPlayingCount = playingCount;
    await player.play({ ...opts, playMethod: 'Transcode', url: transcodeUrl, resetSubtitleOffset: false });
    // load() acknowledges the request, not playback readiness. Late position
    // events from the previous file must not end this test before on_preloaded.
    await waitFor(async () => {
        const duration = player.duration();
        if (playingCount <= previousPlayingCount || !(duration >= 8500 && duration <= 10000)) return false;
        const position = await player.currentTimeAsync();
        return position >= 1000 && position < 5000;
    });
    window.api.player.userCommand('print-text "SMOKE_TRANSCODE_AID=${=aid}"');
    const transcode = {
        duration: player.duration(), nativeDuration: await nativeValue('getDuration'),
        position: player.currentTime(), volume: player.getVolume(), offset: player.getSubtitleOffset()
    };
    await player.stop(true);
    await waitFor(async () => await nativeValue('getPosition') === 0
        && await nativeValue('getDuration') === 0 && !await nativeValue('isVideoWindowVisible'));
    const stopped = {
        position: await nativeValue('getPosition'), duration: await nativeValue('getDuration'),
        videoVisible: await nativeValue('isVideoWindowVisible')
    };
    return {
        direct, transcode, stopped, pausedVideoVisible, repairedAudioDevice, repairedAudioDeviceInWeb,
        seekPosition, nativeVolume, savedVolume: settings.get('volume'), events
    };
}

async function main() {
    assert.equal(process.argv.length, 4, 'Usage: node tests/smoke_packaged_player.cjs <app-executable> <output-directory>');
    const executable = path.resolve(process.argv[2]);
    const output = path.resolve(process.argv[3]);
    const config = path.join(output, 'config');
    fs.mkdirSync(config, { recursive: true });
    const sample = path.join(output, 'sample.mkv');
    const selected = path.join(output, 'selected.mkv');
    let fontTests;
    if (process.platform === 'win32') {
        const text = '\u5b57\u5e55 ABC 123 \u7e41\u9ad4 \u65e5\u672c\u8a9e \ud55c\uad6d\uc5b4';
        const plain = path.join(output, 'Chinese subtitle.srt');
        const ass = path.join(output, 'Styled subtitle.ass');
        fs.writeFileSync(plain, `1\n00:00:00,000 --> 00:00:15,000\n${text}\n`, 'utf8');
        const styles = [
            ['SansRegular', 'Noto Sans CJK SC', 0], ['SansBold', 'Noto Sans CJK SC', -1],
            ['SerifRegular', 'Noto Serif CJK SC', 0], ['SerifBold', 'Noto Serif CJK SC', -1]
        ];
        fs.writeFileSync(ass, `[Script Info]\nScriptType: v4.00+\nPlayResX: 640\nPlayResY: 360\n\n[V4+ Styles]\n`
            + 'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\n'
            + styles.map(([name, family, bold]) => `Style: ${name},${family},24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,${bold},0,0,0,100,100,0,0,1,1,0,7,10,10,10,1`).join('\n')
            + '\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
            + styles.map(([name], index) => `Dialogue: 0,0:00:00.00,0:00:15.00,${name},,0,0,0,,{\\pos(20,${20 + index * 70})}${text}`).join('\n') + '\n', 'utf8');
        fontTests = { plainUrl: pathToFileURL(plain).href, assUrl: pathToFileURL(ass).href };
    }
    function ffmpeg(args) {
        const result = spawnSync(process.env.JELLYFIN_TEST_FFMPEG || 'ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...args], {
            encoding: 'utf8', timeout: 60000
        });
        assert.equal(result.status, 0, result.error?.message || result.stderr);
    }
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=24',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
        '-f', 'lavfi', '-i', 'sine=frequency=880:sample_rate=48000',
        '-map', '0:v', '-map', '1:a', '-map', '2:a', '-t', '15',
        '-c:v', 'mpeg4', '-q:v', '5', '-threads', '2', '-c:a', 'aac',
        '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=zho', sample]);
    ffmpeg(['-i', sample, '-map', '0:v', '-map', '0:a:1', '-t', '9', '-c', 'copy', selected]);

    const reservation = net.createServer();
    await new Promise((resolve, reject) => {
        reservation.once('error', reject);
        reservation.listen(0, '127.0.0.1', resolve);
    });
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    const requests = [];
    const server = http.createServer((request, response) => {
        requests.push({ method: request.method, url: request.url });
        if (['/slow/web/', '/ui-slow/web/', '/ui-click-slow/web/'].includes(request.url)) return;
        if (request.method === 'GET' && request.url === '/replace/System/Info/Public'
            && requests.filter(item => item.method === 'GET' && item.url === request.url).length === 1) return;
        if (request.url === '/redirect') {
            response.writeHead(302, { Location: '/proxy%2Fbase/web/' });
        } else {
            response.writeHead(200, { 'Content-Type': 'application/json' });
        }
        response.end(request.method === 'HEAD' ? '' : JSON.stringify({ Id: 'packaged-connectivity-test' }));
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
    });
    const serverUrl = `http://127.0.0.1:${server.address().port}`;
    const env = { ...process.env };
    for (const key of ['QT_PLUGIN_PATH', 'QT_QPA_PLATFORM', 'QML_IMPORT_PATH', 'QML2_IMPORT_PATH',
        'QTWEBENGINE_CHROMIUM_FLAGS', 'DYLD_LIBRARY_PATH', 'DYLD_FRAMEWORK_PATH']) delete env[key];
    if (process.platform === 'win32') {
        // Do not accidentally satisfy missing package DLLs using a developer's Qt kit.
        for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
        env.PATH = `${env.SystemRoot}\\System32;${env.SystemRoot}`;
        env.QT_OPENGL = 'software';
    }
    const child = spawn(executable, ['--config-dir', config, '--windowed', '--disable-gpu',
        `--remote-debugging-port=${port}`, '--log-level', 'debug'], { env });
    let startupError;
    let log = '';
    child.on('error', error => { startupError = error; });
    child.stdout.on('data', data => { log += data.toString(); });
    child.stderr.on('data', data => { log += data.toString(); });
    const closed = new Promise(resolve => child.once('close', resolve));
    let ws;
    let timer;
    let result;
    try {
        const drive = async () => {
            let page;
            for (let i = 0; i < 120; i++) {
                if (startupError) throw startupError;
                if (child.exitCode !== null || child.signalCode !== null) {
                    throw Error(`Application exited early: ${child.exitCode ?? child.signalCode}`);
                }
                try {
                    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
                    page = (await response.json()).find(target => target.type === 'page'
                        && target.url === 'qrc:///web-client/extension/find-webclient.html');
                } catch { /* The WebEngine process may still be starting. */ }
                if (page) break;
                await delay(250);
            }
            assert.ok(page, 'WebEngine debugging target must become available');
            ws = new WebSocket(page.webSocketDebuggerUrl);
            await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
            let requestId = 0;
            const command = (method, params) => new Promise((resolve, reject) => {
                const id = ++requestId;
                if (ws.readyState !== WebSocket.OPEN) return reject(Error('WebEngine debugger is not connected'));
                ws.onmessage = event => {
                    const data = JSON.parse(event.data);
                    if (data.id !== id) return;
                    if (data.error) reject(Object.assign(Error(data.error.message), { code: data.error.code }));
                    else resolve(data.result);
                };
                ws.onerror = () => reject(Error('WebEngine debugger connection failed'));
                ws.onclose = () => reject(Error('WebEngine closed before the test finished'));
                ws.send(JSON.stringify({ id, method, params }));
            });

            // DevTools is available before the initial navigation commits. Only
            // retry this side-effect-free readiness probe, never the playback test.
            let ready = false;
            for (let i = 0; i < 150; i++) {
                try {
                    const probe = await command('Runtime.evaluate', {
                        expression: `document.readyState === 'complete'
                            && typeof window.initCompleted?.then === 'function'
                            && typeof window._mpvVideoPlayer === 'function'
                            && typeof window.api?.player?.load === 'function'`,
                        returnByValue: true
                    });
                    assert.ok(!probe.exceptionDetails, JSON.stringify(probe.exceptionDetails));
                    if (probe.result.value === true) { ready = true; break; }
                } catch (error) {
                    if (error.code !== -32000 || !/Execution context was destroyed|Cannot find context/i.test(error.message)) throw error;
                }
                await delay(100);
            }
            assert.ok(ready, 'Initial web client and native playback bridge must become ready');
            const connectionChecks = await connectivity(command, serverUrl, requests, output);
            const evaluated = await command('Runtime.evaluate', {
                expression: `(${playback.toString()})(${JSON.stringify({
                    directUrl: pathToFileURL(sample).href, transcodeUrl: pathToFileURL(selected).href, fontTests
                })})`, awaitPromise: true, returnByValue: true
            });
            assert.ok(!evaluated.exceptionDetails, JSON.stringify(evaluated.exceptionDetails));
            return { ...evaluated.result.value, connectivity: connectionChecks };
        };
        result = await Promise.race([drive(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('Packaged playback test timed out')), 90000);
        })]);
        assert.ok(result.direct.duration >= 14000);
        assert.ok(Math.abs(result.direct.nativeDuration - result.direct.duration) <= 1,
            'Native taskbar duration must use milliseconds');
        assert.equal(result.direct.volume, 29);
        assert.equal(result.direct.videoVisible, true);
        assert.equal(result.pausedVideoVisible, true);
        assert.equal(result.repairedAudioDevice, 'auto');
        assert.equal(result.repairedAudioDeviceInWeb, 'auto');
        assert.ok(result.seekPosition >= 5000 && result.seekPosition < 15000, 'SyncPlay positions must be in milliseconds');
        assert.equal(result.nativeVolume, 0);
        assert.equal(result.savedVolume, 0);
        assert.ok(result.transcode.duration >= 8500 && result.transcode.duration <= 10000);
        assert.ok(Math.abs(result.transcode.nativeDuration - result.transcode.duration) <= 1,
            'A new file must replace the cached native duration');
        assert.equal(result.transcode.volume, 0);
        assert.equal(result.transcode.offset, 1.5);
        assert.deepEqual(result.stopped, { position: 0, duration: 0, videoVisible: false });
        for (const event of ['playing', 'pause', 'unpause', 'stopped']) assert.ok(result.events.includes(event), event);
        assert.ok(!result.events.includes('error'));
        assert.equal(result.events.filter(event => event === 'waiting').length,
            result.events.filter(event => event === 'canplay').length, 'Every buffering transition must close');
    } finally {
        clearTimeout(timer);
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        if (ws) ws.close();
        if (child.pid && child.exitCode === null && child.signalCode === null) {
            if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
            else child.kill('SIGTERM');
            await Promise.race([closed, delay(5000)]);
            if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
        }
        fs.writeFileSync(path.join(output, 'application.log'), log);
    }
    // Windows GUI applications may write to the profile log instead of stdout.
    function readLogs(directory) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const filename = path.join(directory, entry.name);
            if (entry.isDirectory()) readLogs(filename);
            else if (entry.name.endsWith('.log')) log += fs.readFileSync(filename, 'utf8');
        }
    }
    readLogs(config);
    assert.ok(/SMOKE_DIRECT_AID=2\b/.test(log), 'Wrong direct-play audio ID; see application.log');
    assert.ok(/SMOKE_TRANSCODE_AID=1\b/.test(log), 'Wrong transcoded audio ID; see application.log');
    assert.ok(/SMOKE_AUDIO_DEVICE=auto\b/.test(log), 'Repaired audio device must reach MPV');
    assert.ok(!/No such signal/.test(log), 'Broken Qt signal connection; see application.log');
    if (env.JELLYFIN_MPV_FORCE_FALLBACK === '1') {
        assert.ok(/Using fallback libmpv/.test(log), 'The baseline MPV DLL must actually be loaded');
    }
    if (fontTests) {
        assert.ok(/Using bundled subtitle fonts:/.test(log), 'Application-local fonts must be configured');
        assert.ok(/SMOKE_SUB_FONT_PROVIDER=none\b/.test(log), 'Subtitle test must not use system fonts');
        const expectedFonts = {
            DEFAULT: 'Noto Sans CJK SC', EXPLICIT: 'Noto Serif CJK SC', RESET: 'Noto Sans CJK SC',
            SERIF: 'Noto Serif CJK SC', MANUAL: 'Noto Serif CJK SC', SANS: 'Noto Sans CJK SC'
        };
        for (const [name, font] of Object.entries(expectedFonts)) {
            assert.ok(log.includes(`SMOKE_SUB_FONT_${name}=${font}`), `Wrong subtitle font for ${name}`);
        }
        const fontLog = format => {
            const start = log.indexOf(`SMOKE_FONT_${format}_BEGIN`);
            const end = log.indexOf(`SMOKE_FONT_${format}_END`, start);
            assert.ok(start >= 0 && end > start, `${format} font test must complete`);
            return log.slice(start, end);
        };
        const selectedFont = name => new RegExp(`fontselect: [^\\r\\n]* -> [^\\r\\n]*\\b${name}\\b`);
        assert.ok(selectedFont('NotoSansCJKsc-Regular').test(fontLog('SRT')), 'SRT must render using bundled Noto Sans');
        const assLog = fontLog('ASS');
        const renderedFonts = [];
        for (const family of ['Sans', 'Serif']) {
            for (const weight of ['Regular', 'Bold']) {
                const name = `Noto${family}CJKsc-${weight}`;
                assert.ok(selectedFont(name).test(assLog),
                    `Bundled font must actually render subtitles: ${name}`);
                renderedFonts.push(name);
            }
        }
        assert.ok(/SMOKE_ASS_OVERRIDE=(?:no|yes|scale)\b/.test(log), 'ASS styles must not be forced or stripped');
        assert.ok(/SMOKE_EMBEDDED_FONTS=yes\b/.test(log), 'Embedded subtitle fonts must remain enabled');
        assert.ok(!/fontselect: failed|Glyph .* not found|failed to find any fallback/i.test(log), 'Missing subtitle glyphs');
        result.fonts = { systemFontsDisabled: true, renderedFonts, mappings: expectedFonts, assStylesPreserved: true, embeddedFontsEnabled: true };
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
