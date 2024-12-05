// Importación de módulos necesarios
import crypto from "crypto";
import { j2xParser } from "fast-xml-parser"; // Convertidor JSON -> XML

// Tipo de dato que representa un mensaje FUS
import type { FUSMsg } from "../types/FUSMsg";

// Inicializa un parser para convertir JSON a XML
const parser = new j2xParser({});

/**
 * Genera una lógica de validación (Logic Check) basada en un nonce.
 *
 * @param input - Cadena base (como versión o nombre de archivo).
 * @param nonce - Nonce utilizado para la validación.
 * @returns La cadena generada como lógica de validación.
 */
const getLogicCheck = (input: string, nonce: string) => {
  let out = "";

  // Combina caracteres del `input` basándose en los valores ASCII del `nonce`
  for (let i = 0; i < nonce.length; i++) {
    const char: number = nonce.charCodeAt(i);
    out += input[char & 0xf]; // Selecciona un carácter basado en el índice calculado
  }

  return out;
};

/**
 * Crea un mensaje de solicitud de información binaria en formato XML.
 *
 * @param version - Versión del firmware.
 * @param region - Código de región.
 * @param model - Modelo del dispositivo.
 * @param imei - IMEI del dispositivo.
 * @param nonce - Nonce utilizado en la lógica de validación.
 * @returns El mensaje XML como string.
 */
export const getBinaryInformMsg = (
  version: string,
  region: string,
  model: string,
  imei: string,
  nonce: string
): string => {
  const msg: FUSMsg = {
    FUSMsg: {
      FUSHdr: {
        ProtoVer: "1.0", // Versión del protocolo
      },
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
          LOGIC_CHECK: { Data: getLogicCheck(version, nonce) }, // Validación lógica
        },
      },
    },
  };

  return parser.parse(msg); // Convertir el mensaje a XML
};

/**
 * Crea un mensaje de inicialización de descarga en formato XML.
 *
 * @param filename - Nombre del archivo binario.
 * @param nonce - Nonce utilizado en la lógica de validación.
 * @returns El mensaje XML como string.
 */
export const getBinaryInitMsg = (filename: string, nonce: string): string => {
  const msg: FUSMsg = {
    FUSMsg: {
      FUSHdr: {
        ProtoVer: "1.0",
      },
      FUSBody: {
        Put: {
          BINARY_FILE_NAME: { Data: filename },
          LOGIC_CHECK: {
            Data: getLogicCheck(filename.split(".")[0].slice(-16), nonce), // Validación lógica
          },
        },
      },
    },
  };

  return parser.parse(msg); // Convertir el mensaje a XML
};

/**
 * Genera una clave de desencriptación basada en la versión del firmware y un valor lógico.
 *
 * @param version - Versión del firmware.
 * @param logicalValue - Valor lógico para la validación.
 * @returns Un buffer que representa la clave de desencriptación.
 */
export const getDecryptionKey = (
  version: string,
  logicalValue: string
): Buffer => {
  return crypto
    .createHash("md5") // Crea un hash MD5
    .update(getLogicCheck(version, logicalValue)) // Actualiza el hash con la lógica de validación
    .digest(); // Genera la clave como un buffer
};
