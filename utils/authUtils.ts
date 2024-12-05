import crypto from "crypto";

// Claves de encriptación
const NONCE_KEY = "vicopx7dqu06emacgpnpy8zwhduwlh"; // Clave usada para desencriptar el nonce
const AUTH_KEY = "9u7qab84rpc16gvk"; // Clave para generar el token de autorización

/**
 * Desencripta el nonce recibido en la respuesta del servidor.
 * @param nonceEncrypted - Nonce cifrado recibido del servidor.
 * @returns Nonce desencriptado como string.
 * @throws Error si ocurre un fallo en la desencriptación.
 */
export const decryptNonce = (nonceEncrypted: string): string => {
  try {
    const nonceDecipher = crypto.createDecipheriv(
      "aes-256-cbc",
      NONCE_KEY,
      NONCE_KEY.slice(0, 16) // El IV debe ser de 16 bytes
    );

    const decrypted = Buffer.concat([
      nonceDecipher.update(nonceEncrypted, "base64"),
      nonceDecipher.final(),
    ]);

    return decrypted.toString("utf-8");
  } catch (error) {
    throw new Error("Error al desencriptar el nonce: " + error.message);
  }
};

/**
 * Genera el token de autorización basado en el nonce desencriptado.
 * @param nonceDecrypted - Nonce desencriptado.
 * @returns Token de autorización en base64.
 * @throws Error si ocurre un fallo al generar el token.
 */
export const getAuthorization = (nonceDecrypted: string): string => {
  try {
    let key = "";

    // Genera la clave de autorización basada en el nonce desencriptado
    for (let i = 0; i < 16; i++) {
      const nonceChar = nonceDecrypted.charCodeAt(i);
      key += NONCE_KEY[nonceChar % 16];
    }
    key += AUTH_KEY;

    const authCipher = crypto.createCipheriv(
      "aes-256-cbc",
      key,
      key.slice(0, 16) // El IV debe ser de 16 bytes
    );

    const encryptedAuth = Buffer.concat([
      authCipher.update(nonceDecrypted, "utf8"),
      authCipher.final(),
    ]);

    return encryptedAuth.toString("base64");
  } catch (error) {
    throw new Error("Error al generar el token de autorización: " + error.message);
  }
};

/**
 * Procesa las cabeceras de respuesta y rota el nonce y la autorización.
 * @param responseHeaders - Cabeceras de la respuesta del servidor.
 * @returns Objeto con la cabecera de autorización y el nonce actualizado.
 * @throws Error si el nonce no está presente o hay un fallo en el proceso.
 */
export const handleAuthRotation = (
  responseHeaders: Record<string, string>
): {
  Authorization: string;
  nonce: { decrypted: string; encrypted: string };
} => {
  try {
    const nonce = responseHeaders.nonce;
    if (!nonce) {
      throw new Error("No se encontró el nonce en las cabeceras de la respuesta.");
    }

    // Desencripta el nonce recibido
    const nonceDecrypted = decryptNonce(nonce);

    // Genera la cabecera de autorización
    const authorization = getAuthorization(nonceDecrypted);

    return {
      Authorization: `FUS nonce="${nonce}", signature="${authorization}", nc="", type="", realm="", newauth="1"`,
      nonce: {
        decrypted: nonceDecrypted,
        encrypted: nonce,
      },
    };
  } catch (error) {
    throw new Error("Error al manejar la rotación de autenticación: " + error.message);
  }
};
