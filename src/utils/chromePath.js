import os from 'os';

const getChromePath = () => {
    // if a custom chrome path is set in .env, use that first
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        return process.env.PUPPETEER_EXECUTABLE_PATH;
    }
    // windows and linux have different default chrome locations
    if (os.platform() === 'win32') {
        return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    }
    return '/usr/bin/google-chrome';
};

export { getChromePath };
