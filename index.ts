#!/usr/bin/env node

// Importación de módulos necesarios
import axios, { AxiosResponse } from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import unzip from 'unzip-stream';
import cliProgress from 'cli-progress';
import yargs from 'yargs';
import { parse as xmlParse } from 'fast-xml-parser';

import { handleAuthRotation } from './utils/authUtils';
import { getBinaryInformMsg, getBinaryInitMsg, getDecryptionKey } from './utils/msgUtils';
import { version as packageVersion } from './package.json';

// Definición de tipos
type FirmwareVersion = { pda: string; csc: string; modem: string };

// Función para obtener la última versión del firmware
const getLatestVersion = async (region: string, model: string): Promise<FirmwareVersion> => {
  try {
    const response = await axios.get(`https://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`);
    const parsedData = xmlParse(response.data);
    const [pda, csc, modem] = parsedData.versioninfo.firmware.version.latest.split('/');
    return { pda, csc, modem: modem || 'N/A' };
  } catch (error) {
    throw new Error(`Failed to fetch latest version: ${error.message}`);
  }
};

// Función principal
const main = async (region: string, model: string, imei: string): Promise<void> => {
  try {
    console.log(`Model: ${model}\nRegion: ${region}\nIMEI: ${imei}`);

    // Obtener y mostrar la última versión del firmware
    const { pda, csc, modem } = await getLatestVersion(region, model);
    console.log(`\nLatest version:\nPDA: ${pda}\nCSC: ${csc}\nMODEM: ${modem}`);

    // Variables iniciales
    const nonce = { encrypted: '', decrypted: '' };
    const headers: Record<string, string> = { 'User-Agent': 'Kies2.0_FUS' };

    // Función para manejar las cabeceras de autenticación y sesión
    const handleHeaders = (responseHeaders: Record<string, string>) => {
      if (responseHeaders.nonce) {
        const { Authorization, nonce: newNonce } = handleAuthRotation(responseHeaders);
        Object.assign(nonce, newNonce);
        headers.Authorization = Authorization;
      }

      const sessionID = responseHeaders['set-cookie']?.find((cookie: string) => cookie.startsWith('JSESSIONID'))?.split(';')[0];
      if (sessionID) {
        headers.Cookie = sessionID;
      }
    };

    // Solicitar nonce para autenticación
    await axios.post(`https://neofussvr.sslcs.cdngc.net/NF_DownloadGenerateNonce.do`, '', {
      headers: {
        Authorization: 'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"',
        'User-Agent': 'Kies2.0_FUS',
        Accept: 'application/xml',
      },
    }).then((res) => handleHeaders(res.headers));

    // Obtener información del binario
    const binaryInfo = await axios.post(`https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do`, getBinaryInformMsg(`${pda}/${csc}/${modem}/${pda}`, region, model, imei, nonce.decrypted), {
      headers: { ...headers, Accept: 'application/xml', 'Content-Type': 'application/xml' },
    }).then((res) => {
      handleHeaders(res.headers);
      const parsedInfo = xmlParse(res.data);
      return {
        binaryByteSize: parsedInfo.FUSMsg.FUSBody.Put.BINARY_BYTE_SIZE.Data,
        binaryDescription: parsedInfo.FUSMsg.FUSBody.Put.DESCRIPTION.Data,
        binaryFilename: parsedInfo.FUSMsg.FUSBody.Put.BINARY_NAME.Data,
        binaryLogicValue: parsedInfo.FUSMsg.FUSBody.Put.LOGIC_VALUE_FACTORY.Data,
        binaryModelPath: parsedInfo.FUSMsg.FUSBody.Put.MODEL_PATH.Data,
        binaryOSVersion: parsedInfo.FUSMsg.FUSBody.Put.CURRENT_OS_VERSION.Data,
        binaryVersion: parsedInfo.FUSMsg.FUSBody.Results.LATEST_FW_VERSION.Data,
      };
    });

    // Mostrar información del binario
    console.log(`\nOS: ${binaryInfo.binaryOSVersion}\nFilename: ${binaryInfo.binaryFilename}\nSize: ${binaryInfo.binaryByteSize} bytes\nLogic Value: ${binaryInfo.binaryLogicValue}\nDescription: ${binaryInfo.binaryDescription.split('\n').join('\n    ')}`);

    const decryptionKey = getDecryptionKey(binaryInfo.binaryVersion, binaryInfo.binaryLogicValue);

    // Iniciar descarga del binario
    await axios.post(`https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInitForMass.do`, getBinaryInitMsg(binaryInfo.binaryFilename, nonce.decrypted), {
      headers: { ...headers, Accept: 'application/xml', 'Content-Type': 'application/xml' },
    }).then((res) => handleHeaders(res.headers));

    // Decodificador de binario
    const binaryDecipher = crypto.createDecipheriv('aes-128-ecb', decryptionKey, null);

    // Descargar y descomprimir el binario
    await axios.get(`http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryInfo.binaryModelPath}${binaryInfo.binaryFilename}`, {
      headers,
      responseType: 'stream',
    }).then((res: AxiosResponse) => {
      const outputFolder = `${process.cwd()}/${model}_${region}/`;
      fs.mkdirSync(outputFolder, { recursive: true });

      let downloadedSize = 0;
      let currentFile = '';
      const progressBar = new cliProgress.SingleBar({ format: '{bar} {percentage}% | {value}/{total} | {file}', barCompleteChar: '\u2588', barIncompleteChar: '\u2591' });
      progressBar.start(binaryInfo.binaryByteSize, downloadedSize);

      res.data.on('data', (buffer: Buffer) => {
        downloadedSize += buffer.length;
        progressBar.update(downloadedSize, { file: currentFile });
      }).pipe(binaryDecipher).pipe(unzip.Parse()).on('entry', (entry) => {
        currentFile = `${entry.path.slice(0, 18)}...`;
        progressBar.update(downloadedSize, { file: currentFile });
        entry.pipe(fs.createWriteStream(path.join(outputFolder, entry.path))).on('finish', () => {
          if (downloadedSize === binaryInfo.binaryByteSize) process.exit();
        });
      });
    });

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
};

// Parseo de argumentos y ejecución del programa
const { argv } = yargs
  .option('model', { alias: 'm', describe: 'Model', type: 'string', demandOption: true })
  .option('region', { alias: 'r', describe: 'Region', type: 'string', demandOption: true })
  .option('imei', { alias: 'i', describe: 'IMEI/Serial Number', type: 'string', demandOption: true })
  .version(packageVersion)
  .alias('v', 'version')
  .help();

main(argv.model, argv.region, argv.imei);
