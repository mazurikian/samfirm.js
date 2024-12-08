import crypto from "crypto";
import { XMLBuilder } from "fast-xml-parser";

const parser = new XMLBuilder({});

const getLogicCheck = (input: string, nonce: string): string => {
  return Array.from(nonce).map((char, i) => input[char.charCodeAt(0) & 0xf]).join('');
};

export const getBinaryInformMsg = (version: string, region: string, model: string, imei: string, nonce: string): string => {
  const msg = {
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
          LOGIC_CHECK: { Data: getLogicCheck(version, nonce) },
        },
      },
    },
  };
  return parser.build(msg);
};

export const getBinaryInitMsg = (filename: string, nonce: string): string => {
  const msg = {
    FUSMsg: {
      FUSHdr: { ProtoVer: "1.0" },
      FUSBody: {
        Put: {
          BINARY_FILE_NAME: { Data: filename },
          LOGIC_CHECK: { Data: getLogicCheck(filename.split(".")[0].slice(-16), nonce) },
        },
      },
    },
  };
  return parser.build(msg);
};

export const getDecryptionKey = (version: string, logicalValue: string): Buffer => {
  return crypto.createHash("md5").update(getLogicCheck(version, logicalValue)).digest();
};
