// Runs the actual packaged Qt/WebEngine/MPV application with synthetic local media.
// Requires Node.js 22+, ffmpeg, and a desktop session (Xvfb is sufficient on Linux).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');

async function playback({ directUrl, transcodeUrl }) {
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
    const direct = { duration: player.duration(), position: player.currentTime(), volume: player.getVolume() };
    player.pause();
    await waitFor(() => player.paused());
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
    const transcode = { duration: player.duration(), position: player.currentTime(), volume: player.getVolume(), offset: player.getSubtitleOffset() };
    await player.stop(true);
    await sleep(500);
    return { direct, transcode, seekPosition, nativeVolume, savedVolume: settings.get('volume'), events };
}

async function main() {
    assert.equal(process.argv.length, 4, 'Usage: node tests/smoke_packaged_player.cjs <app-executable> <output-directory>');
    const executable = path.resolve(process.argv[2]);
    const output = path.resolve(process.argv[3]);
    const config = path.join(output, 'config');
    fs.mkdirSync(config, { recursive: true });
    const sample = path.join(output, 'sample.mkv');
    const selected = path.join(output, 'selected.mkv');
    function ffmpeg(args) {
        const result = spawnSync('ffmpeg', ['-nostdin', '-loglevel', 'error', '-y', ...args], {
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
            const evaluated = await command('Runtime.evaluate', {
                expression: `(${playback.toString()})(${JSON.stringify({
                    directUrl: pathToFileURL(sample).href, transcodeUrl: pathToFileURL(selected).href
                })})`, awaitPromise: true, returnByValue: true
            });
            assert.ok(!evaluated.exceptionDetails, JSON.stringify(evaluated.exceptionDetails));
            return evaluated.result.value;
        };
        result = await Promise.race([drive(), new Promise((_, reject) => {
            timer = setTimeout(() => reject(Error('Packaged playback test timed out')), 90000);
        })]);
        assert.ok(result.direct.duration >= 14000);
        assert.equal(result.direct.volume, 29);
        assert.ok(result.seekPosition >= 5000 && result.seekPosition < 15000, 'SyncPlay positions must be in milliseconds');
        assert.equal(result.nativeVolume, 0);
        assert.equal(result.savedVolume, 0);
        assert.ok(result.transcode.duration >= 8500 && result.transcode.duration <= 10000);
        assert.equal(result.transcode.volume, 0);
        assert.equal(result.transcode.offset, 1.5);
        for (const event of ['playing', 'pause', 'unpause', 'stopped']) assert.ok(result.events.includes(event), event);
        assert.ok(!result.events.includes('error'));
    } finally {
        clearTimeout(timer);
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
    assert.ok(!/No such signal/.test(log), 'Broken Qt signal connection; see application.log');
    if (env.JELLYFIN_MPV_FORCE_FALLBACK === '1') {
        assert.ok(/Using fallback libmpv/.test(log), 'The baseline MPV DLL must actually be loaded');
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
}

main().catch(error => { console.error(error); process.exitCode = 1; });
