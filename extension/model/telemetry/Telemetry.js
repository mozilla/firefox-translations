/*
 * collects application specific metrics and writes them to the underlying Glean client
 */

/* global Metrics */

// eslint-disable-next-line
class Telemetry {
    constructor(submitCallback) {
        this._client = new Metrics(submitCallback);
        this._totalWords = 0;
        this._totalEngineMs = 0;
        this._translationStartTimestamp = null;
        this._startTimestamp = null;
        this._otLenthPerTextArea = new Map();
        this._wordScores = [];
        this._sentScores = [];
    }

    translationStarted() {
        this._translationStartTimestamp = window.performance.now();
        this._updateUsageTime();
    }

    pageClosed() {
        this._client.submit("custom");
    }

    addAndGetTranslationTimeStamp(numWords, engineTimeElapsed) {
        this._totalWords += numWords;
        this._totalEngineMs += engineTimeElapsed;
        // it has to be int to use in telemetry
        const engineWps = Math.floor(this._totalWords / (this._totalEngineMs / 1000));
        const totalTimeMs = window.performance.now() - this._translationStartTimestamp;
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

    addQualityEstimation(wordScores, sentScores) {
        for (const score of wordScores) this._wordScores.push(score);
        for (const score of sentScores) this._sentScores.push(score);

        const wordStats = this._calcStats(this._wordScores);
        const sentStats = this._calcStats(this._sentScores);

        this._client.string(
    "performance", "translation_quality",
            `${wordStats.avg},${wordStats.median},${wordStats.perc90},${sentStats.avg},${sentStats.median},${sentStats.perc90}`
        );
        // glean Quantity metric type supports only positive integers
        this._client.quantity("performance", "word_quality_avg", Math.round(wordStats.avg*1000));
        this._client.quantity("performance", "word_quality_median", Math.round(wordStats.median*1000));
        this._client.quantity("performance", "word_quality_90th", Math.round(wordStats.perc90*1000));
        this._client.quantity("performance", "sent_quality_avg", Math.round(sentStats.avg*1000));
        this._client.quantity("performance", "sent_quality_median", Math.round(sentStats.median*1000));
        this._client.quantity("performance", "sent_quality_90th", Math.round(sentStats.perc90*1000));
    }

    _calcStats(array) {
        array.sort();
        const sum = array.reduce((a, b) => a + b, 0);
        const avg = (sum / array.length) || 0;
        const median = array[Math.floor(array.length/2)-1] || 0;
        const perc90 = array[Math.floor(array.length*0.9)-1] || 0;

        return { avg, median, perc90 }
    }

    langPair(from, to) {
        this._client.string("metadata", "from_lang", from);
        this._client.string("metadata", "to_lang", to);
    }

    environment(env) {
        this._client.quantity("metadata", "system_memory", env.systemMemoryMb);
        this._client.quantity("metadata", "cpu_count", env.systemCpuCount);
        this._client.quantity("metadata", "cpu_cores_count", env.systemCpuCores);
        this._client.quantity("metadata", "cpu_family", env.systemCpuFamily);
        this._client.quantity("metadata", "cpu_model", env.systemCpuModel);
        this._client.quantity("metadata", "cpu_stepping", env.systemCpuStepping);
        this._client.quantity("metadata", "cpu_l2_cache", env.systemCpuL2cacheKB);
        this._client.quantity("metadata", "cpu_l3_cache", env.systemCpuL3cacheKB);
        this._client.quantity("metadata", "cpu_speed", env.systemCpuSpeedMhz);
        this._client.string("metadata", "cpu_vendor", env.systemCpuVendor);
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
        let timestamp = window.performance.now();
        if (this._startTimestamp === null) {
            this._startTimestamp = timestamp;
        }
        this._client.timespan("performance", "total_usage_time", timestamp - this._startTimestamp);
    }
}