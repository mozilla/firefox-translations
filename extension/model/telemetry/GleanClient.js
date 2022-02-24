/*
 * glean client implements basic metrics to replace glean.js
 */

/* global telemetrySchema */

const DELETION_REQUEST_PING = "deletion-request";

// eslint-disable-next-line
class GleanClient {

    constructor(uploadEnabled, debug, enableLogging) {
        this._telemetryId = "firefox-translations";
        this._uploadEnabled = uploadEnabled;
        this._debug = debug;
        this._enableLogging = enableLogging;

        this._browserEnv = null;
        this._pings = {}
        this._createdDatetime = new Date().toISOString();
    }

    setBrowserEnv(val) {
        this._browserEnv = val;
    }

    setUploadEnabled(val) {
        this._uploadEnabled = val;
        if (this._uploadEnabled) {
            this._log("uploading is enabled in preferences");
        } else {
            this._log("uploading is disabled in preferences");
        }
    }

    sendDeletionRequest() {
        this._build_ping(DELETION_REQUEST_PING);
        this.submit(DELETION_REQUEST_PING)
    }

    increment(category, name) {
        for (const pingName of this._getPings(category, name, "counter")) {
            let ping = this._build_ping(pingName);

            if (!("counter" in ping.data.metrics)) {
                ping.data.metrics.counter = {};
            }
            const key = `${category}.${name}`;
            if (key in ping.data.metrics.counter) {
                ping.data.metrics.counter[key] += 1;
            } else {
                ping.data.metrics.counter[key] = 1;
            }

            this._log(`counter ${pingName}.${category}.${name} = ${ping.data.metrics.counter[key]}`)
        }
    }

    event(category, name) {
        for (const pingName of this._getPings(category, name, "event")) {
            let ping = this._build_ping(pingName);

            const newTimestamp = Date.now();
            if (ping.firstEventTimestamp === null) {
                ping.firstEventTimestamp = newTimestamp;
            }
            let timeRelative = newTimestamp - ping.firstEventTimestamp;
            const newEvent = { category, name, timestamp: timeRelative };

            if (!("events" in ping.data)) {
                ping.data.events = []
            }
            ping.data.events.push(newEvent);
            this._log(`event ${pingName}.${category}.${name}, timestamp ${timeRelative}`)
        }
    }

    timespan(category, name, valMs) {
        if (typeof valMs !== "number") {
            throw new Error(`Telemetry: Timespan ${category}.${name} must be a number, value: ${valMs}`);
        }
        for (const pingName of this._getPings(category, name, "timespan")) {
            let ping = this._build_ping(pingName);
            if (!("timespan" in ping.data.metrics)) {
                ping.data.metrics.timespan = {};
            }
            ping.data.metrics.timespan[`${category}.${name}`] = {}
            ping.data.metrics.timespan[`${category}.${name}`].value = valMs;
            ping.data.metrics.timespan[`${category}.${name}`].time_unit = "millisecond";
            this._log(`timespan ${pingName}.${category}.${name} = ${valMs}`)
        }
    }

    quantity(category, name, val) {
        if (typeof val !== "number") {
            throw new Error(`Telemetry: Quantity ${category}.${name} must be a number, value: ${val}`)
        }
        for (const pingName of this._getPings(category, name, "quantity")) {
            let ping = this._build_ping(pingName);
            if (!("quantity" in ping.data.metrics)) {
                ping.data.metrics.quantity = {};
            }
            ping.data.metrics.quantity[`${category}.${name}`] = val;
            this._log(`quantity ${pingName}.${category}.${name} = ${val}`)
        }
    }

    string(category, name, val) {
        if (typeof val !== "string") {
            throw new Error(`Telemetry: ${category}.${name} must be a string, value: ${val}`)
        }
        for (const pingName of this._getPings(category, name, "string")) {
            let ping = this._build_ping(pingName);
            if (!("string" in ping.data.metrics)) {
                ping.data.metrics.string = {}
            }
            ping.data.metrics.string[`${category}.${name}`] = val;
            this._log(`string  ${pingName}.${category}.${name} = ${val}`)
        }
    }

    boolean(category, name, val) {
        if (typeof val !== "boolean") {
            throw new Error(`Telemetry: ${category}.${name} must be a boolean, value: ${val}`)
        }
        for (const pingName of this._getPings(category, name, "boolean")) {
            let ping = this._build_ping(pingName);
            if (!("boolean" in ping.data.metrics)) {
                ping.data.metrics.boolean = {}
            }
            ping.data.metrics.boolean[`${category}.${name}`] = val;
            this._log(`boolean  ${pingName}.${category}.${name} = ${val}`)
        }
    }

    // eslint-disable-next-line max-lines-per-function
    submit(pingName) {
        this._validatePing(pingName);
        if (!(pingName in this._pings)) {
            this._log(`ping ${pingName} is empty, skipping sending`);
            return;
        }

        let ping = this._pings[pingName];
        ping.data.ping_info.end_time = new Date().toISOString();
        if (this._browserEnv !== null) {
            ping.data.client_info.client_id = this._browserEnv.clientId;
            ping.data.client_info.os = GleanClient._osToGlean(this._browserEnv.os);
            ping.data.client_info.architecture = this._browserEnv.arch;
        } else {
            console.warn("Telemetry: environment info is not loaded")
        }
        const body = JSON.stringify(ping.data);
        this._log(`ping submitted '${pingName}':`, body);

        if (this._uploadEnabled) {
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
                headers["X-Debug-Id"] = "firefox-translations";
            }

            /*
             * we can skip retries to not overcomplicate things, assuming telemetry is not a critical
             * information and can be partially lost
             */
            fetch(`https://incoming.telemetry.mozilla.org/submit/${this._telemetryId}/${pingName}/1/${uuid}`, {
                method: "POST",
                headers,
                body
            }).then(res => {
                this._log("uploaded: ", body);
                this._log("request complete! response:", res);
            });
        } else {
            this._log("uploading is disabled, ping is not sent")
        }

        Reflect.deleteProperty(this._pings, pingName);
    }

    _getPings(category, name, type) {
        if (!(category in telemetrySchema.metrics)) {
            throw new Error(`metrics category ${category} is not present in the schema`)
        }
        if (!(name in telemetrySchema.metrics[category])) {
            throw new Error(`metric ${name} is not present in category ${category}`)
        }
        if (telemetrySchema.metrics[category][name].type !== type) {
            throw new Error(`wrong metric type ${type} for ${category}.${name}`)
        }
        return telemetrySchema.metrics[category][name].send_in_pings;
    }

    _build_ping(pingName) {
        this._validatePing(pingName);
        if (pingName in this._pings) {
            return this._pings[pingName];
        }

        let ping = {
            firstEventTimestamp: null,
            data: {
                metrics: {},
                ping_info: {
                    seq: 1,
                    start_time: new Date().toISOString(),
                    end_time: null
                },
                client_info: {
                    telemetry_sdk_build: "0.15.0",
                    first_run_date: this._createdDatetime,
                    os_version: "Unknown",
                    locale: navigator.language,
                    app_build: "Unknown",
                    app_display_version: "Unknown"
                }
            }
        };
        this._pings[pingName] = ping;
        return ping;
    }

    _validatePing(pingName) {
        if (!telemetrySchema.pings.includes(pingName) && pingName !== DELETION_REQUEST_PING) {
            throw new Error(`Telemetry: wrong ping name ${pingName}`)
        }
    }

    _log(...args) {
        if (!this._enableLogging) return;
        console.debug("Telemetry: ", ...args)
    }

    static _osToGlean(os) {
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