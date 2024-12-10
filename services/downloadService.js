const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const unzip = require("unzip-stream");
const { updateHeaders } = require("../helpers/headersHelper");
const { createProgressBar } = require("../helpers/progressHelper");
const {
  getBinaryInformMsg,
  getBinaryInitMsg,
  getDecryptionKey,
} = require("../utils/msgUtils");
const { parseBinaryInfo } = require("../utils/xmlUtils");

const downloadFirmware = async (model, region, imei, latestFirmware) => {
  console.log(`
Fetching Firmware for
Model: ${model}
Region: ${region}
IMEI: ${imei}
  `);

  const { pda, csc, modem } = latestFirmware;
  console.log(`
Latest Firmware Versions
PDA: ${pda}
CSC: ${csc}
MODEM: ${modem}
  `);

  const nonceState = { encrypted: "", decrypted: "" };
  const headers = { "User-Agent": "Kies2.0_FUS" };

  try {
    // Step 1: Generate Nonce
    const nonceResponse = await axios.post(
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
    );
    updateHeaders(nonceResponse.headers, headers, nonceState);

    // Step 2: Get Binary Information
    const binaryInfoResponse = await axios.post(
      "https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do",
      getBinaryInformMsg(
        `${pda}/${csc}/${modem}/${pda}`,
        region,
        model,
        imei,
        nonceState.decrypted,
      ),
      {
        headers: {
          ...headers,
          Accept: "application/xml",
          "Content-Type": "application/xml",
        },
      },
    );
    updateHeaders(binaryInfoResponse.headers, headers, nonceState);
    const binaryInfo = parseBinaryInfo(binaryInfoResponse.data);

    console.log(`
Binary Information:
OS: ${binaryInfo.binaryOSVersion}
Filename: ${binaryInfo.binaryFilename}
    `);

    const decryptionKey = getDecryptionKey(
      binaryInfo.binaryVersion,
      binaryInfo.binaryLogicValue,
    );

    // Step 3: Initialize Download
    const initResponse = await axios.post(
      "https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInitForMass.do",
      getBinaryInitMsg(binaryInfo.binaryFilename, nonceState.decrypted),
      {
        headers: {
          ...headers,
          Accept: "application/xml",
          "Content-Type": "application/xml",
        },
      },
    );
    updateHeaders(initResponse.headers, headers, nonceState);

    // Step 4: Download Binary
    const binaryDecipher = crypto.createDecipheriv(
      "aes-128-ecb",
      decryptionKey,
      null,
    );
    const res = await axios.get(
      `http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryInfo.binaryModelPath}${binaryInfo.binaryFilename}`,
      {
        headers,
        responseType: "stream",
      },
    );

    const outputFolder = `${process.cwd()}/${model}_${region}/`;
    fs.mkdirSync(outputFolder, { recursive: true });

    let downloadedSize = 0;
    const progressBar = createProgressBar(binaryInfo.binaryByteSize);

    res.data
      .on("data", (buffer) => {
        downloadedSize += buffer.length;
        progressBar.update(downloadedSize);
      })
      .pipe(binaryDecipher)
      .pipe(unzip.Parse())
      .on("entry", (entry) => {
        const filePath = path.join(outputFolder, entry.path);
        entry.pipe(fs.createWriteStream(filePath)).on("finish", () => {
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

module.exports = {
  downloadFirmware,
};
