(function() {
class updatePlugin {
    constructor({ confirm }) {
        this.name = 'Update Plugin';
        this.type = 'input';
        this.id = 'updatePlugin';

        (async () => {
            const api = await window.apiPromise;

            const onUpdateNotify = async (url) => {
                if (url == "SSL_UNAVAILABLE") {
                    // Windows (and possibly macOS) don't ship with SSL in QT......
                    // So we get to do a full request to GitHub here :(
                    const checkUrl = "https://github.com/jellyfin/jellyfin-desktop/releases/latest";
                    url = (await fetch(checkUrl)).url;
                }

                const urlSegments = url.split("/");
                const version = urlSegments[urlSegments.length - 1].substring(1);
                const currentVersion = jmpInfo.version;

                if (currentVersion.includes('pre')) return; // Do not notify for prereleases
                if (!/^[0-9.-]+$/.test(version)) return;

                // Compare numerically: currentVersion may carry a suffix such as
                // "2.0.0-dev", and /releases/latest still points at an older
                // stable release while 2.0 is a prerelease on GitHub.
                const parseVersion = (v) => v.split('.').map((p) => parseInt(p, 10) || 0);
                const current = parseVersion(currentVersion);
                const latest = parseVersion(version);
                let newer = false;
                for (let i = 0; i < Math.max(current.length, latest.length); i++) {
                    const a = latest[i] || 0;
                    const b = current[i] || 0;
                    if (a === b) continue;
                    newer = a > b;
                    break;
                }
                if (!newer) return;

                try {
                    // wait 3 seconds before showing the dialog to prevent race conditions
                    await new Promise(resolve => setTimeout(resolve, 3000));

                    await confirm({
                        title: "Update Available",
                        text: `Jellyfin Desktop version ${version} is available.`,
                        cancelText: "Ignore",
                        confirmText: "Download"
                    });

                    api.system.openExternalUrl(url);
                } catch (e) {
                    // User cancelled update
                }
            }

            api.system.updateInfoEmitted.connect(onUpdateNotify);
            api.system.checkForUpdates();
        })();
    }
}

window._updatePlugin = updatePlugin;
})();
