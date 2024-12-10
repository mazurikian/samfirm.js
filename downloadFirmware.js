#!/usr/bin/env node

const axios = require("axios");
const cliProgress = require("cli-progress");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const unzip = require("unzip-stream");
const yargs = require("yargs");

// STEP 2: Import utility functions from other files
const { handleAuthRotation } = require("./utils/authUtils");
const {
  getBinaryInformMsg,
  getBinaryInitMsg,
  getDecryptionKey,
} = require("./utils/msgUtils");
const {
  parseBinaryInfo,
  parseLatestFirmwareVersion,
} = require("./utils/xmlUtils");

/**
 * STEP 3: Helper function to update headers with authorization and session information.
 *
 * @param {object} responseHeaders - Response headers from the server
 * @param {object} headers - Headers to be updated
 * @param {object} nonce - Object to store encrypted and decrypted nonce
 */
const updateHeaders = (responseHeaders, headers, nonce) => {
  if (responseHeaders.nonce) {
    // Handle the nonce and update the authorization header for subsequent requests
    const { Authorization, nonce: newNonce } =
      handleAuthRotation(responseHeaders);
    Object.assign(nonce, newNonce);
    headers.Authorization = Authorization;
  }
  // Extract and update the session ID from cookies if present
  const cookies = responseHeaders["set-cookie"];
  if (Array.isArray(cookies)) {
    const sessionID = cookies
      .find((cookie) => cookie.startsWith("JSESSIONID"))
      ?.split(";")[0];
    if (sessionID) headers.Cookie = sessionID;
  }
};

/**
 * STEP 4: Fetch the latest firmware version for a specific model and region.
 *
 * @param {string} region - The region of the device
 * @param {string} model - The model of the device
 * @returns {object} - The firmware version details
 */
const getLatestFirmwareVersion = async (region, model) => {
  try {
    const response = await axios.get(
      `http://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`,
    );
    return parseLatestFirmwareVersion(response.data); // Parsing the firmware version from XML response
  } catch (error) {
    throw new Error(`Failed to fetch latest version: ${error.message}`);
  }
};

/**
 * STEP 5: Main function to download firmware for a given model, region, and IMEI.
 *
 * @param {string} region - The region of the device
 * @param {string} model - The model of the device
 * @param {string} imei - The IMEI number of the device
 */
const downloadFirmware = async (region, model, imei) => {
  try {
    console.log(
      `Fetching firmware for model: ${model}, region: ${region}, IMEI: ${imei}`,
    );

    // STEP 5.1: Fetch the latest firmware version
    const { pda, csc, modem } = await getLatestFirmwareVersion(region, model);
    console.log(
      `Latest Firmware Versions - PDA: ${pda}, CSC: ${csc}, MODEM: ${modem}`,
    );

    const nonce = { encrypted: "", decrypted: "" };
    const headers = { "User-Agent": "Kies2.0_FUS" };

    // STEP 5.2: Fetch and handle the nonce to initiate the download process
    await axios
      .post(
        "https://neofussvr.sslcs.cdngc.net/NF_DownloadGenerateNonce.do",
        "",
        {
          headers: {
            Authorization:
              'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"',
            "User-Agent": "Kies2.0_FUS",
            Accept: "application/xml",
          },
        },
      )
      .then((res) => updateHeaders(res.headers, headers, nonce)); // Update headers with the new nonce

    // STEP 5.3: Fetch binary information for the firmware download
    const binaryInfo = await axios
      .post(
        "https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do",
        getBinaryInformMsg(
          `${pda}/${csc}/${modem}/${pda}`,
          region,
          model,
          imei,
          nonce.decrypted,
        ),
        {
          headers: {
            ...headers,
            Accept: "application/xml",
            "Content-Type": "application/xml",
          },
        },
      )
      .then((res) => {
        updateHeaders(res.headers, headers, nonce); // Update headers with the new nonce after the request
        return parseBinaryInfo(res.data); // Parsing the binary information from the XML response
      });

    console.log(
      `Binary Information: OS - ${binaryInfo.binaryOSVersion}, Filename - ${binaryInfo.binaryFilename}`,
    );

    // STEP 5.4: Get the decryption key for the binary file
    const decryptionKey = getDecryptionKey(
      binaryInfo.binaryVersion,
      binaryInfo.binaryLogicValue,
    );

    // STEP 5.5: Initialize the binary download process
    await axios
      .post(
        "https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInitForMass.do",
        getBinaryInitMsg(binaryInfo.binaryFilename, nonce.decrypted),
        {
          headers: {
            ...headers,
            Accept: "application/xml",
            "Content-Type": "application/xml",
          },
        },
      )
      .then((res) => updateHeaders(res.headers, headers, nonce));

    const binaryDecipher = crypto.createDecipheriv(
      "aes-128-ecb", // AES decryption in ECB mode
      decryptionKey, // Decryption key generated earlier
      null, // No IV used in ECB mode
    );

    // STEP 5.6: Download and unzip the firmware binary file
    await axios
      .get(
        `http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryInfo.binaryModelPath}${binaryInfo.binaryFilename}`,
        {
          headers,
          responseType: "stream",
        },
      )
      .then((res) => {
        const outputFolder = `${process.cwd()}/${model}_${region}/`; // Define output folder for the downloaded files
        fs.mkdirSync(outputFolder, { recursive: true }); // Create the output folder if it doesn't exist

        let downloadedSize = 0;
        let currentFile = "";
        const progressBar = new cliProgress.SingleBar(
          {
            format: "{bar} {percentage}% | {value}/{total} | {file}",
            barCompleteChar: "\u2588",
            barIncompleteChar: "\u2591",
          },
          cliProgress.Presets.shades_classic,
        );
        progressBar.start(binaryInfo.binaryByteSize, downloadedSize); // Initialize the progress bar

        return res.data
          .on("data", (buffer) => {
            downloadedSize += buffer.length; // Update downloaded size
            progressBar.update(downloadedSize, { file: currentFile }); // Update the progress bar
          })
          .pipe(binaryDecipher) // Decrypt the binary file
          .pipe(unzip.Parse()) // Unzip the file
          .on("entry", (entry) => {
            currentFile = `${entry.path.slice(0, 18)}...`; // Track the current file being extracted
            progressBar.update(downloadedSize, { file: currentFile }); // Update progress bar with the current file
            entry
              .pipe(fs.createWriteStream(path.join(outputFolder, entry.path))) // Write the extracted file to disk
              .on("finish", () => {
                if (downloadedSize === binaryInfo.binaryByteSize) {
                  process.exit(); // Exit once the entire file is downloaded and extracted
                }
              });
          });
      });
  } catch (error) {
    console.error("Error:", error.message); // Log any errors encountered
    process.exit(1); // Exit with error code 1
  }
};

// STEP 6: Parse command-line arguments using yargs
const { argv } = yargs
  .option("imei", {
    alias: "i",
    describe: "IMEI/Serial Number",
    type: "string",
    demandOption: true, // IMEI is a required parameter
  })
  .option("model", {
    alias: "m",
    describe: "Model",
    type: "string",
    demandOption: true, // Model is a required parameter
  })
  .option("region", {
    alias: "r",
    describe: "Region",
    type: "string",
    demandOption: true, // Region is a required parameter
  })
  .help(); // Show help message for command-line options

// STEP 7: Start the firmware download process
downloadFirmware(argv.region, argv.model, argv.imei);
