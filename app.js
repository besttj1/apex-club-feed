import { startWhatsApp } from './src/services/whatsappService.js';
import { connectToStream } from './src/handlers/streamHandler.js';

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


