import crypto from "crypto";

const NONCE_KEY = "vicopx7dqu06emacgpnpy8j8zwhduwlh";
const AUTH_KEY = "9u7qab84rpc16gvk";

const AES_ALGORITHM = "aes-256-cbc";

// Función para descifrar el nonce encriptado
export const decryptNonce = (nonceEncrypted: string): string => {
  try {
    const nonceDecipher = crypto.createDecipheriv(
      AES_ALGORITHM,
      Buffer.from(NONCE_KEY, "utf-8"),
      Buffer.from(NONCE_KEY.slice(0, 16), "utf-8")
    );

    const decryptedBuffer = Buffer.concat([
      nonceDecipher.update(Buffer.from(nonceEncrypted, "base64")),
      nonceDecipher.final(),
    ]);

    return decryptedBuffer.toString("utf-8");
  } catch (error) {
    throw new Error("Failed to decrypt nonce: " + error.message);
  }
};

// Función para obtener la autorización (cifrado) a partir del nonce descifrado
export const getAuthorization = (nonceDecrypted: string): string => {
  try {
    let key = "";
    for (let i = 0; i < 16; i += 1) {
      const nonceChar = nonceDecrypted.charCodeAt(i);
      key += NONCE_KEY[nonceChar % NONCE_KEY.length];
    }

    key += AUTH_KEY;

    const authCipher = crypto.createCipheriv(
      AES_ALGORITHM,
      Buffer.from(key, "utf-8"),
      Buffer.from(key.slice(0, 16), "utf-8")
    );

    const encryptedBuffer = Buffer.concat([
      authCipher.update(Buffer.from(nonceDecrypted, "utf-8")),
      authCipher.final(),
    ]);

    return encryptedBuffer.toString("base64");
  } catch (error) {
    throw new Error("Failed to generate authorization: " + error.message);
  }
};

// Función para manejar la rotación de autenticación
export const handleAuthRotation = (
  responseHeaders: Record<string, string>
): {
  Authorization: string;
  nonce: { decrypted: string; encrypted: string };
} => {
  const { nonce } = responseHeaders;

  try {
    const nonceDecrypted = decryptNonce(nonce);
    const authorization = getAuthorization(nonceDecrypted);

    return {
      Authorization: `FUS nonce="${nonce}", signature="${authorization}", nc="", type="", realm="", newauth="1"`,
      nonce: {
        decrypted: nonceDecrypted,
        encrypted: nonce,
      },
    };
  } catch (error) {
    throw new Error("Failed to handle authentication rotation: " + error.message);
  }
};
