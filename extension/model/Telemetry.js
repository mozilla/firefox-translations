/*
 * class responsible for all telemetry and performance statistics related operations
 */

// eslint-disable-next-line no-unused-vars
class Telemetry {

    constructor() {
        this.totalWords = 0;
        this.totalSeconds = 0;
    }

    addAndGetTranslationTimeStamp(timestamp) {
        this.totalWords += timestamp[0];
        this.totalSeconds += timestamp[1]/1000;
        return Math.round(this.totalWords / this.totalSeconds * 100)/100;
    }

}