/*
 * class responsible for all telemetry and performance statistics related operations
 */

/* global GleanClient, settings */

// eslint-disable-next-line
class Telemetry {
    constructor() {
        this._client = new GleanClient(settings.uploadTelemetry, settings.sendDebugPing, settings.logTelemetry);
        this._totalWords = 0;
        this._totalEngineMs = 0;
        this._translationStartTimestamp = null;
        this._startTimestamp = null;
        this._otLenthPerTextArea = new Map();
    }

    translationStarted() {
        this._translationStartTimestamp = Date.now();
        this._updateUsageTime();
    }

    pageClosed() {
        this._client.submit("custom");
    }

    onUploadPrefChanged(val) {
        // settings override preferences
        if (!settings.uploadTelemetry) return;
        this._client.setUploadEnabled(val);
    }

    addAndGetTranslationTimeStamp(numWords, engineTimeElapsed) {
        this._totalWords += numWords;
        this._totalEngineMs += engineTimeElapsed;
        // it has to be int to use in telemetry
        const engineWps = Math.floor(this._totalWords / (this._totalEngineMs / 1000));
        const totalTimeMs = Date.now() - this._translationStartTimestamp;
        const totalWps = Math.floor(this._totalWords / (totalTimeMs / 1000));

        this._client.quantity("performance", "translation_engine_wps", engineWps)
        this._client.timespan("performance", "translation_engine_time", this._totalEngineMs)
        this._client.quantity("performance", "full_page_translated_wps", totalWps)
        this._client.timespan("performance", "full_page_translated_time", totalTimeMs)
        this._client.quantity("performance", "word_count", this._totalWords)
        this._updateUsageTime();

        return engineWps;
    }

    addOutboundTranslation(textArea, textToTranslate) {
        this._otLenthPerTextArea.set(textArea, {
                chars: textToTranslate.length,
                words: textToTranslate.trim().split(" ").length
            });
        let charLengthSum = 0;
        let wordLengthSum = 0;
        this._otLenthPerTextArea.forEach(v => {
            charLengthSum += v.chars;
            wordLengthSum += v.words;
        });
        this._client.quantity("forms", "character_count", charLengthSum)
        this._client.quantity("forms", "word_count", wordLengthSum)
        this._client.quantity("forms", "field_count", this._otLenthPerTextArea.size)
        this._updateUsageTime();
    }

    langPair(from, to) {
        this._client.string("metadata", "from_lang", from);
        this._client.string("metadata", "to_lang", to);
    }

    environment(env) {
        this._client.setBrowserEnv(env);

        this._client.quantity("metadata", "system_memory", env.systemMemoryMb);
        this._client.quantity("metadata", "cpu_count", env.systemCpuCount);
        this._client.quantity("metadata", "cpu_cores_count", env.systemCpuCores);
        this._client.quantity("metadata", "cpu_family", env.systemCpuFamily);
        this._client.quantity("metadata", "cpu_model", env.systemCpuModel);
        this._client.quantity("metadata", "cpu_stepping", env.systemCpuStepping);
        this._client.quantity("metadata", "cpu_l2_cache", env.systemCpuL2cacheKB);
        this._client.quantity("metadata", "cpu_l3_cache", env.systemCpuL3cacheKB);
        this._client.quantity("metadata", "cpu_speed", env.systemCpuSpeedMhz);

        this._client.string("metadata", "firefox_client_id", env.clientId);
        this._client.string("metadata", "cpu_vendor", env.systemCpuVendor);
        this._client.string("metadata", "cpu_extensions", env.systemCpuExtensions.join(","));
        this._client.string("metadata", "cpu_extensions", env.systemCpuExtensions.join(","));
    }

    versions(extensionVersion, extensionBuild, engineVersion) {
        this._client.string("metadata", "extension_version", extensionVersion.toString());
        this._client.string("metadata", "extension_build_id", extensionBuild);
        this._client.string("metadata", "bergamot_translator_version", engineVersion);
    }

    infobarEvent(name) {
        this._client.event("infobar", name);
        this._updateUsageTime();

        /* event corresponds to user action, but boolean value is useful to report the state and to filter */
        if (name === "outbound_checked") {
            this.infobarState("outbound_enabled", true);
        } else if (name === "outbound_unchecked") {
            this.infobarState("outbound_enabled", false);
        }
    }

    infobarState(name, val) {
        this._client.boolean("infobar", name, val);
    }

    formsEvent(name) {
        this._client.event("forms", name);
        this._updateUsageTime();
    }

    error(name) {
        this._client.increment("errors", name);
    }

    langMismatch() {
        this._client.increment("service", "lang_mismatch");
    }

    langNotSupported() {
        this._client.increment("service", "not_supported");
    }

    performanceTime(metric, timeMs) {
        this._client.timespan("performance", metric, timeMs);
    }

    wordsInViewport(val) {
        this._client.quantity("performance", "word_count_visible_in_viewport", val);
    }

    _updateUsageTime() {
        let timestamp = Date.now();
        if (this._startTimestamp === null) {
            this._startTimestamp = timestamp;
        }
        this._client.timespan("performance", "total_usage_time", timestamp - this._startTimestamp);
    }
}