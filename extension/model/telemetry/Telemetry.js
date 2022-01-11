/*
 * class responsible for all telemetry and performance statistics related operations
 */

class TranslationTelemetry {
    constructor(telemetry) {
        this._telemetry = telemetry;
        this._totalWords = 0;
        this._totalMs = 0;
    }

    get totalWords() {
        return this._totalWords;
    }

    get totalSeconds() {
        return this._totalMs / 1000;
    }

    addAndGetTranslationTimeStamp(numWords, timeElapsed) {
        this._totalWords += numWords;
        this._totalMs += timeElapsed;

        const wps = Math.round(this._totalWords / this.totalSeconds * 100) / 100;

        this._telemetry.quantity("performance", "full_page_translated_wps", wps)
        this._telemetry.timespan("performance", "full_page_translated_time", this._totalMs)
        this._telemetry.quantity("performance", "word_count", this._totalWords)
    }
}

let metricsSchema = null;
let pingsSchema = null;

//todo: use other yaml parser?
fetch(browser.runtime.getURL("model/telemetry/pings.yaml"), { mode: "no-cors" })
  .then(response => response.text())
  .then(text => pingsSchema = jsyaml.load(text));
fetch(browser.runtime.getURL("model/telemetry/metrics.yaml"), { mode: "no-cors" })
  .then(response => response.text())
  .then(text => metricsSchema = jsyaml.load(text));


class Telemetry {

    constructor(sendPings= false, debug= true) {
        this._telemetryId = "org-mozilla-bergamot";
        this._sendPings = sendPings;
        this._debug = debug;

        this._telemetryInfo = null;
        this._langFrom = null;
        this._langTo = null;
        this._pings = {}
    }

    set telemetryInfo(val) {
        this._telemetryInfo = val;
    }

    set langFrom(val) {
        this._langFrom = val;
    }

    set langTo(val) {
        this._langTo = val;
    }

    increment(category, name) {
        for (const pingName of this._getPings(category, name, "counter")) {
            let ping = this._build_ping(pingName);

            if (!("counter" in ping.data.metrics))
                ping.data.metrics.counter = {}

            const key = `${category}.${name}`;
            if (key in ping.data.metrics.counter)
                ping.data.metrics.counter[key] += 1;
            else
                ping.data.metrics.counter[key] = 1;

            console.debug(`Telemetry: counter metric ${category}.${name} recorded in ping ${pingName}: `, ping)
        }
    }

    event(category, name) {
        for (const pingName of this._getPings(category, name, "event")) {
            let ping = this._build_ping(pingName);

            const newTimestamp = Date.now();
            let timestamp = 0;
            if (ping.lastEventTimestamp !== 0)
                timestamp = newTimestamp - ping.lastEventTimestamp;
            ping.lastEventTimestamp = newTimestamp
            const index = ping.eventsIndex.toString();
            ping.eventsIndex += 1;

            if (!("events" in ping.data))
                ping.data.events = {}

            ping.data.events[index] = {}
            ping.data.events[index].category = category;
            ping.data.events[index].name = name;
            ping.data.events[index].timestamp = timestamp;
            console.debug(`Telemetry: event metric ${category}.${name} recorded in ping ${pingName}: `, ping)
        }
    }

    timespan(category, name, valMs) {
        if (typeof valMs != 'number')
            throw new Error(`Telemetry: Timespan ${category}.${name} must be a number, value: ${valMs}`)

        for (const pingName of this._getPings(category, name, "timespan")) {
            let ping = this._build_ping(pingName);
            if (!("timespan" in ping.data.metrics))
                ping.data.metrics.timespan = {}
            ping.data.metrics.timespan[`${category}.${name}.value`] = valMs;
            ping.data.metrics.timespan[`${category}.${name}.time_unit`] = "millisecond";
            console.debug(`Telemetry: timespan metric ${category}.${name} recorded in ping ${pingName}: `, ping)
        }
    }

    quantity(category, name, val) {
        if (typeof val != 'number')
            throw new Error(`Telemetry: Quantity ${category}.${name} must be a number, value: ${val}`)

        for (const pingName of this._getPings(category, name, "quantity")) {
            let ping = this._build_ping(pingName);
            ping.data.metrics.quantity[`${category}.${name}`] = val;
            console.debug(`Telemetry: quantity metric ${category}.${name} recorded in ping ${pingName}: `, ping)
        }
    }

    string(category, name, val) {
        if (typeof val != 'string')
            throw new Error(`Telemetry: Suantity ${category}.${name} must be a string, value: ${val}`)

        for (const pingName of this._getPings(category, name, "string")) {
            let ping = this._build_ping(pingName);
            ping.data.metrics.string[`${category}.${name}`] = val;
            console.debug(`Telemetry: string metric ${category}.${name} recorded in ping ${pingName}: `, ping)
        }
    }

    submit(pingName) {
        if (!(pingName in pingsSchema))
            throw new Error(`wrong ping name ${pingName}`)

        if (!(pingName in this._pings)) {
            console.debug(`ping ${pingName} is empty, skipping sending`);
            return;
        }

        let ping = this._pings[pingName];
        ping.data.ping_info.end_time = new Date().toISOString();
        const body = JSON.stringify(ping.data);
        console.debug(`Telemetry: ping submitted '${pingName}':`, ping.data);

        if (this._sendPings) {
            let uuid = self.crypto.randomUUID();
            let headers = {
                    "Content-Type": "application/json; charset=utf-8",
                    "Date": new Date().toISOString()
                };
            if (this._debug)
                headers["X-Debug-Id"] = "bergamot";
            // we can skip retries to not overcomplicate things, assuming telemetry is not a critical
            // information and can be partially lost
            fetch(`https://incoming.telemetry.mozilla.org/submit/${this._telemetryId}/${ping}/1/${uuid}`, {
                method: "POST",
                headers: headers,
                body: body
            }).then(res => {
                console.debug("Telemetry sent:", body);
                console.debug("Request complete! response:", res);
            });
        }
        delete this._pings[pingName];
    }

    _getPings(category, name, type) {
        if (!(category in metricsSchema))
            throw new Error(`metrics category ${category} is not present in the schema`)
        if (!(name in metricsSchema[category]))
            throw new Error(`metric ${name} is not present in category ${category}`)
        if (metricsSchema[category][name].type !== type)
            throw new Error(`wrong metric type ${type} for ${category}.${name}`)
        return  metricsSchema[category][name].send_in_pings;
    }

    _build_ping(pingName) {
        if (!(pingName in pingsSchema))
            throw new Error(`wrong ping name ${pingName}`)
        if (pingName in this._pings)
            return this._pings[pingName];
        // todo: check for each metadata whether it should be in the ping to follow the schema
        const now = new Date().toISOString();
        let ping = {
            lastEventTimestamp: 0,
            eventsIndex: 0,
            data: {
                metrics: {
                    string: {
                        "metadata.firefox_client_id": this._telemetryInfo.clientId,
                        "metadata.extension_version": "0.5",
                        "metadata.extension_build_id": "v0.5",
                        "metadata.bergamot_translator_version": "?",
                        "metadata.cpu_vendor": this._telemetryInfo.systemCpuVendor,
                        "metadata.cpu_extensions": this._telemetryInfo.systemCpuExtensions.join(","),
                        "metadata.from_lang": this._langFrom,
                        "metadata.to_lang": this._langTo
                    },
                    quantity: {
                        "metadata.system_memory": this._telemetryInfo.systemMemoryMb,
                        "metadata.cpu_count": this._telemetryInfo.systemCpuCount,
                        "metadata.cpu_cores_count": this._telemetryInfo.systemCpuCores,
                        "metadata.cpu_family": this._telemetryInfo.systemCpuFamily,
                        "metadata.cpu_model": this._telemetryInfo.systemCpuModel,
                        "metadata.cpu_stepping": this._telemetryInfo.systemCpuStepping,
                        "metadata.cpu_l2_cache": this._telemetryInfo.systemCpuL2cacheKB,
                        "metadata.cpu_l3_cache": this._telemetryInfo.systemCpuL3cacheKB,
                        "metadata.cpu_speed": this._telemetryInfo.systemCpuSpeedMhz
                    }
                },
                ping_info: {
                    seq: 1,
                    start_time: now,
                    end_time: null
                },
                client_info: {
                    telemetry_sdk_build: "0.15.0",
                    client_id: this._telemetryInfo.clientId,
                    first_run_date: now,
                    os: Telemetry._osToGlean(this._telemetryInfo.os),
                    os_version: "Unknown",
                    architecture: this._telemetryInfo.arch,
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
        switch(os) {
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