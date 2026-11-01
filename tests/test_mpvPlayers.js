const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function signal() {
    let listeners = [];
    return {
        connect(callback) { listeners.push(callback); },
        disconnect(callback) { listeners = listeners.filter(listener => listener !== callback); },
        emit(...args) { for (const callback of [...listeners]) callback(...args); },
        get count() { return listeners.length; }
    };
}

function fixture(savedVolume = 0.5) {
    let dialog;
    const selectors = {};
    const calls = [];
    const emitted = [];
    const settings = new Map([['volume', savedVolume]]);
    const native = {
        load(...args) {
            calls.push(['load', ...args.slice(0, -1)]);
            args.at(-1)(true);
        }
    };
    for (const name of ['stop', 'pause', 'play', 'seekTo', 'setVideoRectangle', 'setSubtitleDelay',
        'setPlaybackRate', 'notifyRateChange', 'setVolume', 'setMuted', 'setAudioStream', 'setSubtitleStream']) {
        native[name] = (...args) => calls.push([name, ...args]);
    }
    const signalNames = ['playing', 'positionUpdate', 'finished', 'updateDuration', 'error', 'paused',
        'bufferedRangesUpdated', 'buffering', 'canceled', 'stopped', 'stateChanged', 'videoPlaybackActive',
        'windowVisible', 'onVideoRecangleChanged', 'onMetaData'];
    for (const name of signalNames) native[name] = signal();

    const jmpInfo = {
        userAgent: 'playback-regression-test',
        settings: { video: { default_playback_speed: 1 }, main: { fullscreen: false } }
    };
    const context = {
        console: { log() {}, debug() {}, warn() {}, error() {} },
        setTimeout, clearTimeout, jmpInfo, api: { player: native },
        window: { api: { player: native }, jmpInfo, location: { hash: '' } },
        document: {
            querySelector(selector) {
                return selector === '.videoPlayerContainer' ? dialog : selectors[selector];
            },
            createElement() { return { style: {}, classList: { add() {} } }; },
            body: {
                classList: { add() {}, remove() {} },
                insertBefore(element) {
                    dialog = element;
                    element.parentNode = { removeChild() { dialog = undefined; } };
                }
            }
        }
    };
    vm.createContext(context);
    for (const file of ['mpvVideoPlayer.js', 'mpvAudioPlayer.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../native', file), 'utf8'), context, { filename: file });
    }
    const dependencies = {
        events: { trigger(player, name, args = []) { emitted.push({ player, name, args }); } },
        loading: { show() {}, hide() {} }, appRouter: { showVideoOsd() {} },
        appSettings: { get(key) { return settings.get(key); }, set(key, value) { settings.set(key, value); } },
        dashboard: { default: { setBackdropTransparency() {} } },
        confirm: async () => {}, toast() {}, appHost: {}, globalize: {}
    };
    return {
        video: new context.window._mpvVideoPlayer(dependencies),
        audio: new context.window._mpvAudioPlayer(dependencies),
        native, signalNames, calls, emitted, settings, selectors, context,
        eventCount(name) { return emitted.filter(event => event.name === name).length; },
        lastCall(name) { return calls.filter(call => call[0] === name).at(-1); }
    };
}

function options(playMethod = 'DirectPlay', mediaSource = {}) {
    return {
        item: { Id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
        fullscreen: false,
        url: 'https://example.invalid/video',
        playMethod,
        mediaSource: {
            Id: 'source-1',
            DefaultAudioStreamIndex: 5,
            DefaultSubtitleStreamIndex: -1,
            MediaStreams: [
                { Type: 'Video', Index: 0 },
                { Type: 'Audio', Index: 1 },
                { Type: 'Subtitle', Index: 2 },
                { Type: 'Audio', Index: 3, IsExternal: true },
                { Type: 'Subtitle', Index: 4, IsExternal: true, DeliveryMethod: 'External', DeliveryUrl: 'https://example.invalid/sub.srt' },
                { Type: 'Audio', Index: 5 },
                { Type: 'Subtitle', Index: 6 }
            ],
            ...mediaSource
        }
    };
}

for (const method of ['DirectPlay', 'DirectStream', 'Transcode']) {
    test(`${method}: audio selection follows the output stream, not a fallback URL`, async () => {
        const f = fixture();
        await f.video.play(options(method, { TranscodingUrl: '/fallback.m3u8' }));
        assert.equal(f.lastCall('load')[4], method === 'Transcode' ? 1 : 2);
        f.video.setAudioStreamIndex(5);
        assert.equal(f.lastCall('setAudioStream')[1], method === 'Transcode' ? 1 : 2);
        f.video.setAudioStreamIndex(1);
        assert.equal(f.lastCall('setAudioStream')[1], 1);
        f.video.setAudioStreamIndex(-1);
        assert.equal(f.lastCall('setAudioStream')[1], -1);
    });
}

test('transcode mapping does not depend on TranscodingUrl being present', async () => {
    const f = fixture();
    await f.video.play(options('Transcode'));
    assert.equal(f.lastCall('load')[4], 1);
});

test('an unspecified audio track selects the first output track', async () => {
    const f = fixture();
    await f.video.play(options('DirectPlay', { DefaultAudioStreamIndex: null }));
    assert.equal(f.lastCall('load')[4], 1);
});

test('explicitly disabled audio is not enabled during load', async () => {
    const f = fixture();
    await f.video.play(options('Transcode', { DefaultAudioStreamIndex: -1 }));
    assert.equal(f.lastCall('load')[4], -1);
});

test('embedded, external and disabled subtitles retain their native mapping', async () => {
    const f = fixture();
    await f.video.play(options('DirectPlay', { DefaultSubtitleStreamIndex: 6 }));
    assert.equal(f.lastCall('load')[5], 2);
    f.video.setSubtitleStreamIndex(2);
    assert.equal(f.lastCall('setSubtitleStream')[1], 1);
    f.video.setSubtitleStreamIndex(4);
    assert.equal(f.lastCall('setSubtitleStream')[1], '#,https://example.invalid/sub.srt');
    f.video.setSubtitleStreamIndex(-1);
    assert.equal(f.lastCall('setSubtitleStream')[1], -1);
});

test('pre-play track choices win once and do not leak into the next video', async () => {
    const f = fixture();
    f.video.setAudioStreamIndex(1);
    f.video.setSubtitleStreamIndex(6);
    await f.video.play(options());
    assert.equal(f.lastCall('load')[4], 1);
    assert.equal(f.lastCall('load')[5], 2);
    await f.video.stop(false);
    await f.video.play(options());
    assert.equal(f.lastCall('load')[4], 2);
    assert.equal(f.lastCall('load')[5], -1);
});

for (const cleanup of ['stop', 'destroy']) {
    test(`${cleanup} clears canceled pre-play track choices`, async () => {
        const f = fixture();
        f.video.setAudioStreamIndex(1);
        f.video.setSubtitleStreamIndex(6);
        await f.video[cleanup]();
        await f.video.play(options());
        assert.equal(f.lastCall('load')[4], 2);
        assert.equal(f.lastCall('load')[5], -1);
    });
}

test('explicit subtitle play options take precedence over the details-page fallback', async () => {
    const f = fixture();
    f.context.window.location.hash = `#!/details?id=${options().item.Id}`;
    f.selectors['.selectSubtitles'] = { value: '2', getClientRects: () => [{}] };
    await f.video.play({ ...options(), subtitleStreamIndex: '6' });
    assert.equal(f.lastCall('load')[5], 2);
});

test('subtitle selection from item.playOptions is preserved, including off', async () => {
    for (const value of ['6', '-1']) {
        const f = fixture();
        const opts = options('DirectPlay', { DefaultSubtitleStreamIndex: 2 });
        opts.item.playOptions = { subtitleStreamIndex: value };
        await f.video.play(opts);
        assert.equal(f.lastCall('load')[5], value === '6' ? 2 : -1);
    }
});

test('item subtitle selections belong to their media source, not a different version', async () => {
    for (const mediaSourceId of ['source-1', 'source-2']) {
        const f = fixture();
        const opts = options('DirectPlay', { DefaultSubtitleStreamIndex: 2 });
        opts.item.playOptions = { mediaSourceId, subtitleStreamIndex: 6 };
        await f.video.play(opts);
        assert.equal(f.lastCall('load')[5], mediaSourceId === 'source-1' ? 2 : 1);

        await f.video.play({ ...opts, subtitleStreamIndex: -1 });
        assert.equal(f.lastCall('load')[5], -1);
    }
});

for (const scenario of ['visible', 'hidden', 'other item', 'other source', 'invalid']) {
    test(`details-page subtitle fallback: ${scenario}`, async () => {
        const f = fixture();
        const id = scenario === 'other item' ? 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' : options().item.Id;
        f.context.window.location.hash = `#!/details?id=${id}`;
        f.selectors['.selectSubtitles'] = {
            value: scenario === 'invalid' ? '6-not-an-index' : '6',
            getClientRects: () => scenario === 'hidden' ? [] : [{}]
        };
        f.selectors['.selectSource'] = { value: scenario === 'other source' ? 'source-2' : 'source-1' };
        await f.video.play(options());
        assert.equal(f.lastCall('load')[5], scenario === 'visible' ? 2 : -1);
    });
}

test('a stream reload preserves subtitle delay and ignores stale details-page selection', async () => {
    const f = fixture();
    await f.video.play(options());
    f.video.setSubtitleOffset(1.5);
    f.video.enableShowingSubtitleOffset();
    f.context.window.location.hash = `#!/details?id=${options().item.Id}`;
    f.selectors['.selectSubtitles'] = { value: '6', getClientRects: () => [{}] };
    const delayCalls = f.calls.filter(call => call[0] === 'setSubtitleDelay').length;
    await f.video.play({ ...options(), resetSubtitleOffset: false });
    assert.equal(f.video.getSubtitleOffset(), 1.5);
    assert.equal(f.video.isShowingSubtitleOffsetEnabled(), true);
    assert.equal(f.lastCall('load')[5], -1);
    assert.equal(f.calls.filter(call => call[0] === 'setSubtitleDelay').length, delayCalls);
    await f.video.play(options());
    assert.equal(f.video.getSubtitleOffset(), 0);
    assert.equal(f.video.isShowingSubtitleOffsetEnabled(), false);
});

for (const kind of ['video', 'audio']) {
    test(`${kind}: restored volume is integral and zero survives playback restart`, async () => {
        for (const [saved, expected] of [[0, 0], [0.29, 29], [0.58, 58], [1, 100], ['0', 0],
            ['0.29', 29], [null, 100], ['', 100], ['invalid', 100], [NaN, 100], [Infinity, 100], [-1, 0], [2, 100]]) {
            const f = fixture(saved);
            const player = f[kind];
            assert.equal(player.getVolume(), expected, `initial volume for ${saved}`);
            await player.play(options());
            f.native.playing.emit();
            assert.equal(player.getVolume(), expected, `restored volume for ${saved}`);
            assert.equal(f.lastCall('setVolume')[1], expected);
            assert.equal(Number.isInteger(player.getVolume()), true);
        }
    });

    test(`${kind}: volume is rounded, clamped, persisted at zero and invalid values are ignored`, () => {
        const f = fixture();
        const player = f[kind];
        for (const [value, expected] of [[28.999999999999996, 29], ['41.7', 42], [101, 100], [-1, 0], [0, 0]]) {
            player.setVolume(value);
            assert.equal(player.getVolume(), expected);
            assert.equal(f.settings.get('volume'), expected / 100);
            assert.equal(f.lastCall('setVolume')[1], expected);
        }
        const callCount = f.calls.length;
        for (const value of [NaN, Infinity, -Infinity, 'bad', null, undefined, '']) player.setVolume(value);
        assert.equal(f.calls.length, callCount);
        assert.equal(player.getVolume(), 0);
        assert.equal(f.eventCount('volumechange'), 5);
    });

    test(`${kind}: a temporary volume change does not overwrite the saved volume`, () => {
        const f = fixture();
        f[kind].setVolume(29, false);
        assert.equal(f.settings.get('volume'), 0.5);
        assert.equal(f[kind].getVolume(), 29);
        assert.equal(f.eventCount('volumechange'), 0);
    });

    test(`${kind}: buffering emits one waiting event per transition`, async () => {
        const f = fixture();
        await f[kind].play(options());
        f.native.buffering.emit(10);
        f.native.buffering.emit(20);
        assert.equal(f.eventCount('waiting'), 1);
        f.native.playing.emit();
        f.native.buffering.emit(5);
        f.native.buffering.emit(15);
        assert.equal(f.eventCount('waiting'), 2);
        f.native.paused.emit();
        f.native.playing.emit();
        f.native.buffering.emit(10);
        assert.equal(f.eventCount('waiting'), 3);
        assert.equal(f.eventCount('unpause'), 1);
    });

    test(`${kind}: destroy removes every native signal and reconnection is not duplicated`, async () => {
        const f = fixture();
        for (let i = 0; i < 3; i++) {
            await f[kind].play(options());
            await f[kind].play(options());
            assert.equal(f.native.buffering.count, 1);
            assert.equal(f.native.playing.count, 1);
            f[kind].destroy();
            for (const name of f.signalNames) assert.equal(f.native[name].count, 0, name);
        }
        const count = f.emitted.length;
        f.native.buffering.emit(0);
        f.native.playing.emit();
        assert.equal(f.emitted.length, count);
    });

    test(`${kind}: a new item clears duration, position and buffered ranges`, async () => {
        const f = fixture();
        const player = f[kind];
        await player.play(options());
        f.native.updateDuration.emit(120000);
        f.native.positionUpdate.emit(50000);
        f.native.bufferedRangesUpdated.emit([{ start: 0, end: 60000 }]);
        assert.equal(player.duration(), 120000);
        assert.equal(player.currentTime(), 50000);
        await player.stop(false);
        f.native.buffering.emit(0);
        f.native.playing.emit();
        assert.equal(f.eventCount('waiting'), 0);
        assert.equal(f.eventCount('playing'), 0);
        await player.play(options());
        assert.equal(player.duration(), null);
        assert.equal(player.currentTime(), null);
        assert.equal(player.getBufferedRanges().length, 0);
    });

    test(`${kind}: playback start ticks remain correctly converted to milliseconds`, async () => {
        const f = fixture();
        await f[kind].play({ ...options(), playerStartPositionTicks: 123450000 });
        assert.equal(f.lastCall('load')[2].startMilliseconds, 12345);
    });
}
