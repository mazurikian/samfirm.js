const crypto = require("crypto");
const { XMLBuilder } = require("fast-xml-parser");

const parser = new XMLBuilder({});

/**
 * STEP 1: Generate a message to initialize the binary download process.
 *
 * @param {string} filename - Name of the binary file.
 * @param {string} nonce - Decrypted nonce used for logic check.
 * @returns {string} - The generated XML message.
 */
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
  return parser.build(msg); // Convert the message object to XML string
};

/**
 * STEP 2: Generate a message to request binary information.
 *
 * @param {string} version - Firmware version.
 * @param {string} region - Region code.
 * @param {string} model - Model name.
 * @param {string} imei - Device IMEI.
 * @param {string} nonce - Decrypted nonce.
 * @returns {string} - The generated XML message.
 */
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
  return parser.build(msg); // Convert the message object to XML string
};

/**
 * STEP 3: Generate a decryption key for binary decryption.
 *
 * @param {string} version - Firmware version.
 * @param {string} logicalValue - Logical value for the firmware.
 * @returns {Buffer} - Decryption key in Buffer format.
 */
const getDecryptionKey = (version, logicalValue) => {
  return crypto
    .createHash("md5")
    .update(getLogicCheck(version, logicalValue))
    .digest(); // Return the MD5 digest
};

/**
 * STEP 4: Generate a logic check string based on input and nonce.
 *
 * @param {string} input - Input string.
 * @param {string} nonce - Decrypted nonce.
 * @returns {string} - Logic check string.
 */
const getLogicCheck = (input, nonce) => {
  return Array.from(nonce)
    .map((char) => input[char.charCodeAt(0) & 0xf])
    .join("");
};

module.exports = { getBinaryInformMsg, getBinaryInitMsg, getDecryptionKey };
