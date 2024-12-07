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

// Type for version data
type FirmwareVersion = { pda: string; csc: string; modem: string };

// Fetch the latest firmware version for the given region and model
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

// Function to handle headers and manage authentication
const handleHeaders = (responseHeaders: Record<string, string>, nonce: { encrypted: string; decrypted: string }, headers: Record<string, string>) => {
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

// Function to download binary data and handle decompression
const downloadBinary = async (binaryInfo: any, decryptionKey: Buffer, outputFolder: string, headers: Record<string, string>) => {
  const binaryDecipher = crypto.createDecipheriv('aes-128-ecb', decryptionKey, null);

  const res = await axios.get(`http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryInfo.binaryModelPath}${binaryInfo.binaryFilename}`, {
    headers,
    responseType: 'stream',
  });

  let downloadedSize = 0;
  const progressBar = new cliProgress.SingleBar({ format: '{bar} {percentage}% | {value}/{total} | {file}', barCompleteChar: '\u2588', barIncompleteChar: '\u2591' });
  progressBar.start(binaryInfo.binaryByteSize, downloadedSize);

  res.data.on('data', (buffer: Buffer) => {
    downloadedSize += buffer.length;
    progressBar.update(downloadedSize);
  }).pipe(binaryDecipher).pipe(unzip.Parse()).on('entry', (entry) => {
    const currentFile = `${entry.path.slice(0, 18)}...`;
    progressBar.update(downloadedSize, { file: currentFile });
    entry.pipe(fs.createWriteStream(path.join(outputFolder, entry.path)));
  });

  return new Promise<void>((resolve, reject) => {
    res.data.on('end', () => {
      progressBar.stop();
      resolve();
    });

    res.data.on('error', reject);
  });
};

// Main function
const main = async (region: string, model: string, imei: string): Promise<void> => {
  try {
    console.log(`Model: ${model}\nRegion: ${region}\nIMEI: ${imei}`);

    // Fetch the latest firmware version and the binary info in parallel
    const { pda, csc, modem } = await getLatestVersion(region, model);
    console.log(`\nLatest version:\nPDA: ${pda}\nCSC: ${csc}\nMODEM: ${modem}`);

    const nonce = { encrypted: '', decrypted: '' };
    const headers: Record<string, string> = { 'User-Agent': 'Kies2.0_FUS' };

    // Fetch nonce and binary information in parallel
    await axios.post(`https://neofussvr.sslcs.cdngc.net/NF_DownloadGenerateNonce.do`, '', {
      headers: { Authorization: 'FUS nonce="", signature="", nc="", type="", realm="", newauth="1"', 'User-Agent': 'Kies2.0_FUS', Accept: 'application/xml' },
    }).then((res) => handleHeaders(res.headers, nonce, headers));

    const binaryInfo = await axios.post(`https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do`, getBinaryInformMsg(`${pda}/${csc}/${modem}/${pda}`, region, model, imei, nonce.decrypted), {
      headers: { ...headers, Accept: 'application/xml', 'Content-Type': 'application/xml' },
    }).then((res) => {
      handleHeaders(res.headers, nonce, headers);
      const parsedInfo = xmlParse(res.data);
      return {
        binaryByteSize: parsedInfo.FUSMsg.FUSBody.Put.BINARY_BYTE_SIZE.Data,
        binaryFilename: parsedInfo.FUSMsg.FUSBody.Put.BINARY_NAME.Data,
        binaryModelPath: parsedInfo.FUSMsg.FUSBody.Put.MODEL_PATH.Data,
        binaryVersion: parsedInfo.FUSMsg.FUSBody.Results.LATEST_FW_VERSION.Data,
        binaryLogicValue: parsedInfo.FUSMsg.FUSBody.Put.LOGIC_VALUE_FACTORY.Data,
      };
    });

    console.log(`\nOS: ${binaryInfo.binaryOSVersion}\nFilename: ${binaryInfo.binaryFilename}\nSize: ${binaryInfo.binaryByteSize} bytes\nLogic Value: ${binaryInfo.binaryLogicValue}`);

    const decryptionKey = getDecryptionKey(binaryInfo.binaryVersion, binaryInfo.binaryLogicValue);

    // Start binary download
    const outputFolder = `${process.cwd()}/${model}_${region}/`;
    fs.mkdirSync(outputFolder, { recursive: true });

    await downloadBinary(binaryInfo, decryptionKey, outputFolder, headers);
    console.log('Download complete!');

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
