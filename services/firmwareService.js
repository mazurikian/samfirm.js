const axios = require("axios");
const { parseLatestFirmwareVersion } = require("../utils/xmlUtils");

const getLatestFirmwareVersion = async (region, model) => {
  try {
    const response = await axios.get(
      `http://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`,
    );
    return parseLatestFirmwareVersion(response.data);
  } catch (error) {
    throw new Error(`Failed to fetch latest version: ${error.message}`);
  }
};

module.exports = {
  getLatestFirmwareVersion,
};
