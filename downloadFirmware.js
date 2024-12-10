#!/usr/bin/env node

const axios = require("axios");
const cliProgress = require("cli-progress");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const unzip = require("unzip-stream");
const yargs = require("yargs");

const { handleAuthRotation } = require("./utils/authUtils");
const { getBinaryInformMsg, getBinaryInitMsg, getDecryptionKey } = require("./utils/msgUtils");
const { parseBinaryInfo, parseLatestFirmwareVersion } = require("./utils/xmlUtils");

const updateHeaders = (responseHeaders, headers, nonceState) => {
  if (responseHeaders.nonce) {
    const { Authorization, nonce: newNonce } = handleAuthRotation(responseHeaders);
    Object.assign(nonceState, newNonce);
    headers.Authorization = Authorization;
  }
  const cookies = responseHeaders["set-cookie"];
  if (Array.isArray(cookies)) {
    const sessionID = cookies.find((cookie) => cookie.startsWith("JSESSIONID"))?.split(";")[0];
    if (sessionID) headers.Cookie = sessionID;
  }
};

const getLatestFirmwareVersion = async (region, model) => {
  try {
    const response = await axios.get(`http://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`);
    return parseLatestFirmwareVersion(response.data);
  } catch (error) {
    throw new Error(`Failed to fetch latest version: ${error.message}`);
  }
};

const downloadFirmware = async (region, model, imei) => {
  try {
    console.log(`Fetching firmware for model: ${model}, region: ${region}, IMEI: ${imei}`);
    const { pda, csc, modem } = await getLatestFirmwareVersion(region, model);
    console.log(`Latest Firmware Versions - PDA: ${pda}, CSC: ${csc}, MODEM: ${modem}`);

    const nonceState = { encrypted: "", decrypted: "" };
    const headers = { "User-Agent": "Kies2.0_FUS" };

    // Obtain nonce and update headers
    const nonceResponse = await axios.post("https://neofussvr.sslcs.cdngc.net/NF_DownloadGenerateNonce.do", "", {
      headers: { Authorization: 'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"', "User-Agent": "Kies2.0_FUS", Accept: "application/xml" },
    });
    updateHeaders(nonceResponse.headers, headers, nonceState);

    // Get binary info
    const binaryInfoResponse = await axios.post("https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do", getBinaryInformMsg(
      `${pda}/${csc}/${modem}/${pda}`,
      region,
      model,
      imei,
      nonceState.decrypted
    ), { headers: { ...headers, Accept: "application/xml", "Content-Type": "application/xml" } });
    updateHeaders(binaryInfoResponse.headers, headers, nonceState);
    const binaryInfo = parseBinaryInfo(binaryInfoResponse.data);

    console.log(`Binary Information: OS - ${binaryInfo.binaryOSVersion}, Filename - ${binaryInfo.binaryFilename}`);

    const decryptionKey = getDecryptionKey(binaryInfo.binaryVersion, binaryInfo.binaryLogicValue);

    // Initialize binary download
    const initResponse = await axios.post("https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInitForMass.do", getBinaryInitMsg(binaryInfo.binaryFilename, nonceState.decrypted), {
      headers: { ...headers, Accept: "application/xml", "Content-Type": "application/xml" },
    });
    updateHeaders(initResponse.headers, headers, nonceState);

    const binaryDecipher = crypto.createDecipheriv("aes-128-ecb", decryptionKey, null);

    const res = await axios.get(`http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryInfo.binaryModelPath}${binaryInfo.binaryFilename}`, {
      headers,
      responseType: "stream",
    });

    const outputFolder = `${process.cwd()}/${model}_${region}/`;
    fs.mkdirSync(outputFolder, { recursive: true });

    let downloadedSize = 0;
    let currentFile = "";
    const progressBar = new cliProgress.SingleBar({
      format: "{bar} {percentage}% | {value}/{total} | {file}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    }, cliProgress.Presets.shades_classic);
    progressBar.start(binaryInfo.binaryByteSize, downloadedSize);

    res.data
      .on("data", (buffer) => {
        downloadedSize += buffer.length;
        progressBar.update(downloadedSize, { file: currentFile });
      })
      .pipe(binaryDecipher)
      .pipe(unzip.Parse())
      .on("entry", (entry) => {
        currentFile = `${entry.path.slice(0, 18)}...`;
        progressBar.update(downloadedSize, { file: currentFile });
        entry.pipe(fs.createWriteStream(path.join(outputFolder, entry.path))).on("finish", () => {
          if (downloadedSize === binaryInfo.binaryByteSize) {
            console.log("Download completed.");
          }
        });
      });
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
};

const { argv } = yargs
  .option("imei", {
    alias: "i",
    describe: "IMEI/Serial Number",
    type: "string",
    demandOption: true,
  })
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
  .help();

downloadFirmware(argv.region, argv.model, argv.imei);
