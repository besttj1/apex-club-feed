import { google } from 'googleapis';
import { readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { URL } from 'url';

const credentials = JSON.parse(readFileSync('./credentials.json'));
const { client_secret, client_id } = credentials.installed;

const REDIRECT_URI = 'http://localhost:3000';

const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);

const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/contacts'],
    prompt: 'consent', // ensures a fresh refresh token is always returned
});

console.log('\n🔗 Open this URL in your browser:\n');
console.log(authUrl);
console.log('\n⏳ Waiting for you to authorize in browser...\n');

// Local server catches the redirect from Google
const server = createServer(async (req, res) => {
    const url = new URL(req.url, REDIRECT_URI);
    const code = url.searchParams.get('code');

    if (!code) {
        res.writeHead(400);
        res.end('No code found in redirect.');
        return;
    }

    try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        writeFileSync('./token.json', JSON.stringify(tokens));

        // Tell the browser it worked
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<h2>✅ Authorization successful! Close this tab and return to the terminal.</h2>');

        console.log('✅ token.json saved successfully!');
        console.log('Now copy token.json to your Hetzner server.');

        server.close();
        process.exit(0);

    } catch (error) {
        res.writeHead(500);
        res.end('Error: ' + error.message);
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
});

server.listen(3000, () => {
    console.log('🌐 Listening on http://localhost:3000 for Google redirect...');
});