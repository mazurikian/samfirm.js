/**
 * Interface que define la estructura de un mensaje FUS (Firmware Update System).
 * Este mensaje se utiliza para interactuar con el sistema FUS mediante solicitudes XML.
 */
export interface FUSMsg {
  FUSMsg: {
    // Cabecera del mensaje, incluye información del protocolo.
    FUSHdr: {
      ProtoVer: string; // Versión del protocolo (e.g., "1.0").
    };
    // Cuerpo del mensaje, contiene los datos principales de la solicitud.
    FUSBody: {
      Put: {
        /**
         * Modo de acceso del cliente (opcional).
         * Ejemplo: 2 para descargas completas.
         */
        ACCESS_MODE?: {
          Data: number;
        };
        /**
         * Nombre del archivo binario solicitado (opcional).
         * Ejemplo: "firmware_update.zip".
         */
        BINARY_FILE_NAME?: {
          Data: string;
        };
        /**
         * Naturaleza del binario (opcional).
         * Ejemplo: 1 para firmware oficial.
         */
        BINARY_NATURE?: {
          Data: number;
        };
        /**
         * Producto del cliente que realiza la solicitud (opcional).
         * Ejemplo: "Smart Switch".
         */
        CLIENT_PRODUCT?: {
          Data: string;
        };
        /**
         * Versión del cliente que realiza la solicitud (opcional).
         * Ejemplo: "4.3.24062_1".
         */
        CLIENT_VERSION?: {
          Data: string;
        };
        /**
         * IMEI del dispositivo que realiza la solicitud (opcional).
         * Ejemplo: "123456789012345".
         */
        DEVICE_IMEI_PUSH?: {
          Data: string;
        };
        /**
         * Versión del firmware del dispositivo (opcional).
         * Ejemplo: "G970FXXS8FUB1".
         */
        DEVICE_FW_VERSION?: {
          Data: string;
        };
        /**
         * Código de región/localidad del dispositivo (opcional).
         * Ejemplo: "EU" o "USA".
         */
        DEVICE_LOCAL_CODE?: {
          Data: string;
        };
        /**
         * Nombre del modelo del dispositivo (opcional).
         * Ejemplo: "SM-G970F".
         */
        DEVICE_MODEL_NAME?: {
          Data: string;
        };
        /**
         * Valor de validación lógica utilizado para autenticar la solicitud (opcional).
         */
        LOGIC_CHECK?: {
          Data: string;
        };
      };
    };
  };
}
