import 'dotenv/config';

const API_KEY = process.env.TWITTERAPI_IO_KEY;

// 1. PASTE YOUR RULE ID BETWEEN THE QUOTES BELOW:
const TARGET_RULE_ID = process.env.TARGET_RULE_ID; 

if (!API_KEY) {
    console.error("❌ Error: TWITTERAPI_IO_KEY missing from .env!");
    process.exit(1);
}

async function deactivateRule() {
    console.log(`⏳ Sending pause command to streaming cluster (${TARGET_RULE_ID})...`);
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
                status: "disabled" // Freezes the rule server-side
            })
        });

        const data = await response.json();
        
        if (response.ok) {
            console.log("\n🛑 SUCCESS! Your cloud stream is now DISABLED. Credit consumption has stopped.");
            console.log("📋 Server Routing Profile Status:", data);
        } else {
            console.error(`\n❌ Server rejected deactivation request with status ${response.status}`);
            console.log("Details:", data);
        }
    } catch (error) {
        console.error("\n❌ Network transmission exception:", error.message);
    }
}

deactivateRule();
