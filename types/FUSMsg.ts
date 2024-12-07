// Definición de la interfaz FUSMsg
export interface FUSMsg {
  FUSMsg: {
    // Cabecera del mensaje
    FUSHdr: {
      ProtoVer: string; // Versión del protocolo
    };

    // Cuerpo del mensaje
    FUSBody: {
      Put: {
        // Propiedades opcionales que se pueden incluir en el cuerpo del mensaje
        ACCESS_MODE?: {
          Data: number; // Modo de acceso
        };
        BINARY_FILE_NAME?: {
          Data: string; // Nombre del archivo binario
        };
        BINARY_NATURE?: {
          Data: number; // Naturaleza del binario
        };
        CLIENT_PRODUCT?: {
          Data: string; // Producto cliente
        };
        CLIENT_VERSION?: {
          Data: string; // Versión del cliente
        };
        DEVICE_IMEI_PUSH?: {
          Data: string; // IMEI del dispositivo
        };
        DEVICE_FW_VERSION?: {
          Data: string; // Versión del firmware del dispositivo
        };
        DEVICE_LOCAL_CODE?: {
          Data: string; // Código regional del dispositivo
        };
        DEVICE_MODEL_NAME?: {
          Data: string; // Nombre del modelo del dispositivo
        };
        LOGIC_CHECK?: {
          Data: string; // Verificación lógica
        };
      };
    };
  };
}
