document.getElementById('download-form').addEventListener('submit', function (event) {
    event.preventDefault();

    const imei = document.getElementById('imei').value;
    const model = document.getElementById('model').value;
    const region = document.getElementById('region').value;
    
    // Iniciar el proceso de descarga
    downloadFirmware(region, model, imei);
});

const displayDebugInfo = (message) => {
    const debugDiv = document.getElementById('debug-output');
    const debugText = document.getElementById('debug-text');
    debugText.textContent += `${message}\n`;
    debugDiv.style.display = 'block'; // Muestra la sección de depuración
};

const displayOutput = (data) => {
    document.getElementById('output').innerHTML = `
        <p>Firmware Information:</p>
        <pre>${JSON.stringify(data, null, 2)}</pre>
    `;
};

const downloadFirmware = async (region, model, imei) => {
    try {
        displayDebugInfo(`Fetching firmware for model: ${model}, region: ${region}, IMEI: ${imei}`);

        // Obtener la versión más reciente
        const { pda, csc, modem } = await getLatestVersion(region, model);
        displayDebugInfo(`Latest Firmware Versions - PDA: ${pda}, CSC: ${csc}, MODEM: ${modem}`);

        // Obtener la información del binario
        const firmwareData = await getBinaryInfo(region, model, imei, pda, csc, modem);
        displayOutput(firmwareData);
    } catch (error) {
        displayDebugInfo(`Error: ${error.message}`);
        document.getElementById('output').innerText = `Error: ${error.message}`;
    }
};

const getLatestVersion = async (region, model) => {
    try {
        displayDebugInfo(`Fetching latest version for region: ${region}, model: ${model}`);
        
        const response = await axios.get(`https://fota-cloud-dn.ospserver.net/firmware/${region}/${model}/version.xml`);
        displayDebugInfo(`Response received: ${response.data}`);

        const parsedData = new window.DOMParser().parseFromString(response.data, "application/xml");
        const latestVersion = parsedData.querySelector('versioninfo > firmware > version > latest').textContent.split('/');
        return { pda: latestVersion[0], csc: latestVersion[1], modem: latestVersion[2] || 'N/A' };
    } catch (error) {
        throw new Error(`Failed to fetch latest version: ${error.message}`);
    }
};

const getBinaryInfo = async (region, model, imei, pda, csc, modem) => {
    try {
        displayDebugInfo(`Fetching binary information for IMEI: ${imei}, Model: ${model}, Region: ${region}`);
        
        const response = await axios.post('https://neofussvr.sslcs.cdngc.net/NF_DownloadBinaryInform.do', {
            pda, csc, modem, imei, region
        });
        displayDebugInfo(`Binary information received: ${JSON.stringify(response.data)}`);
        
        // Aquí se debería manejar la respuesta de la API y extraer los datos requeridos
        return response.data; // Cambia esto según la estructura real de la respuesta
    } catch (error) {
        throw new Error(`Failed to fetch binary info: ${error.message}`);
    }
};
