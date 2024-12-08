const { XMLParser } = require("fast-xml-parser");

const xmlParser = new XMLParser();

const parseBinaryInfo = (data) => {
  const parsedInfo = xmlParser.parse(data);

  return {
    binaryByteSize: parsedInfo.FUSMsg.FUSBody.Put.BINARY_BYTE_SIZE.Data,
    binaryDescription: parsedInfo.FUSMsg.FUSBody.Put.DESCRIPTION.Data,
    binaryFilename: parsedInfo.FUSMsg.FUSBody.Put.BINARY_NAME.Data,
    binaryLogicValue: parsedInfo.FUSMsg.FUSBody.Put.LOGIC_VALUE_FACTORY.Data,
    binaryModelPath: parsedInfo.FUSMsg.FUSBody.Put.MODEL_PATH.Data,
    binaryOSVersion: parsedInfo.FUSMsg.FUSBody.Put.CURRENT_OS_VERSION.Data,
    binaryVersion: parsedInfo.FUSMsg.FUSBody.Results.LATEST_FW_VERSION.Data,
  };
};

const parseLatestFirmwareVersion = (data) => {
  const parsedData = xmlParser.parse(data);
  const [pda, csc, modem] =
    parsedData.versioninfo.firmware.version.latest.split("/");
  return { pda, csc, modem: modem || "N/A" };
};

module.exports = { parseBinaryInfo, parseLatestFirmwareVersion };