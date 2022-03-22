/*
 * records Glean metrics into a ping and validates them according to the schema
 */

/* global telemetrySchema, settings */

// eslint-disable-next-line
class Metrics {

    constructor(submitCallback) {
        this._submitCallback = submitCallback;
        this._pings = {}
        this._enableLogging = settings.logTelemetry;
    }

    increment(category, name) {
        for (const pingName of this._getPings(category, name, "counter")) {
            let ping = this._build_ping(pingName);

            if (!("counter" in ping.metrics)) {
                ping.metrics.counter = {};
            }
            const key = `${category}.${name}`;
            if (key in ping.metrics.counter) {
                ping.metrics.counter[key] += 1;
            } else {
                ping.metrics.counter[key] = 1;
            }

            this._log(`counter ${pingName}.${category}.${name} = ${ping.metrics.counter[key]}`)
        }
    }

    event(category, name) {
        for (const pingName of this._getPings(category, name, "event")) {
            let ping = this._build_ping(pingName);

            const newTimestamp = window.performance.now();
            if (ping.firstEventTimestamp === null) {
                ping.firstEventTimestamp = newTimestamp;
            }
            let timeRelative = newTimestamp - ping.firstEventTimestamp;
            const newEvent = { category, name, timestamp: timeRelative };

            if (!("events" in ping)) {
                ping.events = []
            }
            ping.events.push(newEvent);
            this._log(`event ${pingName}.${category}.${name}, timestamp ${timeRelative}`)
        }
    }

    timespan(category, name, valMs) {
        if (typeof valMs !== "number") {
            throw new Error(`Telemetry: Timespan ${category}.${name} must be a number, value: ${valMs}`);
        }
        for (const pingName of this._getPings(category, name, "timespan")) {
            let ping = this._build_ping(pingName);
            if (!("timespan" in ping.metrics)) {
                ping.metrics.timespan = {};
            }
            ping.metrics.timespan[`${category}.${name}`] = {}
            ping.metrics.timespan[`${category}.${name}`].value = valMs;
            ping.metrics.timespan[`${category}.${name}`].time_unit = "millisecond";
            this._log(`timespan ${pingName}.${category}.${name} = ${valMs}`)
        }
    }

    quantity(category, name, val) {
        if (typeof val !== "number") {
            throw new Error(`Telemetry: Quantity ${category}.${name} must be a number, value: ${val}`)
        }
        if (val < 0) {
            throw new Error(`Telemetry: Quantity ${category}.${name} must be non-negative, value: ${val}`)
        }
        for (const pingName of this._getPings(category, name, "quantity")) {
            let ping = this._build_ping(pingName);
            if (!("quantity" in ping.metrics)) {
                ping.metrics.quantity = {};
            }
            ping.metrics.quantity[`${category}.${name}`] = val;
            this._log(`quantity ${pingName}.${category}.${name} = ${val}`)
        }
    }

    string(category, name, val) {
        if (typeof val !== "string") {
            throw new Error(`Telemetry: ${category}.${name} must be a string, value: ${val}`)
        }
        if (val.length > 100) {
            this._log(`warning: string ${category}.${name} is longer that 100 character will be truncated`);
        }
        for (const pingName of this._getPings(category, name, "string")) {
            let ping = this._build_ping(pingName);
            if (!("string" in ping.metrics)) {
                ping.metrics.string = {}
            }
            ping.metrics.string[`${category}.${name}`] = val;
            this._log(`string  ${pingName}.${category}.${name} = ${val}`)
        }
    }

    boolean(category, name, val) {
        if (typeof val !== "boolean") {
            throw new Error(`Telemetry: ${category}.${name} must be a boolean, value: ${val}`)
        }
        for (const pingName of this._getPings(category, name, "boolean")) {
            let ping = this._build_ping(pingName);
            if (!("boolean" in ping.metrics)) {
                ping.metrics.boolean = {}
            }
            ping.metrics.boolean[`${category}.${name}`] = val;
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
        this._submitCallback(pingName, ping);

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
            startTime: new Date().toISOString(),
            metrics: {}
        };
        this._pings[pingName] = ping;
        return ping;
    }

    _validatePing(pingName) {
        if (!telemetrySchema.pings.includes(pingName)) {
            throw new Error(`Telemetry: wrong ping name ${pingName}`)
        }
    }

    _log(...args) {
        if (!this._enableLogging) return;
        console.debug("Telemetry: ", ...args)
    }
}