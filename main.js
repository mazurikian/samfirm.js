#!/usr/bin/env node

const yargs = require("yargs");
const { getLatestFirmwareVersion } = require("./services/firmwareService");
const { downloadFirmware } = require("./services/downloadService");

const { argv } = yargs
  .option("model", {
    alias: "m",
    describe: "Model",
    type: "string",
    demandOption: true,
  })
  .option("region", {
    alias: "r",
    describe: "Region",
    type: "string",
    demandOption: true,
  })
  .option("imei", {
    alias: "i",
    describe: "IMEI/Serial Number",
    type: "string",
    demandOption: true,
  })
  .help();

(async () => {
  try {
    const latestFirmware = await getLatestFirmwareVersion(
      argv.region,
      argv.model,
    );
    await downloadFirmware(argv.model, argv.region, argv.imei, latestFirmware);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
})();
