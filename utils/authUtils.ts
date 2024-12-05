import crypto from "crypto";
import { j2xParser } from "fast-xml-parser";

import type { FUSMsg } from "../types/FUSMsg";

// Instancia del parser para convertir objetos a XML
const parser = new j2xParser({});

/**
 * Genera un valor lógico en base a una cadena de entrada y un nonce.
 * @param {string} input - Cadena de entrada (por ejemplo, versión o nombre de archivo).
 * @param {string} nonce - Valor nonce proporcionado.
 * @returns {string} - Cadena lógica generada.
 */
const generateLogicalCheck = (input: string, nonce: string): string => {
  if (!input || !nonce) {
    throw new Error("El input y el nonce son obligatorios para el cálculo lógico.");
  }

  let result = "";

  for (let i = 0; i < nonce.length; i++) {
    const charCode = nonce.charCodeAt(i);
    result += input[charCode & 0xf];
  }

  return result;
};

/**
 * Construye un mensaje FUS basado en un cuerpo dado.
 * @param {Record<string, any>} body - Cuerpo del mensaje FUS.
 * @returns {string} - Mensaje FUS en formato XML.
 */
const buildFUSMessage = (body: Record<string, any>): string => {
  const msg: FUSMsg = {
    FUSMsg: {
      FUSHdr: {
        ProtoVer: "1.0",
      },
      FUSBody: body,
    },
  };

  return parser.parse(msg);
};

/**
 * Genera el mensaje `BinaryInform`.
 * @param {string} version - Versión del firmware.
 * @param {string} region - Código de región.
 * @param {string} model - Modelo del dispositivo.
 * @param {string} imei - IMEI o número de serie del dispositivo.
 * @param {string} nonce - Nonce proporcionado.
 * @returns {string} - Mensaje en formato XML.
 */
export const getBinaryInformMsg = (
  version: string,
  region: string,
  model: string,
  imei: string,
  nonce: string
): string => {
  if (!version || !region || !model || !imei || !nonce) {
    throw new Error("Todos los parámetros son obligatorios para construir el mensaje BinaryInform.");
  }

  const body = {
    Put: {
      ACCESS_MODE: { Data: 2 },
      BINARY_NATURE: { Data: 1 },
      CLIENT_PRODUCT: { Data: "Smart Switch" },
      CLIENT_VERSION: { Data: "4.3.24062_1" },
      DEVICE_IMEI_PUSH: { Data: imei },
      DEVICE_FW_VERSION: { Data: version },
      DEVICE_LOCAL_CODE: { Data: region },
      DEVICE_MODEL_NAME: { Data: model },
      LOGIC_CHECK: { Data: generateLogicalCheck(version, nonce) },
    },
  };

  return buildFUSMessage(body);
};

/**
 * Genera el mensaje `BinaryInit`.
 * @param {string} filename - Nombre del archivo binario.
 * @param {string} nonce - Nonce proporcionado.
 * @returns {string} - Mensaje en formato XML.
 */
export const getBinaryInitMsg = (filename: string, nonce: string): string => {
  if (!filename || !nonce) {
    throw new Error("El nombre del archivo y el nonce son obligatorios para construir el mensaje BinaryInit.");
  }

  const body = {
    Put: {
      BINARY_FILE_NAME: { Data: filename },
      LOGIC_CHECK: {
        Data: generateLogicalCheck(filename.split(".")[0].slice(-16), nonce),
      },
    },
  };

  return buildFUSMessage(body);
};

/**
 * Genera la llave de descifrado basada en la versión y el valor lógico.
 * @param {string} version - Versión del firmware.
 * @param {string} logicalValue - Valor lógico calculado.
 * @returns {Buffer} - Llave de descifrado.
 */
export const getDecryptionKey = (version: string, logicalValue: string): Buffer => {
  if (!version || !logicalValue) {
    throw new Error("La versión y el valor lógico son obligatorios para generar la llave de descifrado.");
  }

  const logicCheck = generateLogicalCheck(version, logicalValue);

  return crypto.createHash("md5").update(logicCheck).digest();
};
