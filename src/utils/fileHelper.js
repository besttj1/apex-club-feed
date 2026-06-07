import fs from 'fs/promises';

async function readJsonFile(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf-8');
        return JSON.parse(data);
    } catch { return {}; } // return empty object if file doesn't exist or is malformed
}

export { readJsonFile };