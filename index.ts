#!/usr/bin/env node

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

// Constants for URLs and API endpoints
const FOTA_URL = 'https://fota-cloud-dn.ospserver.net/firmware';
const FUS_URL = 'https://neofussvr.sslcs.cdngc.net';
const CLOUD_NEOFUSSVR_URL = 'http://cloud-neofussvr.samsungmobile.com';
const USER_AGENT = 'Kies2.0_FUS';

const GENERATE_NONCE_URL = '/NF_DownloadGenerateNonce.do';
const DOWNLOAD_BINARY_INFORM_URL = '/NF_DownloadBinaryInform.do';
const DOWNLOAD_BINARY_INIT_URL = '/NF_DownloadBinaryInitForMass.do';
const DOWNLOAD_BINARY_URL = '/NF_DownloadBinaryForMass.do';

// Constants for encryption
const CIPHER_ALGORITHM = 'aes-128-ecb';
const CIPHER_MODE = null;  // ECB mode for encryption

// Constants for HTTP headers
const ACCEPT_HEADER = 'application/xml';
const CONTENT_TYPE_HEADER = 'application/xml';

// Constants for file paths
const OUTPUT_FOLDER = `${process.cwd()}/firmware_downloads/`;

// Type for version data
type FirmwareVersion = { pda: string; csc: string; modem: string };

// Fetch the latest firmware version for the given region and model
const getLatestVersion = async (region: string, model: string): Promise<FirmwareVersion> => {
  try {
    const response = await axios.get(`${FOTA_URL}/${region}/${model}/version.xml`);
    const parsedData = xmlParse(response.data);
    const [pda, csc, modem] = parsedData.versioninfo.firmware.version.latest.split('/');
    return { pda, csc, modem: modem || 'N/A' };
  } catch (error) {
    throw new Error(`Failed to fetch latest version: ${error.message}`);
  }
};

// Main function
const main = async (region: string, model: string, imei: string): Promise<void> => {
  try {
    console.log(`Model: ${model}\nRegion: ${region}\nIMEI: ${imei}`);

    const { pda, csc, modem } = await getLatestVersion(region, model);
    console.log(`\nLatest version:\nPDA: ${pda}\nCSC: ${csc}\nMODEM: ${modem}`);

    const nonce = { encrypted: '', decrypted: '' };
    const headers: Record<string, string> = { 'User-Agent': USER_AGENT };

    // Handle headers for authentication and session management
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

    // Fetch nonce for authentication
    await axios.post(`${FUS_URL}${GENERATE_NONCE_URL}`, '', {
      headers: {
        Authorization: 'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"',
        'User-Agent': USER_AGENT,
        Accept: ACCEPT_HEADER,
      },
    }).then((res) => {
      handleHeaders(res.headers);
    });

    // Fetch binary information
    const binaryInfo = await axios.post(`${FUS_URL}${DOWNLOAD_BINARY_INFORM_URL}`, getBinaryInformMsg(`${pda}/${csc}/${modem}/${pda}`, region, model, imei, nonce.decrypted), {
      headers: { ...headers, Accept: ACCEPT_HEADER, 'Content-Type': CONTENT_TYPE_HEADER },
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

    // Log binary info
    console.log(`\nOS: ${binaryInfo.binaryOSVersion}\nFilename: ${binaryInfo.binaryFilename}\nSize: ${binaryInfo.binaryByteSize} bytes\nLogic Value: ${binaryInfo.binaryLogicValue}\nDescription: ${binaryInfo.binaryDescription.split('\n').join('\n    ')}`);

    const decryptionKey = getDecryptionKey(binaryInfo.binaryVersion, binaryInfo.binaryLogicValue);

    // Start binary download
    await axios.post(`${FUS_URL}${DOWNLOAD_BINARY_INIT_URL}`, getBinaryInitMsg(binaryInfo.binaryFilename, nonce.decrypted), {
      headers: { ...headers, Accept: ACCEPT_HEADER, 'Content-Type': CONTENT_TYPE_HEADER },
    }).then((res) => {
      handleHeaders(res.headers);
    });

    const binaryDecipher = crypto.createDecipheriv(CIPHER_ALGORITHM, decryptionKey, CIPHER_MODE);

    await axios.get(`${CLOUD_NEOFUSSVR_URL}${DOWNLOAD_BINARY_URL}?file=${binaryInfo.binaryModelPath}${binaryInfo.binaryFilename}`, {
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

// Command-line argument parsing and execution
const { argv } = yargs
  .option('model', { alias: 'm', describe: 'Model', type: 'string', demandOption: true })
  .option('region', { alias: 'r', describe: 'Region', type: 'string', demandOption: true })
  .option('imei', { alias: 'i', describe: 'IMEI/Serial Number', type: 'string', demandOption: true })
  .version(packageVersion)
  .alias('v', 'version')
  .help();

main(argv.region, argv.model, argv.imei);
