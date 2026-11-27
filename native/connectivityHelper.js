window.jmpCheckServerConnectivity = (() => {
    let activeCheck = null;
    let nextRequest = 0;
    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const connectivityError = (code, message) => Object.assign(new Error(message), { code });

    const checkFunc = function(url) {
        checkFunc.abort();

        return new Promise((resolve, reject) => {
            const requestId = `${sessionId}-${++nextRequest}`;
            let system = null;
            let handler = null;
            let timer = null;
            let settled = false;
            let attempts = 0;

            const finish = (error, resolvedUrl) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                if (handler) {
                    system.serverConnectivityResult.disconnect(handler);
                    handler = null;
                }
                if (activeCheck === check) activeCheck = null;
                if (error) reject(error);
                else resolve(resolvedUrl);
            };

            const check = {
                cancel() {
                    finish(connectivityError('cancelled', 'Connection cancelled'));
                    if (system) system.cancelServerConnectivity();
                }
            };
            // Register before waiting for WebChannel so Esc also cancels startup work.
            activeCheck = check;

            const start = () => {
                timer = null;
                if (settled) return;
                if (!window.api || !window.api.system) {
                    if (attempts++ < 50) timer = setTimeout(start, 100);
                    else finish(connectivityError('unavailable', 'WebChannel not available'));
                    return;
                }

                system = window.api.system;
                handler = (resultUrl, success, resolvedUrl, resultId) => {
                    if (resultUrl === url && resultId === requestId) {
                        finish(success ? null : connectivityError(resolvedUrl || 'failed', 'Connection failed'), resolvedUrl);
                    }
                };
                try {
                    system.serverConnectivityResult.connect(handler);
                    system.checkServerConnectivity(url, requestId);
                } catch (error) {
                    finish(error);
                }
            };
            start();
        });
    };

    checkFunc.abort = () => {
        if (activeCheck) activeCheck.cancel();
    };

    return checkFunc;
})();

window.jmpFetchPage = (() => {
    let fetchInProgress = false;

    return async function(url) {
        if (fetchInProgress) {
            throw new Error('Page fetch already in progress');
        }

        // Wait for API
        let attempts = 0;
        while (!window.api && attempts < 50) {
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
        }
        if (!window.api) {
            throw new Error('WebChannel not available');
        }

        fetchInProgress = true;

        return new Promise((resolve, reject) => {
            const handler = (html, finalUrl, hadCSP) => {
                window.api.system.pageContentReady.disconnect(handler);
                fetchInProgress = false;
                resolve({ html, finalUrl, hadCSP });
            };
            window.api.system.pageContentReady.connect(handler);
            window.api.system.fetchPageForCSPWorkaround(url);
        });
    };
})();
