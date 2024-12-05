#!/usr/bin/env node

import axios from "axios";
import cliProgress from "cli-progress";
import crypto from "crypto";
import fs from "fs";
import { parse as xmlParse } from "fast-xml-parser";
import path from "path";
import unzip from "unzip-stream";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

import { handleAuthRotation } from "./utils/authUtils";
import {
  getBinaryInformMsg,
  getBinaryInitMsg,
  getDecryptionKey,
} from "./utils/msgUtils";
import { version as packageVersion } from "./package.json";

// Configuración constante
const BASE_URL = "https://neofussvr.sslcs.cdngc.net";
const USER_AGENT = "Kies2.0_FUS";
const DEFAULT_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "application/xml",
};

// Función para obtener la última versión del firmware
async function fetchLatestFirmwareVersion(region, model) {
  try {
    const response = await axios.get(
      `https://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`
    );
    const versionData = xmlParse(response.data).versioninfo.firmware.version
      .latest;
    const [pda, csc, modem] = versionData.split("/");
    return { pda, csc, modem };
  } catch (error) {
    throw new Error("Error al obtener la última versión del firmware.");
  }
}

// Función para manejar encabezados de autenticación
function updateHeaders(headers, responseHeaders, nonce) {
  if (responseHeaders.nonce) {
    const authData = handleAuthRotation(responseHeaders);
    Object.assign(nonce, authData.nonce);
    headers.Authorization = authData.Authorization;
  }

  const sessionID = responseHeaders["set-cookie"]
    ?.find((cookie) => cookie.startsWith("JSESSIONID"))
    ?.split(";")[0];
  if (sessionID) {
    headers.Cookie = sessionID;
  }
}

// Función para obtener metadatos del binario
async function fetchBinaryMetadata(region, model, imei, nonce, headers, versionInfo) {
  const { pda, csc, modem } = versionInfo;
  const payload = getBinaryInformMsg(
    `${pda}/${csc}/${modem || pda}/${pda}`,
    region,
    model,
    imei,
    nonce.decrypted
  );

  try {
    const response = await axios.post(
      `${BASE_URL}/NF_DownloadBinaryInform.do`,
      payload,
      {
        headers: {
          ...headers,
          "Content-Type": "application/xml",
        },
      }
    );

    updateHeaders(headers, response.headers, nonce);

    const parsedInfo = xmlParse(response.data);
    return {
      binaryByteSize: parsedInfo.FUSMsg.FUSBody.Put.BINARY_BYTE_SIZE.Data,
      binaryDescription: parsedInfo.FUSMsg.FUSBody.Put.DESCRIPTION.Data,
      binaryFilename: parsedInfo.FUSMsg.FUSBody.Put.BINARY_NAME.Data,
      binaryLogicValue: parsedInfo.FUSMsg.FUSBody.Put.LOGIC_VALUE_FACTORY.Data,
      binaryModelPath: parsedInfo.FUSMsg.FUSBody.Put.MODEL_PATH.Data,
      binaryOSVersion: parsedInfo.FUSMsg.FUSBody.Put.CURRENT_OS_VERSION.Data,
      binaryVersion: parsedInfo.FUSMsg.FUSBody.Results.LATEST_FW_VERSION.Data,
    };
  } catch (error) {
    throw new Error("Error al obtener metadatos del binario.");
  }
}

// Función para manejar la descarga del firmware
async function downloadAndDecryptFirmware(metadata, headers, nonce, outputFolder) {
  const decryptionKey = getDecryptionKey(metadata.binaryVersion, metadata.binaryLogicValue);
  const binaryDecipher = crypto.createDecipheriv("aes-128-ecb", decryptionKey, null);

  try {
    const response = await axios.get(
      `${BASE_URL}/NF_DownloadBinaryForMass.do?file=${metadata.binaryModelPath}${metadata.binaryFilename}`,
      { headers, responseType: "stream" }
    );

    fs.mkdirSync(outputFolder, { recursive: true });

    let downloadedSize = 0;
    let currentFile = "";
    const progressBar = new cliProgress.SingleBar({
      format: "{bar} {percentage}% | {value}/{total} bytes | {file}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    });

    progressBar.start(metadata.binaryByteSize, downloadedSize);

    response.data
      .on("data", (buffer) => {
        downloadedSize += buffer.length;
        progressBar.update(downloadedSize, { file: currentFile });
      })
      .pipe(binaryDecipher)
      .pipe(unzip.Parse())
      .on("entry", (entry) => {
        currentFile = entry.path.length > 18 ? `${entry.path.slice(0, 18)}...` : entry.path;
        progressBar.update(downloadedSize, { file: currentFile });
        entry.pipe(fs.createWriteStream(path.join(outputFolder, entry.path)));
      })
      .on("finish", () => {
        progressBar.stop();
        console.log("Descarga y extracción completadas.");
      });
  } catch (error) {
    throw new Error("Error durante la descarga o desencriptación del firmware.");
  }
}

// Flujo principal
async function main(region, model, imei) {
  console.log(`Modelo: ${model}, Región: ${region}, IMEI: ${imei}`);
  try {
    const versionInfo = await fetchLatestFirmwareVersion(region, model);
    console.log("Última versión obtenida:", versionInfo);

    const nonce = { encrypted: "", decrypted: "" };
    const headers = { ...DEFAULT_HEADERS, Authorization: 'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"' };

    // Inicialización de sesión
    await axios.post(`${BASE_URL}/NF_DownloadGenerateNonce.do`, "", { headers })
      .then((res) => updateHeaders(headers, res.headers, nonce));

    const metadata = await fetchBinaryMetadata(region, model, imei, nonce, headers, versionInfo);

    console.log("Metadatos del binario obtenidos:", metadata);

    const outputFolder = path.join(process.cwd(), `${model}_${region}`);
    await downloadAndDecryptFirmware(metadata, headers, nonce, outputFolder);
  } catch (error) {
    console.error("Error:", error.message);
  }
}

// Manejo de CLI con yargs
const argv = yargs(hideBin(process.argv))
  .option("model", { alias: "m", describe: "Modelo del dispositivo", type: "string", demandOption: true })
  .option("region", { alias: "r", describe: "Región", type: "string", demandOption: true })
  .option("imei", { alias: "i", describe: "IMEI o número de serie", type: "string", demandOption: true })
  .version(packageVersion)
  .alias("v", "version")
  .help()
  .argv;

main(argv.region, argv.model, argv.imei);
