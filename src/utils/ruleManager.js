import 'dotenv/config';
import { readFileSync } from 'fs';

const API_KEY = process.env.TWITTERAPI_IO_KEY;
const TARGET_RULE_ID = process.env.TARGET_RULE_ID;

// build rule value dynamically from config.json target accounts
// so whenever you update config.json, the rule reflects it automatically
function buildRuleValue() {
    try {
        const config = JSON.parse(readFileSync('./config.json', 'utf-8'));
        const ruleValue = config.targetAccounts
            .map(account => `from:${account}`)
            .join(' OR ');
        console.log(`📋 Rule value built: ${ruleValue}`);
        return ruleValue;
    } catch (error) {
        console.error('❌ Failed to read config.json:', error.message);
        return null;
    }
}

export async function activateRule() {
    console.log(`⏳ Activating streaming rule (${TARGET_RULE_ID})...`);

    // build rule value from config.json before activating
    const ruleValue = buildRuleValue();
    if (!ruleValue) {
        console.error('❌ Cannot activate — failed to build rule value from config.json');
        return false;
    }

    try {
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
                is_effect: 1 // 1 forces the rule live
            })
        });

        // wait for full response before returning
        const data = await response.json();

        // log the full response so we can always see what the api returned
        console.log('📋 Activate response:', data);

        // check actual api status not just http status code
        if (data.status === 'success') {
            console.log('🚀 Rule activated successfully');
            return true;
        } else {
            console.error('❌ Rule activation failed:', data.msg);
            return false;
        }
    } catch (error) {
        console.error('❌ Activation error:', error.message);
        return false;
    }
}

export async function deactivateRule() {
    console.log(`⏳ Deactivating streaming rule (${TARGET_RULE_ID})...`);

    // build rule value from config.json for deactivation
    const ruleValue = buildRuleValue();
    if (!ruleValue) {
        console.error('❌ Cannot deactivate — failed to build rule value from config.json');
        return false;
    }

    try {
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
                status: "disabled" // freezes the rule server-side to stop credit consumption
            })
        });

        // wait for full response before returning
        const data = await response.json();

        // log the full response so we can always see what the api returned
        console.log('📋 Deactivate response:', data);

        // check actual api status not just http status code
        if (data.status === 'success') {
            console.log('🛑 Rule deactivated successfully');
            return true;
        } else {
            console.error('❌ Rule deactivation failed:', data.msg);
            return false;
        }
    } catch (error) {
        console.error('❌ Deactivation error:', error.message);
        return false;
    }
}