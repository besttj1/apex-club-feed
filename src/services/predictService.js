import { readFileSync, writeFileSync, existsSync } from 'fs';

const PREDICT_CONFIG_PATH = './predict-config.json';
const PREDICT_ENTRIES_PATH = './predict-entries.json';

// read predict config fresh every time so changes take effect immediately without restart
function readConfig() {
    try {
        return JSON.parse(readFileSync(PREDICT_CONFIG_PATH, 'utf-8'));
    } catch {
        return { active: false };
    }
}

// read existing entries or create empty structure if file doesn't exist yet
function readEntries() {
    if (!existsSync(PREDICT_ENTRIES_PATH)) {
        writeFileSync(PREDICT_ENTRIES_PATH, JSON.stringify({ entries: [] }, null, 2));
    }
    return JSON.parse(readFileSync(PREDICT_ENTRIES_PATH, 'utf-8'));
}

// save new entry to entries file
function saveEntry(phone, prediction, match) {
    const data = readEntries();
    data.entries.push({
        phone,
        name: `ACF SUB ${phone}`,
        entry: prediction,
        match,
        submittedAt: new Date().toISOString()
    });
    writeFileSync(PREDICT_ENTRIES_PATH, JSON.stringify(data, null, 2));
    console.log(`✅ Prediction saved: ACF SUB ${phone} — ${prediction}`);
}

// check if phone already submitted for current match
function hasAlreadyEntered(phone, match) {
    const data = readEntries();
    return data.entries.some(e => e.phone === phone && e.match === match);
}

// pick a random message from an array of variations
function pickRandom(messages) {
    return messages[Math.floor(Math.random() * messages.length)];
}

// replace dynamic placeholders in message with real contest values
function buildMessage(template, config) {
    return template
        .replace(/{match}/g, config.match)
        .replace(/{team1Short}/g, config.team1Short)
        .replace(/{team2Short}/g, config.team2Short);
}

// validate prediction format — must match: KEYWORD team1Short score vs score team2Short
function isValidPrediction(text, config) {
    // build regex dynamically from config short names
    // accepts: PREDICT Mex 2 vs 1 Sou (case insensitive, flexible spacing)
    const team1 = config.team1Short.toLowerCase();
    const team2 = config.team2Short.toLowerCase();
    const keyword = config.keyword.toLowerCase();
    const pattern = new RegExp(
        `^${keyword}\\s+${team1}\\s+\\d+\\s+vs\\s+\\d+\\s+${team2}$`,
        'i'
    );
    return pattern.test(text.trim());
}

// extract just the prediction part without the keyword
function extractPrediction(text, keyword) {
    return text.trim().substring(keyword.length).trim();
}

// check if deadline has passed — deadline is treated as WAT (UTC+1)
function isDeadlinePassed(deadline) {
    const deadlineWAT = new Date(deadline + '+01:00');
    return new Date() > deadlineWAT;
}

// main function — called from whatsappService when a message arrives
// returns { type, message } if handled, null if not a prediction message
export async function handlePrediction(phone, messageText) {
    const config = readConfig();

    // prediction feature is off — ignore completely
    if (!config.active) return null;

    const keyword = config.keyword.toLowerCase();
    const text = messageText.trim();

    // message doesn't start with keyword — not a prediction entry
    if (!text.toLowerCase().startsWith(keyword)) return null;

    console.log(`🏆 Prediction entry detected from: ${phone}`);

    // contest deadline has passed
    if (isDeadlinePassed(config.deadline)) {
        console.log(`⏰ Contest closed — rejected entry from: ${phone}`);
        return { type: 'closed', message: buildMessage(pickRandom(config.replyMessages.closed), config) };
    }

    // validate prediction format
    if (!isValidPrediction(text, config)) {
        console.log(`❌ Invalid prediction format from: ${phone}`);
        return { type: 'invalid', message: buildMessage(pickRandom(config.replyMessages.invalid), config) };
    }

    // check for duplicate entry
    if (hasAlreadyEntered(phone, config.match)) {
        console.log(`⚠️ Duplicate entry from: ${phone}`);
        return { type: 'duplicate', message: buildMessage(pickRandom(config.replyMessages.duplicate), config) };
    }

    // valid entry — save it
    const prediction = extractPrediction(text, config.keyword);
    saveEntry(phone, prediction, config.match);
    return { type: 'confirmed', message: buildMessage(pickRandom(config.replyMessages.confirmed), config) };
}