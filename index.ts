#!/usr/bin/env node

// Importación de módulos y utilidades necesarias
import axios, { AxiosResponse } from "axios";
import cliProgress from "cli-progress";
import crypto from "crypto";
import fs from "fs";
import { parse as xmlParse } from "fast-xml-parser";
import path from "path";
import unzip from "unzip-stream";
import yargs from "yargs";

// Importación de utilidades personalizadas y datos del paquete
import { handleAuthRotation } from "./utils/authUtils";
import {
  getBinaryInformMsg,
  getBinaryInitMsg,
  getDecryptionKey,
} from "./utils/msgUtils";
import { version as packageVersion } from "./package.json";

// Función para obtener la última versión de firmware disponible
const getLatestVersion = async (
  region: string,
  model: string
): Promise<{ pda: string; csc: string; modem: string }> => {
  return axios
    .get(
      `https://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`
    )
    .then((res: AxiosResponse) => {
      // Parseo del XML para extraer las versiones PDA, CSC y MODEM
      const [pda, csc, modem] = xmlParse(
        res.data
      ).versioninfo.firmware.version.latest.split("/");

      return { pda, csc, modem };
    });
};

// Función principal que coordina el flujo del programa
const main = async (region: string, model: string, imei: string): Promise<void> => {
  console.log(`
  Model: ${model}
  Region: ${region}
  IMEI: ${imei}`);

  // Obtener la última versión de firmware
  const { pda, csc, modem } = await getLatestVersion(region, model);
  console.log(`
  Latest version:
    PDA: ${pda}
    CSC: ${csc}
    MODEM: ${modem !== "" ? modem : "N/A"}`);

  // Configuración inicial de cabeceras y nonce
  const nonce = { encrypted: "", decrypted: "" };
  const headers: Record<string, string> = {
    "User-Agent": "Kies2.0_FUS",
  };

  // Función para manejar las cabeceras y actualizar el nonce o sesión
  const handleHeaders = (responseHeaders: any) => {
    if (responseHeaders.nonce != null) {
      const { Authorization, nonce: newNonce } = handleAuthRotation(
        responseHeaders
      );

      Object.assign(nonce, newNonce);
      headers.Authorization = Authorization;
    }

    const sessionID = responseHeaders["set-cookie"]
      ?.find((cookie: string) => cookie.startsWith("JSESSIONID"))
      ?.split(";")[0];

    if (sessionID != null) {
      headers.Cookie = sessionID;
    }
  };

  // Generar un nonce para la autenticación
  await axios
    .post("https://neofussvr.sslcs.cdngc.net/NF_DownloadGenerateNonce.do", "", {
      headers: {
        Authorization:
          'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"',
        "User-Agent": "Kies2.0_FUS",
        Accept: "application/xml",
      },
    })
    .then((res) => {
      handleHeaders(res.headers);
      return res;
    });

  // Solicitar información del binario de firmware
  const {
    binaryByteSize,
    binaryDescription,
    binaryFilename,
    binaryLogicValue,
    binaryModelPath,
    binaryOSVersion,
    binaryVersion,
  } = await axios
    .post(
      "https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do",
      getBinaryInformMsg(
        `${pda}/${csc}/${modem !== "" ? modem : pda}/${pda}`,
        region,
        model,
        imei,
        nonce.decrypted
      ),
      {
        headers: {
          ...headers,
          Accept: "application/xml",
          "Content-Type": "application/xml",
        },
      }
    )
    .then((res) => {
      handleHeaders(res.headers);
      return res;
    })
    .then((res: AxiosResponse) => {
      const parsedInfo = xmlParse(res.data);

      // Extraer información del binario desde el XML
      return {
        binaryByteSize: parsedInfo.FUSMsg.FUSBody.Put.BINARY_BYTE_SIZE.Data,
        binaryDescription: parsedInfo.FUSMsg.FUSBody.Put.DESCRIPTION.Data,
        binaryFilename: parsedInfo.FUSMsg.FUSBody.Put.BINARY_NAME.Data,
        binaryLogicValue:
          parsedInfo.FUSMsg.FUSBody.Put.LOGIC_VALUE_FACTORY.Data,
        binaryModelPath: parsedInfo.FUSMsg.FUSBody.Put.MODEL_PATH.Data,
        binaryOSVersion: parsedInfo.FUSMsg.FUSBody.Put.CURRENT_OS_VERSION.Data,
        binaryVersion: parsedInfo.FUSMsg.FUSBody.Results.LATEST_FW_VERSION.Data,
      };
    });

  console.log(`
  OS: ${binaryOSVersion}
  Filename: ${binaryFilename}
  Size: ${binaryByteSize} bytes
  Logic Value: ${binaryLogicValue}
  Description:
    ${binaryDescription.split("\n").join("\n    ")}`);

  // Generar la clave de desencriptación para el binario
  const decryptionKey = getDecryptionKey(binaryVersion, binaryLogicValue);

  // Inicializar la descarga del binario
  await axios
    .post(
      "https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInitForMass.do",
      getBinaryInitMsg(binaryFilename, nonce.decrypted),
      {
        headers: {
          ...headers,
          Accept: "application/xml",
          "Content-Type": "application/xml",
        },
      }
    )
    .then((res) => {
      handleHeaders(res.headers);
      return res;
    });

  // Crear un flujo para desencriptar y descomprimir el archivo
  const binaryDecipher = crypto.createDecipheriv(
    "aes-128-ecb",
    decryptionKey,
    null
  );

  // Descargar y procesar el binario
  await axios
    .get(
      `http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryModelPath}${binaryFilename}`,
      {
        headers,
        responseType: "stream",
      }
    )
    .then((res: AxiosResponse) => {
      const outputFolder = `${process.cwd()}/${model}_${region}/`;
      console.log();
      console.log(outputFolder);
      fs.mkdirSync(outputFolder, { recursive: true });

      let downloadedSize = 0;
      let currentFile = "";
      const progressBar = new cliProgress.SingleBar({
        format: "{bar} {percentage}% | {value}/{total} | {file}",
        barCompleteChar: "\u2588",
        barIncompleteChar: "\u2591",
      });
      progressBar.start(binaryByteSize, downloadedSize);

      return res.data
        .on("data", (buffer: Buffer) => {
          downloadedSize += buffer.length;
          progressBar.update(downloadedSize, { file: currentFile });
        })
        .pipe(binaryDecipher)
        .pipe(unzip.Parse())
        .on("entry", (entry) => {
          currentFile = `${entry.path.slice(0, 18)}...`;
          progressBar.update(downloadedSize, { file: currentFile });
          entry
            .pipe(fs.createWriteStream(path.join(outputFolder, entry.path)))
            .on("finish", () => {
              if (downloadedSize === binaryByteSize) {
                process.exit();
              }
            });
        });
    });
};

// Configuración de argumentos CLI con Yargs
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
  .version(packageVersion)
  .alias("v", "version")
  .help();

// Ejecutar la función principal con los argumentos proporcionados
main(argv.region, argv.model, argv.imei);

export {};
