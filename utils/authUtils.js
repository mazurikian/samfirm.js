const crypto = require("crypto");

const AUTH_KEY = "9u7qab84rpc16gvk"; // Key used for generating the authorization header
const NONCE_KEY = "vicopx7dqu06emacgpnpy8j8zwhduwlh"; // Key used for decrypting the nonce

/**
 * Decrypt the encrypted nonce using AES-256-CBC algorithm and a specific nonce key.
 *
 * @param {string} nonceEncrypted - The encrypted nonce in base64 format.
 * @returns {string} - The decrypted nonce in UTF-8 format.
 */
const decryptNonce = (nonceEncrypted) => {
  const nonceDecipher = crypto.createDecipheriv(
    "aes-256-cbc",
    NONCE_KEY,
    NONCE_KEY.slice(0, 16), // Using the first 16 bytes of the NONCE_KEY as the IV
  );
  return Buffer.concat([
    nonceDecipher.update(nonceEncrypted, "base64"),
    nonceDecipher.final(),
  ]).toString("utf-8");
};

/**
 * Generate an authorization header value using the decrypted nonce.
 *
 * @param {string} nonceDecrypted - The decrypted nonce value.
 * @returns {string} - The generated authorization header in base64 format.
 */
const getAuthorization = (nonceDecrypted) => {
  let key = "";
  for (let i = 0; i < 16; i++) {
    const nonceChar = nonceDecrypted.charCodeAt(i);
    key += NONCE_KEY[nonceChar % 16]; // Mapping the characters of the nonce to the key
  }
  key += AUTH_KEY; // Appending the static AUTH_KEY for final authorization

  const authCipher = crypto.createCipheriv(
    "aes-256-cbc",
    key,
    key.slice(0, 16), // Using the first 16 bytes of the generated key as the IV
  );
  return Buffer.concat([
    authCipher.update(nonceDecrypted, "utf8"),
    authCipher.final(),
  ]).toString("base64"); // Returning the final authorization header in base64 format
};

/**
 * Handle the rotation of authorization by decrypting the nonce and generating the new authorization header.
 *
 * @param {object} responseHeaders - The response headers from the server.
 * @returns {object} - An object containing the Authorization header and the decrypted nonce.
 */
const handleAuthRotation = (responseHeaders) => {
  const { nonce } = responseHeaders; // Extract the nonce from response headers
  const nonceDecrypted = decryptNonce(nonce); // Decrypt the nonce
  const authorization = getAuthorization(nonceDecrypted); // Generate the authorization header
  return {
    Authorization: `FUS nonce="${nonce}", signature="${authorization}", nc="", type="", realm="", newauth="1"`, // Format the authorization header
    nonce: { decrypted: nonceDecrypted, encrypted: nonce },
  };
};

module.exports = { handleAuthRotation };
