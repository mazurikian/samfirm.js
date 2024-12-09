const crypto = require("crypto");
const { XMLBuilder } = require("fast-xml-parser");

const parser = new XMLBuilder({});

/**
 * Generate the message to initialize the download for a binary file.
 *
 * @param {string} filename - The name of the binary file to be downloaded.
 * @param {string} nonce - The decrypted nonce used to generate the logic check.
 * @returns {string} - The generated XML message.
 */
const getBinaryInitMsg = (filename, nonce) => {
  const msg = {
    FUSMsg: {
      FUSHdr: { ProtoVer: "1.0" },
      FUSBody: {
        Put: {
          BINARY_FILE_NAME: { Data: filename }, // File name of the binary
          LOGIC_CHECK: {
            Data: getLogicCheck(filename.split(".")[0].slice(-16), nonce), // Logic check based on file name and nonce
          },
        },
      },
    },
  };
  return parser.build(msg); // Convert the message object to an XML string
};

/**
 * Generate the message to request information about the binary file to be downloaded.
 *
 * @param {string} version - The firmware version.
 * @param {string} region - The region code.
 * @param {string} model - The model name.
 * @param {string} imei - The device IMEI.
 * @param {string} nonce - The decrypted nonce used to generate the logic check.
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
          DEVICE_IMEI_PUSH: { Data: imei }, // Device IMEI
          DEVICE_FW_VERSION: { Data: version }, // Firmware version
          DEVICE_LOCAL_CODE: { Data: region }, // Region code
          DEVICE_MODEL_NAME: { Data: model }, // Model name
          LOGIC_CHECK: { Data: getLogicCheck(version, nonce) }, // Logic check based on version and nonce
        },
      },
    },
  };
  return parser.build(msg); // Convert the message object to an XML string
};

/**
 * Generate the decryption key used for decrypting the binary file.
 *
 * @param {string} version - The firmware version.
 * @param {string} logicalValue - The logical value for the firmware.
 * @returns {Buffer} - The decryption key in Buffer format.
 */
const getDecryptionKey = (version, logicalValue) => {
  return crypto
    .createHash("md5")
    .update(getLogicCheck(version, logicalValue)) // Generate hash from the logic check
    .digest(); // Return the MD5 digest
};

/**
 * Generate the logic check string based on the provided input and nonce.
 *
 * @param {string} input - The input string used for the logic check.
 * @param {string} nonce - The decrypted nonce.
 * @returns {string} - The generated logic check string.
 */
const getLogicCheck = (input, nonce) => {
  return Array.from(nonce)
    .map((char) => input[char.charCodeAt(0) & 0xf]) // Map nonce characters to the input string
    .join(""); // Join the characters to form the logic check string
};

module.exports = { getBinaryInformMsg, getBinaryInitMsg, getDecryptionKey };
