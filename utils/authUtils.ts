// Importación del módulo `crypto` para operaciones criptográficas
import crypto from "crypto";

// Claves utilizadas para la encriptación y desencriptación
const NONCE_KEY = "vicopx7dqu06emacgpnpy8j8zwhduwlh"; // Clave de 32 caracteres
const AUTH_KEY = "9u7qab84rpc16gvk"; // Clave de autorización adicional

/**
 * Desencripta un nonce cifrado usando AES-256-CBC.
 *
 * @param nonceEncrypted - Nonce cifrado en formato Base64.
 * @returns El nonce desencriptado en formato texto.
 */
export const decryptNonce = (nonceEncrypted: string): string => {
  const nonceDecipher = crypto.createDecipheriv(
    "aes-256-cbc",           // Algoritmo de cifrado
    NONCE_KEY,               // Clave de cifrado
    NONCE_KEY.slice(0, 16)   // Vector de inicialización (primeros 16 bytes de la clave)
  );

  return Buffer.concat([
    nonceDecipher.update(nonceEncrypted, "base64"), // Desencriptar el nonce
    nonceDecipher.final(),
  ]).toString("utf-8");
};

/**
 * Genera un token de autorización basado en un nonce desencriptado.
 *
 * @param nonceDecrypted - Nonce desencriptado.
 * @returns Un string de autorización en Base64.
 */
export const getAuthorization = (nonceDecrypted: string): string => {
  let key = "";

  // Genera una clave dinámica basada en los caracteres del nonce
  for (let i = 0; i < 16; i += 1) {
    const nonceChar = nonceDecrypted.charCodeAt(i);
    key += NONCE_KEY[nonceChar % 16];
  }

  // Añadir la clave de autorización fija al final
  key += AUTH_KEY;

  // Cifrar el nonce usando la clave generada
  const authCipher = crypto.createCipheriv(
    "aes-256-cbc",           // Algoritmo de cifrado
    key,                     // Clave de cifrado
    key.slice(0, 16)         // Vector de inicialización
  );

  return Buffer.concat([
    authCipher.update(nonceDecrypted, "utf8"), // Encriptar el nonce desencriptado
    authCipher.final(),
  ]).toString("base64");
};

/**
 * Maneja la rotación de autenticación, desencripta el nonce y genera las cabeceras.
 *
 * @param responseHeaders - Cabeceras de respuesta que contienen el nonce.
 * @returns Un objeto con las cabeceras de autorización y los nonces.
 */
export const handleAuthRotation = (
  responseHeaders: Record<string, string>
): {
  Authorization: string;
  nonce: { decrypted: string; encrypted: string };
} => {
  const { nonce } = responseHeaders; // Extraer el nonce encriptado de las cabeceras
  const nonceDecrypted = decryptNonce(nonce); // Desencriptar el nonce
  const authorization = getAuthorization(nonceDecrypted); // Generar la autorización

  return {
    Authorization: `FUS nonce="${nonce}", signature="${authorization}", nc="", type="", realm="", newauth="1"`,
    nonce: {
      decrypted: nonceDecrypted, // Nonce desencriptado
      encrypted: nonce,          // Nonce original encriptado
    },
  };
};
