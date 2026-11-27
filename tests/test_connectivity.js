const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function signal() {
    const listeners = new Set();
    return {
        connect(callback) { listeners.add(callback); },
        disconnect(callback) { listeners.delete(callback); },
        emit(...args) { for (const callback of [...listeners]) callback(...args); },
        get count() { return listeners.size; }
    };
}

function eventTarget() {
    const listeners = new Map();
    return {
        addEventListener(name, callback) {
            if (!listeners.has(name)) listeners.set(name, new Set());
            listeners.get(name).add(callback);
        },
        removeEventListener(name, callback) { listeners.get(name)?.delete(callback); },
        dispatch(name, detail = {}) {
            const event = { target: this, preventDefault() {}, stopPropagation() {}, ...detail };
            for (const callback of [...listeners.get(name) || []]) callback(event);
        }
    };
}

async function flush() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

function fixture({ ready = true, page = false, savedServer = '', language = 'en-US' } = {}) {
    const timers = new Map();
    const calls = [];
    const navigations = [];
    let nextTimer = 0;
    let nativeCancels = 0;
    let makeReady;
    let rejectApi;
    const system = {
        serverConnectivityResult: signal(),
        checkServerConnectivity(url, requestId) { calls.push({ url, requestId }); },
        cancelServerConnectivity() { nativeCancels++; }
    };
    const elements = {};
    for (const id of ['address', 'title', 'spinner', 'connect-button', 'connect-form',
        'cancel-button', 'connection-status', 'connection-error']) {
        const classes = new Set();
        const attributes = new Map();
        elements[id] = {
            ...eventTarget(), value: '', disabled: false, hidden: false, style: {}, textContent: '', focused: false,
            classList: {
                add(name) { classes.add(name); }, remove(name) { classes.delete(name); },
                contains(name) { return classes.has(name); }
            },
            getAttribute(name) { return attributes.get(name) ?? null; },
            setAttribute(name, value) { attributes.set(name, String(value)); },
            focus() { this.focused = true; }
        };
        Object.defineProperty(elements[id], 'innerText', {
            get() { return this.textContent; }, set(value) { this.textContent = value; }
        });
    }
    const document = { ...eventTarget(), documentElement: {}, getElementById(id) { return elements[id]; } };
    const window = {
        apiPromise: new Promise((resolve, reject) => { makeReady = resolve; rejectApi = reject; }),
        jmpInfo: { settings: { main: { userWebClient: savedServer } } }
    };
    Object.defineProperty(window, 'location', {
        get() { return navigations.at(-1) || 'qrc:/find-webclient.html'; },
        set(url) { navigations.push(url); }
    });
    window.initCompleted = window.apiPromise;
    const context = vm.createContext({
        window, document, URL, AbortController, navigator: { language },
        console: { log() {}, debug() {}, warn() {}, error() {} },
        setTimeout(callback) { const id = ++nextTimer; timers.set(id, callback); return id; },
        clearTimeout(id) { timers.delete(id); }
    });
    for (const file of ['connectivityHelper.js', ...(page ? ['find-webclient.lang.js', 'find-webclient.js'] : [])]) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, '../native', file), 'utf8'), context, { filename: file });
    }
    const provideApi = () => { window.api = { system }; makeReady(); };
    if (ready) provideApi();
    return {
        window, system, calls, navigations, elements, document, timers, provideApi,
        failApi() { rejectApi(new Error('Bridge startup failed')); },
        get nativeCancels() { return nativeCancels; },
        async tick() {
            const callbacks = [...timers.values()];
            timers.clear();
            for (const callback of callbacks) callback();
            await flush();
        },
        result(index, success = true, resolvedUrl = 'https://resolved.test/web/') {
            const { url, requestId } = calls[index];
            system.serverConnectivityResult.emit(url, success, resolvedUrl, requestId);
        },
        enterAddress(value) { elements.address.value = value; elements.address.dispatch('input'); },
        clickConnect() { elements['connect-button'].dispatch('click'); },
        clickCancel() { elements['cancel-button'].dispatch('click'); },
        press(key) { document.dispatch('keydown', { key }); }
    };
}

test('connectivity: results for other requests are ignored and success cleans up', async () => {
    const f = fixture();
    const result = f.window.jmpCheckServerConnectivity('https://server.test/web/');
    f.system.serverConnectivityResult.emit('https://other.test/', true, 'https://other.test/web/', 'other');
    assert.equal(f.system.serverConnectivityResult.count, 1);
    f.result(0);
    assert.equal(await result, 'https://resolved.test/web/');
    assert.equal(f.system.serverConnectivityResult.count, 0);
    f.window.jmpCheckServerConnectivity.abort();
    assert.equal(f.nativeCancels, 0);
});

test('connectivity: failure releases the listener and permits another attempt', async () => {
    const f = fixture();
    const result = f.window.jmpCheckServerConnectivity('https://server.test/');
    const rejected = assert.rejects(result, /Connection failed/);
    f.result(0, false);
    await rejected;
    assert.equal(f.system.serverConnectivityResult.count, 0);
    const next = f.window.jmpCheckServerConnectivity('https://server.test/');
    f.result(1);
    await next;
});

test('connectivity: abort cancels native work and disconnects before a late result', async () => {
    const f = fixture();
    const result = f.window.jmpCheckServerConnectivity('https://server.test/');
    const rejected = assert.rejects(result, /Connection cancelled/);
    f.window.jmpCheckServerConnectivity.abort();
    f.result(0);
    await rejected;
    assert.equal(f.nativeCancels, 1);
    assert.equal(f.system.serverConnectivityResult.count, 0);
    f.window.jmpCheckServerConnectivity.abort();
    assert.equal(f.nativeCancels, 1);
});

test('connectivity: cancelling before WebChannel startup never starts a native request', async () => {
    const f = fixture({ ready: false });
    let outcome;
    f.window.jmpCheckServerConnectivity('https://server.test/').catch(error => { outcome = error.message; });
    f.window.jmpCheckServerConnectivity.abort();
    await flush();
    assert.equal(outcome, 'Connection cancelled');
    assert.equal(f.timers.size, 0);
    f.provideApi();
    await f.tick();
    assert.equal(f.calls.length, 0);
});

test('connectivity: only the newest request waits for WebChannel startup', async () => {
    const f = fixture({ ready: false });
    let previousOutcome;
    f.window.jmpCheckServerConnectivity('https://old.test/').catch(error => { previousOutcome = error.message; });
    const next = f.window.jmpCheckServerConnectivity('https://new.test/');
    f.provideApi();
    await f.tick();
    assert.equal(previousOutcome, 'Connection cancelled');
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, 'https://new.test/');
    f.result(0);
    await next;
});

test('connectivity: a queued result cannot finish a newer request to the same URL', async () => {
    const f = fixture();
    const previous = f.window.jmpCheckServerConnectivity('https://server.test/');
    const rejected = assert.rejects(previous, /Connection cancelled/);
    let resolved;
    const next = f.window.jmpCheckServerConnectivity('https://server.test/').then(url => { resolved = url; });
    await rejected;
    f.result(0, true, 'https://old.test/web/');
    await flush();
    assert.equal(resolved, undefined);
    assert.notEqual(f.calls[0].requestId, f.calls[1].requestId);
    f.result(1, true, 'https://new.test/web/');
    await next;
    assert.equal(resolved, 'https://new.test/web/');
});

test('connectivity: a missing WebChannel times out without leaving timers or listeners', async () => {
    const f = fixture({ ready: false });
    let outcome;
    f.window.jmpCheckServerConnectivity('https://server.test/').catch(error => { outcome = error.message; });
    for (let i = 0; i < 51; i++) await f.tick();
    assert.equal(outcome, 'WebChannel not available');
    assert.equal(f.timers.size, 0);
    f.provideApi();
    const next = f.window.jmpCheckServerConnectivity('https://server.test/');
    f.result(0);
    await next;
});

test('connectivity: a synchronous bridge error releases the signal listener', async () => {
    const f = fixture();
    f.system.checkServerConnectivity = () => { throw Error('Bridge disconnected'); };
    await assert.rejects(f.window.jmpCheckServerConnectivity('https://server.test/'), /Bridge disconnected/);
    assert.equal(f.system.serverConnectivityResult.count, 0);
});

test('connectivity: cancellation uses the API that started the request', async () => {
    const f = fixture();
    const result = f.window.jmpCheckServerConnectivity('https://server.test/');
    const rejected = assert.rejects(result, /Connection cancelled/);
    f.window.api = fixture().window.api;
    f.window.jmpCheckServerConnectivity.abort();
    await rejected;
    assert.equal(f.system.serverConnectivityResult.count, 0);
    assert.equal(f.nativeCancels, 1);
});

for (const [input, expected] of [
    ['https://server.test/base/web/?session=private#section', 'https://server.test/base/web/'],
    ['  server.test:8096  ', 'http://server.test:8096/'],
    ['HTTPS://server.test/jellyfin/web/', 'https://server.test/jellyfin/web/'],
    ['[::1]:8096', 'http://[::1]:8096/']
]) {
    test(`connection page: normalize ${input}`, async () => {
        const f = fixture({ page: true });
        await flush();
        f.enterAddress(input);
        f.clickConnect();
        assert.equal(f.calls.length, 1);
        assert.equal(f.calls[0].url, expected);
        f.result(0);
        await flush();
        assert.equal(f.window.jmpInfo.settings.main.userWebClient, expected);
        assert.deepEqual(f.navigations, ['https://resolved.test/web/']);
    });
}

test('connection page: repeated clicks and form submissions start only one request', async () => {
    const f = fixture({ page: true });
    await flush();
    f.enterAddress('server.test:8096');
    f.clickConnect();
    f.clickConnect();
    f.elements['connect-form'].dispatch('submit');
    f.press('Enter');
    assert.equal(f.calls.length, 1);
    assert.equal(f.elements['connect-button'].disabled, true);
    f.result(0);
    await flush();
});

test('connection page: cancelling a completed promise before navigation preserves the address', async () => {
    const f = fixture({ page: true });
    await flush();
    f.enterAddress('server.test:8096');
    f.clickConnect();
    f.result(0);
    f.press('Escape');
    await flush();
    assert.deepEqual(f.navigations, []);
    assert.equal(f.window.jmpInfo.settings.main.userWebClient, '');
    assert.equal(f.elements.address.disabled, false);
    assert.equal(f.elements.address.focused, true);
});

test('connection page: an old rejection does not reset the next connection UI', async () => {
    const f = fixture({ page: true });
    await flush();
    f.enterAddress('old.test:8096');
    f.clickConnect();
    f.press('Escape');
    f.enterAddress('new.test:8096');
    f.clickConnect();
    await flush();
    assert.equal(f.elements.address.disabled, true);
    assert.equal(f.elements.spinner.style.display, 'block');
    assert.equal(f.elements['connect-button'].disabled, true);
    f.result(1);
    await flush();
    assert.deepEqual(f.navigations, ['https://resolved.test/web/']);
});

test('connection page: cancelling before startup prevents saved-server auto-connect', async () => {
    const f = fixture({ page: true, ready: false, savedServer: 'https://saved.test/web/' });
    f.enterAddress('manual.test:8096');
    f.clickConnect();
    f.press('Escape');
    f.provideApi();
    await f.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.elements.address.value, 'manual.test:8096');
    assert.equal(f.elements.address.disabled, false);
    assert.deepEqual(f.navigations, []);
});

test('connection page: startup does not overwrite an address the user is typing', async () => {
    const f = fixture({ page: true, ready: false, savedServer: 'https://saved.test/web/' });
    f.enterAddress('manual.test:8096');
    f.provideApi();
    await flush();
    assert.equal(f.calls.length, 0);
    assert.equal(f.elements.address.value, 'manual.test:8096');
    assert.equal(f.elements.address.style.visibility, 'visible');
});

test('connection page: saved-server auto-connect can be cancelled and retried', async () => {
    const f = fixture({ page: true, savedServer: 'https://saved.test/web/' });
    await flush();
    assert.equal(f.calls[0].url, 'https://saved.test/web/');
    f.press('Escape');
    await flush();
    assert.equal(f.elements.address.value, 'https://saved.test/web/');
    assert.equal(f.elements.address.disabled, false);
    f.press('Enter');
    assert.equal(f.calls.length, 2);
    f.result(1);
    await flush();
    assert.deepEqual(f.navigations, ['https://resolved.test/web/']);
});

test('connection page: the form is available while the native bridge is starting', async () => {
    const f = fixture({ page: true, ready: false });
    assert.equal(f.elements.address.style.visibility, 'visible');
    assert.equal(f.elements.address.hidden, false);
    assert.equal(f.elements.address.disabled, false);
    assert.equal(f.elements['connect-button'].style.visibility, 'visible');
    assert.equal(f.elements['connect-button'].disabled, true);
    assert.equal(f.elements['cancel-button'].hidden, true);
    assert.equal(f.elements['connect-form'].getAttribute('aria-busy'), 'false');
    f.enterAddress('manual.test:8096');
    f.clickConnect();
    assert.equal(f.elements['cancel-button'].hidden, false);
    f.clickCancel();
    f.provideApi();
    await f.tick();
    assert.equal(f.calls.length, 0);
    assert.equal(f.elements.address.hidden, false);
    assert.equal(f.elements.address.disabled, false);
});

test('connection page: clicking Cancel stops the request and permits an immediate retry', async () => {
    const f = fixture({ page: true, savedServer: 'https://saved.test/web/' });
    await flush();
    assert.equal(f.elements['cancel-button'].hidden, false);
    assert.equal(f.elements['cancel-button'].textContent, 'Cancel');
    assert.equal(f.elements['cancel-button'].focused, true);
    assert.equal(f.elements['connection-status'].hidden, false);
    assert.equal(f.elements['connect-form'].getAttribute('aria-busy'), 'true');
    f.clickCancel();
    f.press('Enter');
    await flush();
    assert.equal(f.calls.length, 2);
    assert.equal(f.nativeCancels, 1);
    assert.equal(f.elements.address.disabled, true);
    assert.equal(f.elements['cancel-button'].hidden, false);
    assert.equal(f.elements['connection-error'].hidden, true);
    f.result(0);
    await flush();
    assert.deepEqual(f.navigations, []);
    f.result(1);
    await flush();
    assert.deepEqual(f.navigations, ['https://resolved.test/web/']);
});

test('connection page: invalid input has a visible localized error that clears on editing', async () => {
    const f = fixture({ page: true, language: 'zh-CN' });
    await flush();
    f.enterAddress('ftp://server.test/');
    f.clickConnect();
    await flush();
    assert.equal(f.calls.length, 0);
    assert.equal(f.elements['connection-error'].hidden, false);
    assert.match(f.elements['connection-error'].textContent, /HTTP.*HTTPS/);
    assert.match(f.elements['connection-error'].textContent, /地址/);
    assert.equal(f.elements.address.getAttribute('aria-invalid'), 'true');
    assert.equal(f.elements.address.focused, true);
    f.enterAddress('server.test:8096');
    assert.equal(f.elements['connection-error'].hidden, true);
    assert.equal(f.elements.address.getAttribute('aria-invalid'), 'false');
    f.clickConnect();
    assert.equal(f.elements['cancel-button'].textContent, '取消');
    assert.match(f.elements['connection-status'].textContent, /连接/);
    f.result(0);
    await flush();
});

test('connection page: a failed check restores the form with a server error and allows retry', async () => {
    const f = fixture({ page: true });
    await flush();
    f.enterAddress('server.test:8096');
    f.clickConnect();
    f.result(0, false);
    await flush();
    assert.equal(f.elements.address.disabled, false);
    assert.equal(f.elements['cancel-button'].hidden, true);
    assert.equal(f.elements['connection-status'].hidden, true);
    assert.equal(f.elements['connect-form'].getAttribute('aria-busy'), 'false');
    assert.equal(f.elements['connection-error'].hidden, false);
    assert.match(f.elements['connection-error'].textContent, /connect/i);
    assert.equal(f.elements.address.getAttribute('aria-invalid'), 'false');
    f.clickConnect();
    assert.equal(f.elements['connection-error'].hidden, true);
    f.result(1);
    await flush();
    assert.equal(f.navigations.length, 1);
});

test('connection page: a bridge startup failure leaves the form usable without auto-connecting', async () => {
    const f = fixture({ page: true, ready: false, savedServer: 'https://saved.test/web/', language: 'zh-CN' });
    f.failApi();
    await flush();
    assert.equal(f.elements['connection-error'].hidden, false);
    assert.match(f.elements['connection-error'].textContent, /就绪/);
    assert.equal(f.elements.address.disabled, false);
    assert.equal(f.elements.address.style.visibility, 'visible');
    assert.equal(f.calls.length, 0);
    assert.equal(f.timers.size, 0);
    assert.equal(f.elements.address.value, '');
});

test('connection page: a readiness timeout restores the form and a later bridge can connect', async () => {
    const f = fixture({ page: true, ready: false });
    f.enterAddress('server.test:8096');
    f.clickConnect();
    for (let i = 0; i < 51; i++) await f.tick();
    assert.equal(f.elements['connection-error'].hidden, false);
    assert.match(f.elements['connection-error'].textContent, /ready/i);
    assert.equal(f.elements.address.disabled, false);
    assert.equal(f.elements['cancel-button'].hidden, true);
    f.provideApi();
    await flush();
    assert.equal(f.calls.length, 0);
    f.clickConnect();
    f.result(0);
    await flush();
    assert.equal(f.navigations.length, 1);
});

for (const [language, expectedLanguage, connectText] of [
    ['zh', 'zh-cn', '连接'],
    ['zh-Hans-CN', 'zh-cn', '连接'],
    ['zh_Hans_CN', 'zh-cn', '连接'],
    ['zh-Hant-TW', 'zh-tw', '連線'],
    ['zh-Hant-HK', 'zh-hk', '連接']
]) {
    test(`connection page: ${language} uses Chinese labels and messages`, async () => {
        const f = fixture({ page: true, language });
        await flush();
        assert.equal(f.document.documentElement.lang, expectedLanguage);
        assert.equal(f.elements['connect-button'].textContent, connectText);
        assert.equal(f.elements['cancel-button'].textContent, '取消');
        f.enterAddress('ftp://server.test/');
        f.clickConnect();
        assert.equal(f.elements['connection-error'].hidden, false);
        assert.match(f.elements['connection-error'].textContent, /HTTP.*HTTPS/);
        assert.match(f.elements['connection-error'].textContent, /请|請/);
        assert.equal(f.calls.length, 0);
    });
}

for (const input of ['', '   ', 'ftp://server.test/', 'http://[::1', 'http://server.test:99999/', 'https://user:pass@server.test/web/']) {
    test(`connection page: invalid address ${JSON.stringify(input)} does not start a request`, async () => {
        const f = fixture({ page: true });
        await flush();
        f.enterAddress(input);
        f.elements['connect-form'].dispatch('submit');
        await flush();
        assert.equal(f.calls.length, 0);
        assert.equal(f.elements.address.disabled, false);
        assert.deepEqual(f.navigations, []);
    });
}

for (const [code, expected] of [['timedOut', /60 秒/], ['invalidResponse', /Jellyfin/], ['tlsError', /证书/], ['networkError', /网络/]]) {
    test(`connection page: ${code} restores focus with a localized reason`, async () => {
        const client = fixture({ page: true, language: 'zh-CN' });
        await flush();
        client.enterAddress('server.test');
        client.clickConnect();
        client.result(0, false, code);
        await flush();
        assert.match(client.elements['connection-error'].textContent, expected);
        assert.equal(client.elements.address.disabled, false);
    });
}
