import 'dotenv/config';

const API_KEY = process.env.TWITTERAPI_IO_KEY;

// 1. PASTE YOUR SUCCESSFUL RULE ID BETWEEN THE QUOTES BELOW:
const TARGET_RULE_ID = process.env.TARGET_RULE_ID; 

if (!API_KEY) {
    console.error("❌ Error: TWITTERAPI_IO_KEY missing from .env!");
    process.exit(1);
}

async function activateRule() {
    console.log(`⏳ Activating your streaming rule cluster (${TARGET_RULE_ID})...`);

    try {
        const response = await fetch("https://api.twitterapi.io/oapi/tweet_filter/update_rule", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": API_KEY
            },
            body: JSON.stringify({
                rule_id: TARGET_RULE_ID, // Required
                tag: "feed_test", // Required
                value: "from:FabrizioRomano OR from:theMadridZone OR from:GoalAlertHQ", // Required
                interval_seconds: 60, // Required
                is_effect: 1 // 1 explicitly forces the rule live
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