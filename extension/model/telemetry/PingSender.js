/*
 * sends telemetry pings to telemetry API
 */

/* global settings, browser */

const DELETION_REQUEST_PING = "deletion-request";
const TELEMETRY_APP_ID = "firefox-translations";
const STORAGE_CLIENT_ID = "ftTelemetry_clientId";
const STORAGE_SEQ = "ftTelemetry_seq";
const STORAGE_FIRST_RUN = "ftTelemetry_firstRunDate";
const TELEMETRY_API = "incoming.telemetry.mozilla.org";

// eslint-disable-next-line no-unused-vars
class PingSender {
    constructor() {
        this._uploadEnabled = settings.uploadTelemetry;
        this._debug = settings.sendDebugPing;
        this._enableLogging = settings.logTelemetry;
        this._clientId = null;
        this._seq = null;
        this._firstRunDate = null;
        this._browserEnv = null;
        this._initialized = false;
        this._load().catch(e => this._log(`initialization failed: ${e}`));
    }

    async _load() {
        this._log("started loading")
        let state = await browser.storage.local.get();
        this._log("state loaded", state);

        if (STORAGE_CLIENT_ID in state) {
            this._clientId = state[STORAGE_CLIENT_ID];
            this._seq = state[STORAGE_SEQ];
            this._firstRunDate = state[STORAGE_FIRST_RUN];
        } else {
            // this information is generated once for a user
            this._clientId = self.crypto.randomUUID();
            this._seq = {};
            this._firstRunDate = new Date().toISOString()
            await this._save();
        }

        const platformInfo = await browser.runtime.getPlatformInfo();
        this._browserEnv = {
            os: platformInfo.os,
            arch: platformInfo.arch
        };

        await this._loadUploadPref();
        browser.experiments.telemetryPreferences.onUploadEnabledPrefChange.addListener(async () => {
            await this._loadUploadPref();
        });

        this._isInitialized = true;
        this._log("initialized");
    }

    async _loadUploadPref() {
        let uploadEnabled = await browser.experiments.telemetryPreferences.getUploadEnabledPref();
        this._log(`upload pref loaded: ${uploadEnabled}`)
        await this._setUploadEnabled(uploadEnabled);
    }

    async _save() {
        let state = {};
        state[STORAGE_CLIENT_ID] = this._clientId;
        state[STORAGE_SEQ] = this._seq;
        state[STORAGE_FIRST_RUN] = this._firstRunDate;

        await browser.storage.local.set(state);
        this._log("state saved", state);
    }

    async _setUploadEnabled(val) {
        // ignore preferences if uploading is disabled in settings
        if (!settings.uploadTelemetry) return;

        if (!val) {
            await this.submit(DELETION_REQUEST_PING, {})
        }

        this._uploadEnabled = val;
        if (this._uploadEnabled) {
            this._log("uploading is enabled in preferences");
        } else {
            this._log("uploading is disabled in preferences");
        }
    }

    async submit(pingName, data) {
        let waitAndSend = async () => {
            if (!this._isInitialized) {
                this._log("waiting for initialization...")
                setTimeout(waitAndSend, 10000);
                return;
            }

            let ping = await this._build_ping(pingName, data);
            const body = JSON.stringify(ping);
            this._log(`ping submitted '${pingName}':`, body);

            if (!this._uploadEnabled && pingName !== DELETION_REQUEST_PING) {
                this._log("uploading is disabled, ping is not sent")
            } else {
                let uuid = self.crypto.randomUUID();
                // we imitate behavior of glean.js 0.15.0
                let headers = {
                    "Content-Type": "application/json; charset=utf-8",
                    "Date": new Date().toISOString(),
                    "X-Client-Type": "Glean.js",
                    "X-Client-Version": "0.15.0",
                    "X-Telemetry-Agent": "Glean/0.15.0"
                };
                if (this._debug) {
                    headers["X-Debug-Id"] = TELEMETRY_APP_ID;
                }
                this._log(`sending ping ${pingName}`);
                await this._upload(pingName, uuid, headers, body);
            }
        };
        await waitAndSend();
    }

    async _build_ping(pingName, data) {
        let ping = {
            ping_info: {
                seq: await this._increment(pingName),
                end_time: new Date().toISOString()
            },
            client_info: {
                telemetry_sdk_build: "0.15.0",
                first_run_date: this._firstRunDate,
                os_version: "Unknown",
                locale: navigator.language,
                app_build: "Unknown",
                app_display_version: "Unknown",
                client_id: this._clientId,
                os: this._osToGlean(this._browserEnv.os),
                architecture: this._browserEnv.arch
            }
        }
        if ("events" in data) ping.events = data.events;
        if ("metrics" in data) ping.metrics = data.metrics;
        if ("startTime" in data) {
            ping.ping_info.start_time = data.startTime;
        } else {
            ping.ping_info.start_time = ping.ping_info.end_time;
        }

        return ping;
    }

    async _increment(pingName) {
        if (!(pingName in this._seq)) {
            this._seq[pingName] = 0;
        }
        this._seq[pingName] += 1;
        await browser.storage.local.set({ [STORAGE_SEQ]: this._seq });
        return this._seq[pingName];
    }

    async _upload(pingName, uuid, headers, body) {
        let retries = 3;
        while (retries >= 0) {
            try {
                const url = `https://${TELEMETRY_API}/submit/${TELEMETRY_APP_ID}/${pingName}/${this._seq[pingName]}/${uuid}`;
                // eslint-disable-next-line no-await-in-loop
                let res = await fetch(url, {
                    method: "POST",
                    headers,
                    body
                });
                this._log("request complete! response:", res);
                return;
            } catch (e) {
                if (retries === 0) {
                    console.error(`Telemetry: retries exceeded, uploading failed: ${e}`);
                    throw e;
                } else {
                    this._log(`error on uploading, retrying: ${e}`);
                }
            }
            retries -= 1;
            // eslint-disable-next-line no-await-in-loop
            await new Promise(resolve => setTimeout(resolve, 30000));
        }
    }

    _log(...args) {
        if (!this._enableLogging) return;
        console.debug("Telemetry: ", ...args)
    }

    _osToGlean(os) {
        switch (os) {
            case "mac":
                return "Darwin";
            case "win":
                return "Windows";
            case "android":
                return "Android";
            case "cros":
                return "ChromeOS";
            case "linux":
                return "Linux";
            case "openbsd":
                return "OpenBSD";
            default:
                return "Unknown";
        }
    }

}