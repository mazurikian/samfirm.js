const { handleAuthRotation } = require("../utils/authUtils");

const updateHeaders = (responseHeaders, headers, nonceState) => {
  if (responseHeaders.nonce) {
    const { Authorization, nonce: newNonce } =
      handleAuthRotation(responseHeaders);
    Object.assign(nonceState, newNonce);
    headers.Authorization = Authorization;
  }

  const cookies = responseHeaders["set-cookie"];
  if (Array.isArray(cookies)) {
    const sessionID = cookies
      .find((cookie) => cookie.startsWith("JSESSIONID"))
      ?.split(";")[0];
    if (sessionID) headers.Cookie = sessionID;
  }
};

module.exports = {
  updateHeaders,
};
