import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { URL } from 'url';

const credentials = JSON.parse(readFileSync('./credentials.json'));
const { client_secret, client_id, redirect_uris } = credentials.installed;

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'urn:ietf:wg:oauth:2.0:oob');

const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/contacts'],
});

console.log('🔗 Open this URL in your browser and authorize access:');
console.log('\n' + authUrl + '\n');
console.log('📋 After authorizing, paste the code you receive below:');

// read the code from terminal input
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (code) => {
    code = code.trim();
    try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        writeFileSync('./token.json', JSON.stringify(tokens));
        console.log('✅ token.json saved successfully! You can now run node app.js');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error retrieving access token:', error.message);
        process.exit(1);
    }
});