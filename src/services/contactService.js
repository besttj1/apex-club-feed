import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';

const SUBSCRIBERS_PATH = './subscribers.json';

// load oauth credentials and token
function getAuthClient() {
    const credentials = JSON.parse(readFileSync('./credentials.json'));
    const { client_secret, client_id } = credentials.installed;
    const token = JSON.parse(readFileSync('./token.json'));

    const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, 'urn:ietf:wg:oauth:2.0:oob');
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
}

// read subscribers list from file
function readSubscribers() {
    if (!existsSync(SUBSCRIBERS_PATH)) {
        writeFileSync(SUBSCRIBERS_PATH, JSON.stringify({ subscribers: [] }));
    }
    return JSON.parse(readFileSync(SUBSCRIBERS_PATH));
}

// check if phone number is already saved
export function isAlreadySubscribed(phone) {
    const data = readSubscribers();
    return data.subscribers.some(s => s.phone === phone);
}

// save phone number to subscribers.json
function saveSubscriber(phone) {
    const data = readSubscribers();
    data.subscribers.push({
        phone,
        savedAt: new Date().toISOString()
    });
    writeFileSync(SUBSCRIBERS_PATH, JSON.stringify(data, null, 2));
}

// save contact to google contacts via people api
async function saveToGoogleContacts(phone) {
    try {
        const auth = getAuthClient();
        const people = google.people({ version: 'v1', auth });

        await people.people.createContact({
            requestBody: {
                names: [{ givenName: 'ACF SUB', familyName: phone }],
                phoneNumbers: [{ value: `+${phone}`, type: 'mobile' }]
            }
        });

        console.log(`✅ Contact saved to Google: +${phone}`);
        return true;
    } catch (error) {
        console.error(`❌ Failed to save Google contact:`, error.message);
        return false;
    }
}

// main function — check if new subscriber and save
export async function handleNewSubscriber(phone) {
    if (isAlreadySubscribed(phone)) {
        console.log(`⏭️ Already subscribed: ${phone}`);
        return false;
    }

    console.log(`🆕 New subscriber: ${phone}`);
    saveSubscriber(phone);
    await saveToGoogleContacts(phone);
    return true;
}


