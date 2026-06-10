import 'dotenv/config';
import { readFileSync } from 'fs';

const API_KEY = process.env.TWITTERAPI_IO_KEY;
const TARGET_RULE_ID = process.env.TARGET_RULE_ID;

if (!API_KEY) {
    console.error("❌ Error: TWITTERAPI_IO_KEY missing from .env!");
    process.exit(1);
}

// read target accounts from config.json and build rule value
// so you only need to update config.json — never touch this file
function buildRuleValue() {
    const config = JSON.parse(readFileSync('./config.json', 'utf-8'));
    return config.targetAccounts
        .map(account => `from:${account}`)
        .join(' OR ');
}

async function activateRule() {
    console.log(`⏳ Activating your streaming rule cluster (${TARGET_RULE_ID})...`);

    try {
        const ruleValue = buildRuleValue();
        console.log(`📋 Rule value: ${ruleValue}`);

        const response = await fetch("https://api.twitterapi.io/oapi/tweet_filter/update_rule", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": API_KEY
            },
            body: JSON.stringify({
                rule_id: TARGET_RULE_ID,
                tag: "football_feed",
                value: ruleValue,
                interval_seconds: 60,
                is_effect: 1
            })
        });

        const data = await response.json();

        if (response.ok) {
            console.log("\n🚀 SUCCESS! Your server-side streaming rule is now 100% LIVE.");
            console.log("📋 Server Routing Profile Status:", data);
        } else {
            console.error(`\n❌ Server rejected activation request with status ${response.status}`);
            console.log("Details:", data);
        }
    } catch (error) {
        console.error("\n❌ Network transmission exception:", error.message);
    }
}

activateRule();