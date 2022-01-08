/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global ExtensionAPI, ChromeUtils */

"use strict";

this.experiment_telemetryEnvironment = class extends ExtensionAPI {
  getAPI(context) {
    const { TelemetryController } = ChromeUtils.import(
      "resource://gre/modules/TelemetryController.jsm",
      {},
    );
    const { TelemetryEnvironment } = ChromeUtils.import(
      "resource://gre/modules/TelemetryEnvironment.jsm",
      {},
    );
    const { ClientID } = ChromeUtils.import(
      "resource://gre/modules/ClientID.jsm",
      {},
    );

    /**
     * These attributes are already sent as part of the telemetry ping envelope
     * @returns {{}}
     */
    const collectTelemetryEnvironment = () => {
      const environment = TelemetryEnvironment.currentEnvironment;

      return {
        systemMemoryMb: environment.system.memoryMB,
        systemCpuCount: environment.system.cpu.count,
        systemCpuCores: environment.system.cpu.cores,
        systemCpuVendor: environment.system.cpu.vendor,
        systemCpuFamily: environment.system.cpu.family,
        systemCpuModel: environment.system.cpu.model,
        systemCpuStepping: environment.system.cpu.stepping,
        systemCpuL2cacheKB: environment.system.cpu.l2cacheKB,
        systemCpuL3cacheKB: environment.system.cpu.l3cacheKB,
        systemCpuSpeedMhz: environment.system.cpu.speedMHz,
        systemCpuExtensions: environment.system.cpu.extensions,
      };
    };

    return {
      experiments: {
        telemetryEnvironment: {
          async getFxTelemetryMetrics() {
            await TelemetryController.promiseInitialized();
            const telemetryEnv = collectTelemetryEnvironment();
            telemetryEnv.clientId = ClientID.getCachedClientID();
            return {
              ...telemetryEnv
            };
          },
        },
      },
    };
  }
};
