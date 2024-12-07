import crypto from 'crypto';

// Constantes para claves de encriptación
const NONCE_KEY = 'vicopx7dqu06emacgpnpy8j8zwhduwlh';
const AUTH_KEY = '9u7qab84rpc16gvk';

// Función para descifrar el nonce
export const decryptNonce = (nonceEncrypted: string): string => {
  const nonceDecipher = crypto.createDecipheriv('aes-256-cbc', NONCE_KEY, NONCE_KEY.slice(0, 16));
  const decrypted = Buffer.concat([
    nonceDecipher.update(nonceEncrypted, 'base64'),
    nonceDecipher.final(),
  ]);
  return decrypted.toString('utf-8');
};

// Función para generar el encabezado de autorización
export const getAuthorization = (nonceDecrypted: string): string => {
  let key = '';
  for (let i = 0; i < 16; i++) {
    const nonceChar = nonceDecrypted.charCodeAt(i);
    key += NONCE_KEY[nonceChar % 16];
  }
  key += AUTH_KEY;

  const authCipher = crypto.createCipheriv('aes-256-cbc', key, key.slice(0, 16));
  const authorization = Buffer.concat([
    authCipher.update(nonceDecrypted, 'utf8'),
    authCipher.final(),
  ]);

  return authorization.toString('base64');
};

// Manejo de rotación de autenticación y sesión
export const handleAuthRotation = (responseHeaders: Record<string, string>) => {
  const { nonce } = responseHeaders;
  const nonceDecrypted = decryptNonce(nonce);
  const authorization = getAuthorization(nonceDecrypted);

  return {
    Authorization: `FUS nonce="${nonce}", signature="${authorization}", nc="", type="", realm="", newauth="1"`,
    nonce: {
      decrypted: nonceDecrypted,
      encrypted: nonce,
    },
  };
};
