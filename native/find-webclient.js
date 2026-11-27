let activeConnection = null;
let hasInteracted = false;
let connectionError = '';
let invalidAddress = false;
const connectionStrings = window.jmpConnectionStrings;

const updateButtonState = () => {
    const address = document.getElementById('address');
    const button = document.getElementById('connect-button');
    button.disabled = !!activeConnection || !address.value.trim();
};

const updateErrorUi = () => {
    const error = document.getElementById('connection-error');
    error.textContent = connectionError;
    error.hidden = !connectionError;
    document.getElementById('address').setAttribute('aria-invalid', invalidAddress ? 'true' : 'false');
};

const updateConnectionUi = () => {
    const connecting = !!activeConnection;
    const address = document.getElementById('address');
    const title = document.getElementById('title');
    const spinner = document.getElementById('spinner');
    const button = document.getElementById('connect-button');
    const cancel = document.getElementById('cancel-button');
    const status = document.getElementById('connection-status');

    title.textContent = title.getAttribute('data-original-text');
    title.style.visibility = 'visible';
    address.style.visibility = 'visible';
    address.hidden = connecting;
    address.disabled = connecting;
    spinner.style.display = connecting ? 'block' : 'none';
    button.style.visibility = 'visible';
    button.hidden = connecting;
    cancel.hidden = !connecting;
    status.textContent = connecting ? connectionStrings.connecting : '';
    status.hidden = !connecting;
    document.getElementById('connect-form').setAttribute('aria-busy', connecting ? 'true' : 'false');
    updateErrorUi();
    updateButtonState();
    if (connecting) cancel.focus();
    else address.focus();
};

const startConnecting = async () => {
    const address = document.getElementById('address');
    const input = address.value.trim();
    if (activeConnection || !input) return;

    hasInteracted = true;
    let server;
    try {
        const parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `http://${input}`);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            throw new Error('Invalid server address');
        }
        if (parsed.username || parsed.password) {
            connectionError = connectionStrings.credentials;
            invalidAddress = true;
            updateConnectionUi();
            return;
        }
        parsed.search = '';
        parsed.hash = '';
        server = parsed.href;
    } catch {
        connectionError = connectionStrings.invalidAddress;
        invalidAddress = true;
        updateConnectionUi();
        return;
    }

    const connection = {};
    activeConnection = connection;
    connectionError = '';
    invalidAddress = false;
    updateConnectionUi();

    try {
        // C++ handles retries; only the current attempt may save settings or navigate.
        const resolvedUrl = await window.jmpCheckServerConnectivity(server);
        if (activeConnection !== connection) return;
        window.jmpInfo.settings.main.userWebClient = server;
        window.location = resolvedUrl;
    } catch (error) {
        if (activeConnection !== connection) return;
        activeConnection = null;
        connectionError = Object.hasOwn(connectionStrings, error?.code) ? connectionStrings[error.code] : connectionStrings.failed;
        updateConnectionUi();
    }
};

const cancelConnection = () => {
    if (!activeConnection) return;

    console.log('Cancelling connection');
    activeConnection = null;
    window.jmpCheckServerConnectivity.abort();
    updateConnectionUi();
};

document.getElementById('cancel-button').addEventListener('click', cancelConnection);

// Button click handler
document.getElementById('connect-button').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!e.target.disabled) {
        startConnecting();
    }
});

// Form submit handler
document.getElementById('connect-form').addEventListener('submit', (e) => {
    e.preventDefault();
    startConnecting();
});

// Input change handler
document.getElementById('address').addEventListener('input', () => {
    hasInteracted = true;
    connectionError = '';
    invalidAddress = false;
    updateErrorUi();
    updateButtonState();
});

document.addEventListener('keydown', (e) => {
    const address = document.getElementById('address');
    if (e.key === 'Escape' && activeConnection) {
        e.preventDefault();
        cancelConnection();
    } else if (e.key === 'Enter' && !activeConnection && !address.disabled && address.value.trim()) {
        e.preventDefault();
        startConnecting();
    }
});

// Keep the form usable even if the native bridge takes time to start.
updateConnectionUi();

// Auto-connect on load
(async () => {
    try {
        await window.initCompleted;
    } catch {
        if (!hasInteracted) {
            connectionError = connectionStrings.unavailable;
            updateConnectionUi();
        }
        return;
    }

    // Startup must not overwrite manual input or revive an attempt cancelled with Esc.
    if (hasInteracted) {
        if (!activeConnection) updateConnectionUi();
        return;
    }

    const savedServer = window.jmpInfo.settings.main.userWebClient;
    if (typeof savedServer === 'string' && savedServer.trim()) {
        document.getElementById('address').value = savedServer;
        startConnecting();
    } else {
        updateConnectionUi();
    }
})();
