#!/usr/bin/env node

import axios, { AxiosResponse } from "axios";
import cliProgress from "cli-progress";
import crypto from "crypto";
import fs from "fs";
import { parse as xmlParse } from "fast-xml-parser";
import path from "path";
import unzip from "unzip-stream";
import yargs from "yargs";

import { handleAuthRotation } from "./utils/authUtils";
import {
  getBinaryInformMsg,
  getBinaryInitMsg,
  getDecryptionKey,
} from "./utils/msgUtils";
import { version as packageVersion } from "./package.json";

// ================= FUNCIONES AUXILIARES =================

// Obtener la última versión del firmware
const getLatestVersion = async (region, model) => {
  try {
    const response = await axios.get(
      `https://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`
    );
    const [pda, csc, modem] = xmlParse(response.data).versioninfo.firmware.version.latest.split("/");
    return { pda, csc, modem };
  } catch (error) {
    throw new Error(`Error al obtener la última versión: ${error.message}`);
  }
};

// Manejar encabezados para rotación de autenticación y cookies
const processHeaders = (responseHeaders, headers, nonce) => {
  if (responseHeaders.nonce) {
    const { Authorization, nonce: newNonce } = handleAuthRotation(responseHeaders);
    Object.assign(nonce, newNonce);
    headers.Authorization = Authorization;
  }

  const sessionID = responseHeaders["set-cookie"]
    ?.find((cookie) => cookie.startsWith("JSESSIONID"))
    ?.split(";")[0];

  if (sessionID) {
    headers.Cookie = sessionID;
  }
};

// Realizar solicitud HTTP con manejo de encabezados
const makeRequest = async (url, data, headers, processResponseHeaders) => {
  try {
    const response = await axios.post(url, data, { headers });
    if (processResponseHeaders) processResponseHeaders(response.headers);
    return response;
  } catch (error) {
    throw new Error(`Error en la solicitud a ${url}: ${error.message}`);
  }
};

// Descargar y descifrar el archivo binario
const downloadAndDecryptBinary = async (
  url,
  binaryDecipher,
  binaryByteSize,
  outputFolder
) => {
  try {
    const progressBar = new cliProgress.SingleBar({
      format: "{bar} {percentage}% | {value}/{total} | {file}",
      barCompleteChar: "\u2588",
      barIncompleteChar: "\u2591",
    });

    let downloadedSize = 0;
    let currentFile = "";

    const response = await axios.get(url, {
      responseType: "stream",
    });

    fs.mkdirSync(outputFolder, { recursive: true });
    progressBar.start(binaryByteSize, downloadedSize);

    response.data
      .on("data", (chunk) => {
        downloadedSize += chunk.length;
        progressBar.update(downloadedSize, { file: currentFile });
      })
      .pipe(binaryDecipher)
      .pipe(unzip.Parse())
      .on("entry", (entry) => {
        currentFile = `${entry.path.slice(0, 18)}...`;
        entry.pipe(fs.createWriteStream(path.join(outputFolder, entry.path)));
      })
      .on("finish", () => {
        progressBar.stop();
        console.log("Descarga y descifrado completados.");
      });
  } catch (error) {
    throw new Error(`Error durante la descarga o descifrado: ${error.message}`);
  }
};

// ================= FUNCIÓN PRINCIPAL =================
const main = async (region, model, imei) => {
  try {
    console.log(`\nModelo: ${model}\nRegión: ${region}\nIMEI: ${imei}\n`);

    const { pda, csc, modem } = await getLatestVersion(region, model);
    console.log(`\nÚltima versión:\n  PDA: ${pda}\n  CSC: ${csc}\n  MODEM: ${modem || "N/A"}`);

    const nonce = { encrypted: "", decrypted: "" };
    const headers = { "User-Agent": "Kies2.0_FUS" };

    // Solicitar Nonce
    await makeRequest(
      "https://neofussvr.sslcs.cdngc.net/NF_DownloadGenerateNonce.do",
      "",
      {
        Authorization: 'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"',
        "User-Agent": "Kies2.0_FUS",
        Accept: "application/xml",
      },
      (resHeaders) => processHeaders(resHeaders, headers, nonce)
    );

    // Obtener información binaria
    const binaryInfo = await makeRequest(
      "https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do",
      getBinaryInformMsg(`${pda}/${csc}/${modem || pda}/${pda}`, region, model, imei, nonce.decrypted),
      {
        ...headers,
        Accept: "application/xml",
        "Content-Type": "application/xml",
      },
      (resHeaders) => processHeaders(resHeaders, headers, nonce)
    ).then((res) => xmlParse(res.data).FUSMsg.FUSBody.Put);

    console.log(`\nOS: ${binaryInfo.CURRENT_OS_VERSION.Data}\nTamaño: ${binaryInfo.BINARY_BYTE_SIZE.Data} bytes`);

    const decryptionKey = getDecryptionKey(
      binaryInfo.LATEST_FW_VERSION.Data,
      binaryInfo.LOGIC_VALUE_FACTORY.Data
    );

    // Descargar y descifrar
    const binaryDecipher = crypto.createDecipheriv("aes-128-ecb", decryptionKey, null);
    const outputFolder = `${process.cwd()}/${model}_${region}/`;

    await downloadAndDecryptBinary(
      `http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryInfo.MODEL_PATH.Data}${binaryInfo.BINARY_NAME.Data}`,
      binaryDecipher,
      parseInt(binaryInfo.BINARY_BYTE_SIZE.Data),
      outputFolder
    );
  } catch (error) {
    console.error(`Error: ${error.message}`);
  }
};

// ================= CONFIGURACIÓN CLI =================
const { argv } = yargs
  .option("model", { alias: "m", describe: "Modelo", type: "string", demandOption: true })
  .option("region", { alias: "r", describe: "Región", type: "string", demandOption: true })
  .option("imei", { alias: "i", describe: "IMEI/Serial Number", type: "string", demandOption: true })
  .version(packageVersion)
  .alias("v", "version")
  .help();

main(argv.region, argv.model, argv.imei);

export {};
