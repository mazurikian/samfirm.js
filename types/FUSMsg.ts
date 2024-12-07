export interface FUSMsg {
  FUSMsg: {
    FUSHdr: FUSHdr;
    FUSBody: FUSBody;
  };
}

export interface FUSHdr {
  ProtoVer: string;
}

export interface FUSBody {
  Put: FUSPut;
}

export interface FUSPut {
  ACCESS_MODE?: DataField<number>;
  BINARY_FILE_NAME?: DataField<string>;
  BINARY_NATURE?: DataField<number>;
  CLIENT_PRODUCT?: DataField<string>;
  CLIENT_VERSION?: DataField<string>;
  DEVICE_IMEI_PUSH?: DataField<string>;
  DEVICE_FW_VERSION?: DataField<string>;
  DEVICE_LOCAL_CODE?: DataField<string>;
  DEVICE_MODEL_NAME?: DataField<string>;
  LOGIC_CHECK?: DataField<string>;
}

export interface DataField<T> {
  Data: T;
}
