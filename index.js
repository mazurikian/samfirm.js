#!/usr/bin/env node

const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { XMLBuilder, XMLParser } = require("fast-xml-parser");
const unzip = require("unzip-stream");
const yargs = require("yargs");

const AUTH_KEY = "9u7qab84rpc16gvk";
const NONCE_KEY = "vicopx7dqu06emacgpnpy8j8zwhduwlh";
const parser = new XMLBuilder({});
const xmlParser = new XMLParser();

const decryptNonce = (nonceEncrypted) => {
  const nonceDecipher = crypto.createDecipheriv("aes-256-cbc", NONCE_KEY, NONCE_KEY.slice(0, 16));
  return Buffer.concat([nonceDecipher.update(nonceEncrypted, "base64"), nonceDecipher.final()]).toString("utf-8");
};

const getAuthorization = (nonceDecrypted) => {
  const key = Array.from({ length: 16 }, (_, i) => NONCE_KEY[nonceDecrypted.charCodeAt(i) % 16]).join("") + AUTH_KEY;
  const authCipher = crypto.createCipheriv("aes-256-cbc", key, key.slice(0, 16));
  return Buffer.concat([authCipher.update(nonceDecrypted, "utf8"), authCipher.final()]).toString("base64");
};

const handleAuthRotation = (responseHeaders) => {
  const { nonce } = responseHeaders;
  const nonceDecrypted = decryptNonce(nonce);
  return {
    Authorization: `FUS nonce="${nonce}", signature="${getAuthorization(nonceDecrypted)}", nc="", type="", realm="", newauth="1"`,
    nonce: { decrypted: nonceDecrypted, encrypted: nonce },
  };
};

const getBinaryInitMsg = (filename, nonce) => parser.build({
  FUSMsg: {
    FUSHdr: { ProtoVer: "1.0" },
    FUSBody: { Put: { BINARY_FILE_NAME: { Data: filename }, LOGIC_CHECK: { Data: getLogicCheck(filename.split(".")[0].slice(-16), nonce) } } }
  }
});

const getBinaryInformMsg = (version, region, model, imei, nonce) => parser.build({
  FUSMsg: {
    FUSHdr: { ProtoVer: "1.0" },
    FUSBody: {
      Put: {
        ACCESS_MODE: { Data: 2 },
        BINARY_NATURE: { Data: 1 },
        CLIENT_PRODUCT: { Data: "Smart Switch" },
        CLIENT_VERSION: { Data: "4.3.24062_1" },
        DEVICE_IMEI_PUSH: { Data: imei },
        DEVICE_FW_VERSION: { Data: version },
        DEVICE_LOCAL_CODE: { Data: region },
        DEVICE_MODEL_NAME: { Data: model },
        LOGIC_CHECK: { Data: getLogicCheck(version, nonce) }
      }
    }
  }
});

const getDecryptionKey = (version, logicalValue) => crypto.createHash("md5").update(getLogicCheck(version, logicalValue)).digest();
const getLogicCheck = (input, nonce) => Array.from(nonce).map((char) => input[char.charCodeAt(0) & 0xf]).join("");

// Mostrar la información del binario en los logs
const parseBinaryInfo = (data) => {
  const parsedInfo = xmlParser.parse(data);
  const binaryInfo = {
    binaryByteSize: parsedInfo.FUSMsg.FUSBody.Put.BINARY_BYTE_SIZE.Data,
    binaryDescription: parsedInfo.FUSMsg.FUSBody.Put.DESCRIPTION.Data,
    binaryFilename: parsedInfo.FUSMsg.FUSBody.Put.BINARY_NAME.Data,
    binaryLogicValue: parsedInfo.FUSMsg.FUSBody.Put.LOGIC_VALUE_FACTORY.Data,
    binaryModelPath: parsedInfo.FUSMsg.FUSBody.Put.MODEL_PATH.Data,
    binaryOSVersion: parsedInfo.FUSMsg.FUSBody.Put.CURRENT_OS_VERSION.Data,
    binaryVersion: parsedInfo.FUSMsg.FUSBody.Results.LATEST_FW_VERSION.Data
  };

  console.log("Información del Binario:");
  console.log(`Tamaño del Binario: ${binaryInfo.binaryByteSize} bytes`);
  console.log(`Descripción: ${binaryInfo.binaryDescription}`);
  console.log(`Nombre del Archivo: ${binaryInfo.binaryFilename}`);
  console.log(`Valor Lógico: ${binaryInfo.binaryLogicValue}`);
  console.log(`Ruta del Modelo: ${binaryInfo.binaryModelPath}`);
  console.log(`Versión del SO: ${binaryInfo.binaryOSVersion}`);
  console.log(`Versión del Binario: ${binaryInfo.binaryVersion}`);
  
  return binaryInfo;
};

const parseLatestFirmwareVersion = (data) => {
  const parsedData = xmlParser.parse(data);
  const [pda, csc, modem] = parsedData.versioninfo.firmware.version.latest.split("/");
  return { pda, csc, modem: modem || "N/A" };
};

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

const downloadFirmware = async (model, region, imei, latestFirmware) => {
  const { pda, csc, modem } = latestFirmware;
  const nonceState = { encrypted: "", decrypted: "" };
  const headers = { "User-Agent": "Kies2.0_FUS" };

  try {
    const nonceResponse = await axios.post("https://neofussvr.sslcs.cdngc.net/NF_DownloadGenerateNonce.do", "", {
      headers: { Authorization: 'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"', "User-Agent": "Kies2.0_FUS", Accept: "application/xml" }
    });
    updateHeaders(nonceResponse.headers, headers, nonceState);

    const binaryInfoResponse = await axios.post("https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do", getBinaryInformMsg(`${pda}/${csc}/${modem}/${pda}`, region, model, imei, nonceState.decrypted), {
      headers: { ...headers, Accept: "application/xml", "Content-Type": "application/xml" }
    });
    updateHeaders(binaryInfoResponse.headers, headers, nonceState);

    // Aquí se imprime la información del binario
    const binaryInfo = parseBinaryInfo(binaryInfoResponse.data);

    const decryptionKey = getDecryptionKey(binaryInfo.binaryVersion, binaryInfo.binaryLogicValue);

    const initResponse = await axios.post("https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInitForMass.do", getBinaryInitMsg(binaryInfo.binaryFilename, nonceState.decrypted), {
      headers: { ...headers, Accept: "application/xml", "Content-Type": "application/xml" }
    });
    updateHeaders(initResponse.headers, headers, nonceState);

    const binaryDecipher = crypto.createDecipheriv("aes-128-ecb", decryptionKey, null);
    const res = await axios.get(`http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryInfo.binaryModelPath}${binaryInfo.binaryFilename}`, {
      headers, responseType: "stream"
    });

    const outputFolder = `${process.cwd()}/${model}_${region}/`;
    fs.mkdirSync(outputFolder, { recursive: true });

    let downloadedSize = 0;
    let lastProgress = 0;

    res.data.on("data", (buffer) => {
      downloadedSize += buffer.length;
      const downloadedMB = (downloadedSize / (1024 * 1024)).toFixed(2);
      const totalSizeInMB = (binaryInfo.binaryByteSize / (1024 * 1024)).toFixed(2);
      const progress = ((downloadedSize / (1024 * 1024)) / totalSizeInMB * 100).toFixed(2);

      if (progress !== lastProgress) {
        process.stdout.write(`Downloading: ${downloadedMB} MB of ${totalSizeInMB} MB - ${progress}%\r`);
        lastProgress = progress;
      }
    })
    .pipe(binaryDecipher)
    .pipe(unzip.Parse())
    .on("entry", (entry) => {
      const filePath = path.join(outputFolder, entry.path);
      entry.pipe(fs.createWriteStream(filePath)).on("finish", () => {
        if (downloadedSize === binaryInfo.binaryByteSize) {
          console.log("\nDownload completed.");
        }
      });
    });
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
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

// === Main ===
const { argv } = yargs
  .option("model", { alias: "m", describe: "Model", type: "string", demandOption: true })
  .option("region", { alias: "r", describe: "Region", type: "string", demandOption: true })
  .option("imei", { alias: "i", describe: "IMEI/Serial Number", type: "string", demandOption: true })
  .help();

(async () => {
  try {
    const latestFirmware = await getLatestFirmwareVersion(argv.region, argv.model);
    await downloadFirmware(argv.model, argv.region, argv.imei, latestFirmware);
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
})();
