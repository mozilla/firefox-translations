/*
 * class responsible for all telemetry and performance statistics related operations
 */

/* global telemetrySchema */

// eslint-disable-next-line
class TranslationTelemetry {
    constructor(telemetry) {
        this._telemetry = telemetry;
        this._totalWords = 0;
        this._totalEngineMs = 0;
        this._startTimestamp = null;
    }

    translationStarted() {
        this._startTimestamp = Date.now();
    }

    addAndGetTranslationTimeStamp(numWords, engineTimeElapsed) {
        this._totalWords += numWords;
        this._totalEngineMs += engineTimeElapsed;
        // it has to be int to use in telemetry
        const engineWps = Math.floor(this._totalWords / (this._totalEngineMs / 1000));
        const totalTimeMs = Date.now() - this._startTimestamp;
        const totalWps = Math.floor(this._totalWords / (totalTimeMs / 1000));

        this._telemetry.quantity("performance", "translation_engine_wps", engineWps)
        this._telemetry.timespan("performance", "translation_engine_time", this._totalEngineMs)
        this._telemetry.quantity("performance", "full_page_translated_wps", totalWps)
        this._telemetry.timespan("performance", "full_page_translated_time", totalTimeMs)
        this._telemetry.quantity("performance", "word_count", this._totalWords)

        return engineWps;
    }

    recordLangPair(from, to) {
        this._telemetry.string("metadata", "from_lang", from);
        this._telemetry.string("metadata", "to_lang", to);
    }

    recordEnvironment(env) {
        this._telemetry.quantity("metadata", "system_memory", env.systemMemoryMb);
        this._telemetry.quantity("metadata", "cpu_count", env.systemCpuCount);
        this._telemetry.quantity("metadata", "cpu_cores_count", env.systemCpuCores);
        this._telemetry.quantity("metadata", "cpu_family", env.systemCpuFamily);
        this._telemetry.quantity("metadata", "cpu_model", env.systemCpuModel);
        this._telemetry.quantity("metadata", "cpu_stepping", env.systemCpuStepping);
        this._telemetry.quantity("metadata", "cpu_l2_cache", env.systemCpuL2cacheKB);
        this._telemetry.quantity("metadata", "cpu_l3_cache", env.systemCpuL3cacheKB);
        this._telemetry.quantity("metadata", "cpu_speed", env.systemCpuSpeedMhz);

        this._telemetry.string("metadata", "firefox_client_id", env.clientId);
        this._telemetry.string("metadata", "cpu_vendor", env.systemCpuVendor);
        this._telemetry.string("metadata", "cpu_extensions", env.systemCpuExtensions.join(","));
        this._telemetry.string("metadata", "cpu_extensions", env.systemCpuExtensions.join(","));
    }

    recordVersions(extensionVersion, extensionBuild, engineVersion) {
        this._telemetry.string("metadata", "extension_version", extensionVersion.toString());
        this._telemetry.string("metadata", "extension_build_id", extensionBuild);
        this._telemetry.string("metadata", "bergamot_translator_version", engineVersion);
    }
}

// eslint-disable-next-line
class Telemetry {

    constructor(sendPings= false, debug= true) {
        this._telemetryId = "org-mozilla-bergamot";
        this._sendPings = sendPings;
        this._debug = debug;

        this._browserEnv = null;
        this._pings = {}
        this._createdDatetime = new Date().toISOString();
    }

    setBrowserEnv(val) {
        this._browserEnv = val;
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
            console.debug(`Telemetry: counter metric ${category}.${name} recorded in ping ${pingName}: `, ping)
        }
    }

    event(category, name) {
        for (const pingName of this._getPings(category, name, "event")) {
            let ping = this._build_ping(pingName);

            const newTimestamp = Date.now();
            let timestamp = 0;
            if (ping.lastEventTimestamp !== 0) {
                timestamp = newTimestamp - ping.lastEventTimestamp;
            }
            ping.lastEventTimestamp = newTimestamp;
            const newEvent = { category, name, timestamp };

            if (!("events" in ping.data)) {
                ping.data.events = []
            }
            ping.data.events.push(newEvent);
            console.debug(`Telemetry: event metric ${category}.${name} recorded in ping ${pingName}: `, ping)
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
            console.debug(`Telemetry: timespan metric ${category}.${name} recorded in ping ${pingName}: `, ping)
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
            console.debug(`Telemetry: quantity metric ${category}.${name} recorded in ping ${pingName}: `, ping)
        }
    }

    string(category, name, val) {
        if (typeof val !== "string") {
            throw new Error(`Telemetry: Suantity ${category}.${name} must be a string, value: ${val}`)
        }
        for (const pingName of this._getPings(category, name, "string")) {
            let ping = this._build_ping(pingName);
            if (!("string" in ping.data.metrics)) {
                ping.data.metrics.string = {}
            }
            ping.data.metrics.string[`${category}.${name}`] = val;
            console.debug(`Telemetry: string metric ${category}.${name} recorded in ping ${pingName}: `, ping)
        }
    }

    // eslint-disable-next-line max-lines-per-function
    submit(pingName) {
        if (!telemetrySchema.pings.includes(pingName)) {
            throw new Error(`Telemetry: wrong ping name ${pingName}`)
        }
        if (!(pingName in this._pings)) {
            console.debug(`Telemetry: ping ${pingName} is empty, skipping sending`);
            return;
        }

        let ping = this._pings[pingName];
        ping.data.ping_info.end_time = new Date().toISOString();
        if (this._browserEnv !== null) {
            ping.data.client_info.client_id = this._browserEnv.clientId;
            ping.data.client_info.os = Telemetry._osToGlean(this._browserEnv.os);
            ping.data.client_info.architecture = this._browserEnv.arch;
        } else {
            console.warn("Telemetry: environment info is not loaded")
        }
        const body = JSON.stringify(ping.data);
        console.debug(`Telemetry: ping submitted '${pingName}':`, body);

        if (this._sendPings) {
            let uuid = self.crypto.randomUUID();
            // we imitate behavior of glean.js 0.15.0
            let headers = {
                "Content-Type": "application/json; charset=utf-8",
                "Date": new Date().toISOString(),
                "X-Client-Type": "Glean.js",
                "X-Client-Version": "0.15.0",
                "X-Telemetry-Agent": `Glean/0.15.0 (JS on ${this._browserEnv.os})`
            };
            if (this._debug) {
                headers["X-Debug-Id"] = "bergamot";
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
                console.debug("Telemetry sent:", body);
                console.debug("Telemetry: Request complete! response:", res);
            });
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
        if (!telemetrySchema.pings.includes(pingName)) {
            throw new Error(`wrong ping name ${pingName}`)
        }
        if (pingName in this._pings) {
            return this._pings[pingName];
        }

        let ping = {
            lastEventTimestamp: 0,
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