const crypto = require("crypto");
const { XMLBuilder } = require("fast-xml-parser");

const parser = new XMLBuilder({});

const getLogicCheck = (input, nonce) => {
  return Array.from(nonce)
    .map((char) => input[char.charCodeAt(0) & 0xf])
    .join("");
};

const getBinaryInformMsg = (version, region, model, imei, nonce) => {
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

const getBinaryInitMsg = (filename, nonce) => {
  const msg = {
    FUSMsg: {
      FUSHdr: { ProtoVer: "1.0" },
      FUSBody: {
        Put: {
          BINARY_FILE_NAME: { Data: filename },
          LOGIC_CHECK: {
            Data: getLogicCheck(filename.split(".")[0].slice(-16), nonce),
          },
        },
      },
    },
  };
  return parser.build(msg);
};

const getDecryptionKey = (version, logicalValue) => {
  return crypto
    .createHash("md5")
    .update(getLogicCheck(version, logicalValue))
    .digest();
};

module.exports = { getBinaryInformMsg, getBinaryInitMsg, getDecryptionKey };
