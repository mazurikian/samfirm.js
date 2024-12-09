document.getElementById('download-form').addEventListener('submit', function (event) {
    event.preventDefault();

    const imei = document.getElementById('imei').value;
    const model = document.getElementById('model').value;
    const region = document.getElementById('region').value;
    
    downloadFirmware(region, model, imei);
});

const downloadFirmware = async (region, model, imei) => {
    try {
        const { pda, csc, modem } = await getLatestVersion(region, model);
        const firmwareData = await getBinaryInfo(region, model, imei, pda, csc, modem);
        displayOutput(firmwareData);
    } catch (error) {
        document.getElementById('output').innerText = `Error: ${error.message}`;
    }
};

const getLatestVersion = async (region, model) => {
    const response = await axios.get(`https://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`);
    const parsedData = new window.DOMParser().parseFromString(response.data, "application/xml");
    const latestVersion = parsedData.querySelector('versioninfo > firmware > version > latest').textContent.split('/');
    return { pda: latestVersion[0], csc: latestVersion[1], modem: latestVersion[2] || 'N/A' };
};

const getBinaryInfo = async (region, model, imei, pda, csc, modem) => {
    const response = await axios.post('https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do', {
        pda, csc, modem, imei, region
    });
    return response.data;  // Procesar esta respuesta según la estructura de los datos
};

const displayOutput = (data) => {
    document.getElementById('output').innerHTML = `
        <p>Firmware Information:</p>
        <pre>${JSON.stringify(data, null, 2)}</pre>
    `;
};
