import { startWhatsApp, closeWhatsApp } from './src/services/whatsappService.js';
import { connectToStream } from './src/handlers/streamHandler.js';
import { deactivateRule, activateRule } from './src/utils/ruleManager.js';
import cron from 'node-cron';

console.log("🚀 Starting Apex Club Feed Engine [WebSocket Stream Mode]...");
await startWhatsApp();
connectToStream();

// heartbeat — log every 30 minutes to confirm the engine is still running
setInterval(() => {
    const now = new Date();
    const watHour = (now.getUTCHours() + 1) % 24;
    const watMinute = now.getUTCMinutes();
    console.log(`💓 Engine heartbeat — still running at ${watHour}:${watMinute.toString().padStart(2, '0')} WAT`);
}, 30 * 60 * 1000);

// skip night schedule entirely during tournament mode — run 24/7
if (process.env.TOURNAMENT_MODE !== 'true') {

    // deactivate at 1am WAT
    cron.schedule('0 0 * * *', async () => {
        console.log('🌙 Night mode — deactivating stream to save credits...');
        await deactivateRule();
    }, { timezone: 'Africa/Lagos' });

    // reactivate at 7am WAT
    cron.schedule('0 7 * * *', async () => {
        console.log('☀️ Morning — reactivating stream...');
        await activateRule();
    }, { timezone: 'Africa/Lagos' });

}

// shared shutdown logic for both signal types
async function gracefulShutdown(signal) {
    console.log(`\n⏳ Received ${signal} — shutting down gracefully...`);
    await deactivateRule();
    await closeWhatsApp();
    console.log('👋 Engine stopped cleanly');
    process.exit(0);
}

// handle ctrl+c (manual stop)
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// handle pm2 stop/restart/reload
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));