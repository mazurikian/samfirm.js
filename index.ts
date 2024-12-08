#!/usr/bin/env node

import axios, { AxiosResponse, AxiosResponseHeaders } from "axios";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import cliProgress from "cli-progress";
import yargs from "yargs";
import { XMLParser } from "fast-xml-parser";
import unzip from "unzip-stream";

import { handleAuthRotation } from "./utils/authUtils";
import {
  getBinaryInformMsg,
  getBinaryInitMsg,
  getDecryptionKey,
} from "./utils/msgUtils";

type FirmwareVersion = { pda: string; csc: string; modem: string };

const xmlParser = new XMLParser();

const getLatestVersion = async (
  region: string,
  model: string,
): Promise<FirmwareVersion> => {
  try {
    const response = await axios.get(
      `https://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`,
    );
    const parsedData = xmlParser.parse(response.data);
    const [pda, csc, modem] =
      parsedData.versioninfo.firmware.version.latest.split("/");
    return { pda, csc, modem: modem || "N/A" };
  } catch (error: unknown) {
    if (error instanceof Error) {
      throw new Error(`Failed to fetch latest version: ${error.message}`);
    }
    throw new Error("Unknown error occurred");
  }
};

const downloadFirmware = async (
  region: string,
  model: string,
  imei: string,
): Promise<void> => {
  try {
    console.log(
      `Fetching firmware for model: ${model}, region: ${region}, IMEI: ${imei}`,
    );

    const { pda, csc, modem } = await getLatestVersion(region, model);
    console.log(
      `Latest Firmware Versions - PDA: ${pda}, CSC: ${csc}, MODEM: ${modem}`,
    );

    const nonce = { encrypted: "", decrypted: "" };
    const headers: Record<string, string> = { "User-Agent": "Kies2.0_FUS" };

    const handleHeaders = (responseHeaders: AxiosResponseHeaders) => {
      if (responseHeaders.nonce) {
        const { Authorization, nonce: newNonce } =
          handleAuthRotation(responseHeaders);
        Object.assign(nonce, newNonce);
        headers.Authorization = Authorization;
      }
      const cookies = responseHeaders["set-cookie"];
      if (Array.isArray(cookies)) {
        const sessionID = cookies
          .find((cookie: string) => cookie.startsWith("JSESSIONID"))
          ?.split(";")[0];
        if (sessionID) headers.Cookie = sessionID;
      }
    };

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
      .then((res) => handleHeaders(res.headers as AxiosResponseHeaders));

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
        handleHeaders(res.headers as AxiosResponseHeaders);
        const parsedInfo = xmlParser.parse(res.data);
        return {
          binaryByteSize: parsedInfo.FUSMsg.FUSBody.Put.BINARY_BYTE_SIZE.Data,
          binaryDescription: parsedInfo.FUSMsg.FUSBody.Put.DESCRIPTION.Data,
          binaryFilename: parsedInfo.FUSMsg.FUSBody.Put.BINARY_NAME.Data,
          binaryLogicValue:
            parsedInfo.FUSMsg.FUSBody.Put.LOGIC_VALUE_FACTORY.Data,
          binaryModelPath: parsedInfo.FUSMsg.FUSBody.Put.MODEL_PATH.Data,
          binaryOSVersion:
            parsedInfo.FUSMsg.FUSBody.Put.CURRENT_OS_VERSION.Data,
          binaryVersion:
            parsedInfo.FUSMsg.FUSBody.Results.LATEST_FW_VERSION.Data,
        };
      });

    console.log(
      `Binary Information: OS - ${binaryInfo.binaryOSVersion}, Filename - ${binaryInfo.binaryFilename}`,
    );

    const decryptionKey = getDecryptionKey(
      binaryInfo.binaryVersion,
      binaryInfo.binaryLogicValue,
    );

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
      .then((res) => handleHeaders(res.headers as AxiosResponseHeaders));

    const binaryDecipher = crypto.createDecipheriv(
      "aes-128-ecb",
      decryptionKey,
      null,
    );

    await axios
      .get(
        `http://cloud-neofussvr.samsungmobile.com/NF_DownloadBinaryForMass.do?file=${binaryInfo.binaryModelPath}${binaryInfo.binaryFilename}`,
        { headers, responseType: "stream" },
      )
      .then((res: AxiosResponse) => {
        const outputFolder = `${process.cwd()}/${model}_${region}/`;
        fs.mkdirSync(outputFolder, { recursive: true });

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
        progressBar.start(binaryInfo.binaryByteSize, downloadedSize);

        return res.data
          .on("data", (buffer: Buffer) => {
            downloadedSize += buffer.length;
            progressBar.update(downloadedSize, { file: currentFile });
          })
          .pipe(binaryDecipher)
          .pipe(unzip.Parse())
          .on("entry", (entry: unzip.Entry) => {
            currentFile = `${entry.path.slice(0, 18)}...`;
            progressBar.update(downloadedSize, { file: currentFile });
            entry
              .pipe(fs.createWriteStream(path.join(outputFolder, entry.path)))
              .on("finish", () => {
                if (downloadedSize === binaryInfo.binaryByteSize) {
                  process.exit();
                }
              });
          });
      });
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error("Error:", error.message);
    } else {
      console.error("Unknown error occurred");
    }
    process.exit(1);
  }
};

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
  .help() as { argv: { model: string; region: string; imei: string } };

downloadFirmware(argv.region, argv.model, argv.imei);
