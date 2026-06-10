import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getChromePath } from '../utils/chromePath.js';
import fs from 'fs';
import path from 'path';
import { handleNewSubscriber, isAlreadySubscribed } from './contactService.js';
import { handlePrediction } from './predictService.js';
import { readFileSync } from 'fs';

puppeteer.use(StealthPlugin());

let browser;
let page;

// flags to prevent conflicts between status upload and message reply
let isUploadingStatus = false;
let isProcessingMessage = false;

// queue for incoming messages while busy
const messageQueue = [];

async function startWhatsApp() {
    console.log('🚀 Launching WhatsApp Web...');

    const isProduction = process.env.NODE_ENV === 'production';
    const launchOptions = {
        headless: true,
        userDataDir: './.whatsapp_session',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu'
        ]
    };

    // only inject custom chrome path on local machine
    if (!isProduction) {
        launchOptions.executablePath = getChromePath();
    }

    browser = await puppeteer.launch(launchOptions);
    page = await browser.newPage();

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 800 });

    await page.goto('https://web.whatsapp.com', { waitUntil: 'networkidle2', timeout: 60000 });

    try {
        // check if session is already restored
        await Promise.race([
            page.waitForSelector('div[data-testid="chat-list"]', { timeout: 10000 }),
            page.waitForSelector('div[id="pane-side"]', { timeout: 10000 }),
        ]);
        console.log('✅ WhatsApp session restored from cache!');
        await startMessageListener();
    } catch (err) {
        console.log('📱 Active session not found — capturing QR Code...');
        await new Promise(resolve => setTimeout(resolve, 5000));
        await page.screenshot({ path: 'qr.png' });
        console.log('📸 qr.png saved. Open it and scan with your WhatsApp now.');
        console.log('⏳ Waiting 90 seconds for scan...');

        await Promise.race([
            page.waitForSelector('div[data-testid="chat-list"]', { timeout: 90000 }),
            page.waitForSelector('div[id="pane-side"]', { timeout: 90000 }),
            page.waitForSelector('div[data-testid="intro-md-beta-logo-dark"]', { timeout: 90000 }),
        ]);

        console.log('✅ WhatsApp Web authentication completed!');
        await startMessageListener();
    }
}

async function resetPage() {
    try {
        // press escape to close any open panels
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 1000));
        await page.keyboard.press('Escape');
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('🔄 Page reset to home state');
    } catch (err) {
        console.error('⚠️ Page reset failed:', err.message);
    }
}

async function startMessageListener() {
    console.log('👂 Listening for incoming messages...');

    // track chats already processed this session
    const processedChats = new Set();

    // system accounts to always ignore
    const systemAccounts = ['whatsapp business', 'whatsapp'];

    // track last known match and active state to detect config changes
    let lastKnownMatch = '';
    let lastKnownActive = false;

    // check for new messages every 5 seconds
    setInterval(async () => {
        if (isUploadingStatus || isProcessingMessage) return;

        try {
            // check if contest changed or reactivated and clear processed chats
            const currentConfig = JSON.parse(readFileSync('./predict-config.json', 'utf-8'));
            const contestChanged = currentConfig.match !== lastKnownMatch;
            const contestReactivated = currentConfig.active && !lastKnownActive;

            if (contestChanged || contestReactivated) {
                processedChats.clear();
                lastKnownMatch = currentConfig.match;
                lastKnownActive = currentConfig.active;
                console.log('🔄 Contest config changed — processed chats cleared!');
            }

            // update active state tracking
            lastKnownActive = currentConfig.active;

            const unreadChats = await page.evaluate(() => {
                const chats = document.querySelectorAll('div[data-testid="cell-frame-container"]');
                const results = [];
                for (const chat of chats) {
                    const unreadBadge = chat.querySelector('span[data-testid="icon-unread-count"]');
                    if (unreadBadge) {
                        const isSystemChat = chat.querySelector('span[data-testid="wa-chat-psa"]');
                        if (isSystemChat) continue;

                        const titleEl = chat.querySelector('span[dir="auto"][class*="x1iyjqo2"]');
                        const title = titleEl?.getAttribute('title')?.trim();
                        if (title) results.push(title);
                    }
                }
                return results;
            });

            for (const title of unreadChats) {
                // skip system accounts
                if (systemAccounts.some(s => title.toLowerCase().includes(s))) continue;

                // skip if already processed this session
                if (processedChats.has(title)) continue;

                // lock chat immediately to prevent duplicate queuing
                // will be unlocked later if prediction format was invalid
                processedChats.add(title);

                const isPhoneNumber = /^\+?[\d\s]{10,20}$/.test(title);

                // check if it's a saved ACF subscriber contact
                const isACFSubscriber = title.startsWith('ACF SUB ');

                if (isPhoneNumber) {
                    const phone = title.replace(/[\s+]/g, '');
                    console.log(`📱 New message from unsaved number: ${phone}`);

                // queue with flag so processing knows if they're new or existing
                messageQueue.push({ title, phone, messageText: '', isNewSubscriber: !isAlreadySubscribed(phone) });
                console.log(`📥 Message queued: ${phone}`);

                } else if (isACFSubscriber) {
                    // extract phone number from saved contact name "ACF SUB 2348012345678"
                    const phone = title.replace('ACF SUB ', '').trim();
                    console.log(`📱 Message from existing subscriber: ${phone}`);

                    // queue for prediction detection only — no welcome message needed
                    messageQueue.push({ title, phone, messageText: '', isNewSubscriber: false });
                    console.log(`📥 Subscriber message queued: ${phone}`);

                } else {
                    // saved contact — use title as identifier since phone may not be extractable
                    // works for both regular and business WhatsApp saved contacts
                    
                    // try to get phone number by clicking contact info panel
                    const chatElement = await page.$(`span[title="${title}"]`);
                    if (chatElement) {
                        await chatElement.click();
                        await new Promise(resolve => setTimeout(resolve, 1500));

                        // click contact header to open info panel
                        await page.click('div[data-testid="conversation-info-header"]');
                        await new Promise(resolve => setTimeout(resolve, 1500));

                        // try to find phone number in contact info panel
                        const phone = await page.evaluate(() => {
                            const spans = document.querySelectorAll('span[data-testid="selectable-text"]');
                            for (const span of spans) {
                                const text = span.textContent.trim().replace(/\s/g, '');
                                if (/^\+?\d{10,15}$/.test(text)) {
                                    return text.replace(/[\s+]/g, '');
                                }
                            }
                            return null;
                        });

                        // if phone found use it, otherwise use contact name as identifier
                        const identifier = phone || title;
                        console.log(`📱 Saved contact: ${title} — identifier: ${identifier}`);

                        messageQueue.push({ 
                            title, 
                            phone: identifier, 
                            messageText: '', 
                            isNewSubscriber: false 
                        });

                        await resetPage();
                    } else {
                        console.log(`⏭️ Could not find chat: ${title}`);
                    }
                }
            }
        } catch (err) {
            console.error('⚠️ Message listener error:', err.message);
        }
    }, 5000);

    // process queued messages every 5 seconds
    setInterval(async () => {
        if (isProcessingMessage || isUploadingStatus || messageQueue.length === 0) return;

        isProcessingMessage = true;
        const { title, phone, isNewSubscriber } = messageQueue.shift();

        try {
            // first try dom click
            await page.evaluate((chatTitle) => {
                const titleEl = document.querySelector(`span[title="${chatTitle}"]`);
                if (titleEl) {
                    const chatContainer = titleEl.closest('div[data-testid="cell-frame-container"]');
                    if (chatContainer) chatContainer.click();
                }
            }, title);

            // declared outside if block so both are accessible throughout the function
            let predictionResult = null;
            let predictionReply = null;

            // then use puppeteer native click for reliable mouse event
            const chatElement = await page.$(`span[title="${title}"]`);
            if (chatElement) {
                await chatElement.click();
                console.log(`🖱️ Clicked chat: ${title}`);

                // random delay before reading — feels less robotic
                const readDelay = Math.floor(Math.random() * 7000) + 3000;
                await new Promise(resolve => setTimeout(resolve, readDelay));

                // read actual message text from inside the open chat
                const messageText = await page.evaluate(() => {
                    // get all incoming message containers
                    const messages = document.querySelectorAll('div.copyable-text[data-pre-plain-text]');
                    const lastMessage = messages[messages.length - 1];
                    // read text from the reliable data-testid selector
                    return lastMessage?.querySelector('span[data-testid="selectable-text"]')?.textContent?.trim() || '';
                });


                console.log(`📨 Message received: ${messageText}`);

                // check if message is a prediction entry and extract result type and message
                predictionResult = await handlePrediction(phone, messageText);
                predictionReply = predictionResult?.message || null;

            } else {
                console.log(`⚠️ Chat element not found: ${title}`);
                if (isNewSubscriber) await handleNewSubscriber(phone);
                return;
            }

            // if existing subscriber sent a normal message — no reply needed, just reset
            if (!isNewSubscriber && !predictionReply) {
                console.log(`⏭️ No reply needed for: ${phone}`);
                await resetPage();
                return;
            }

            // random delay 2-7 seconds to avoid spam detection
            const delay = Math.floor(Math.random() * 5000) + 2000;
            console.log(`⏳ Waiting ${delay / 1000}s before replying...`);
            await new Promise(resolve => setTimeout(resolve, delay));

            const messageBox = await page.waitForSelector('div[data-testid="conversation-compose-box-input"]', { timeout: 10000 });
            await messageBox.click();

            // only send welcome message if this is a new subscriber
            if (isNewSubscriber) {
                const welcomeMessages = [
                    '👋 Hi! You\'ve been added to Apex Club Feed — your #1 source for live football updates! ⚽🔥 We\'ve also saved your contact on our end! ✅ Save this number now so you can see our transfer news, club updates, team lineups & goal highlights directly on your WhatsApp status! 📲',
                    '⚽ Welcome to Apex Club Feed! 🔥 You\'re now connected to the best football update service in the game! ✅ Your contact has been saved on our end too! Save this number to your contacts and catch all our live updates, breaking news & goal highlights on your WhatsApp status! 📲',
                    '🏆 You\'re in! Apex Club Feed is your go-to for live football action! ⚽ ✅ We\'ve got your contact saved on our end! Save this number now — if you don\'t save it, you won\'t see our posts on your WhatsApp status! Don\'t miss breaking transfers & goal highlights! 🔥',
                    '🔥 Hey! You just joined Apex Club Feed — the #1 football update channel on WhatsApp! ⚽ ✅ Your contact has been saved on our side! Make sure you save this number to your contacts so our status updates show up for you! Transfer news, lineups & goals — all live! 📲',
                    '📲 Welcome! You\'re now part of Apex Club Feed! ⚽🔥 ✅ We\'ve saved your contact on our end! One important step — save this number to your contacts! Without saving it, you won\'t see our WhatsApp status posts! Get ready for live goals, transfers & club updates! 🏆',
                    '⚽ Hi there! Apex Club Feed here — your #1 stop for live football updates! 🔥 ✅ Your contact is saved on our end! Save this number immediately so you never miss our WhatsApp status posts! We bring you goal highlights, transfer news & lineups as they happen! 📲',
                    '🎉 You\'ve been connected to Apex Club Feed! ⚽ ✅ We\'ve saved your contact on our side too! We deliver live football updates straight to your WhatsApp status! 🔥 Save this number to your contacts now — it\'s the only way you\'ll see our posts! Don\'t miss a single goal! 🏆',
                    '📲 Welcome to Apex Club Feed! 🏆 The home of live football updates on WhatsApp! ⚽ ✅ Your contact has been saved on our end! Quick reminder — save this number to your contacts! If you don\'t save it, our WhatsApp status posts won\'t be visible to you! 🔥',
                    '🔥 Hey! You\'re now connected to Apex Club Feed ⚽ — where football never sleeps! 🏆 ✅ We\'ve saved your contact on our end! Save this number to your contacts right away so you can see all our status updates! Live goals, transfers & team news delivered fresh! 📲',
                    '⚽ Hi! Apex Club Feed here — bringing you the best football updates on WhatsApp! 🔥 ✅ Your contact is saved on our end! Don\'t forget to save this number! You must save it to see our posts on your WhatsApp status! Live highlights, transfers & more await! 🏆📲',
                ];

                const randomMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)];
                // type message handling newlines as Shift+Enter instead of Enter
                // so they appear as line breaks inside one bubble not separate messages
                const welcomelines = randomMessage.split('\n');
                for (let i = 0; i < welcomelines.length; i++) {
                    await page.keyboard.type(welcomelines[i]);
                    if (i < welcomelines.length - 1) {
                        await page.keyboard.down('Shift');
                        await page.keyboard.press('Enter');
                        await page.keyboard.up('Shift');
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 1000));

                // send welcome message
                await page.waitForSelector('span[data-testid="wds-ic-send-filled"]', { visible: true, timeout: 10000 });
                await page.click('span[data-testid="wds-ic-send-filled"]');
                console.log(`✅ Welcome message sent to: ${title}`);

                // save subscriber after welcome message sent
                await handleNewSubscriber(phone);

                // small natural delay before sending prediction reply
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            // send prediction reply if message was a prediction entry
            if (predictionReply) {
                await messageBox.click();
                // type message handling newlines as Shift+Enter instead of Enter
                // so they appear as line breaks inside one bubble not separate messages
                const replylines = predictionReply.split('\n');
                for (let i = 0; i < replylines.length; i++) {
                    await page.keyboard.type(replylines[i]);
                    if (i < replylines.length - 1) {
                        await page.keyboard.down('Shift');
                        await page.keyboard.press('Enter');
                        await page.keyboard.up('Shift');
                    }
                }
                await new Promise(resolve => setTimeout(resolve, 1000));

                await page.waitForSelector('span[data-testid="wds-ic-send-filled"]', { visible: true, timeout: 10000 });
                await page.click('span[data-testid="wds-ic-send-filled"]');
                console.log(`✅ Prediction reply sent to: ${title}`);

                // invalid format — unlock chat so they can retry with correct format
                // all other types — stay locked to prevent duplicate processing
                if (predictionResult.type === 'invalid') {
                    processedChats.delete(title);
                    console.log(`🔓 Chat unlocked for retry: ${title}`);
                } else {
                    console.log(`🔒 Chat locked: ${title}`);
                }
            }

            await resetPage();

        } catch (err) {
            console.error('⚠️ Message processing failed:', err.message);
            await page.screenshot({ path: 'message-error.png' });
            console.log('📸 Saved message-error.png');
            await resetPage();
        } finally {
            isProcessingMessage = false;
        }
    }, 5000);
}

async function sendToStatus(filePath, caption = '') {
    // wait if a message is currently being processed
    while (isProcessingMessage) {
        console.log('⏳ Waiting for message processing to finish...');
        await new Promise(resolve => setTimeout(resolve, 2000));
    }

    isUploadingStatus = true;

    try {
        if (!page) throw new Error('WhatsApp Web instance not active');

        console.log(`📤 Executing status update for: ${filePath}`);
        const isVideo = filePath.endsWith('.mp4');
        const absolutePath = path.resolve(filePath);

        // click the status tab using svg title
        await page.waitForFunction(() => {
            const titles = document.querySelectorAll('svg title');
            return [...titles].some(t => t.textContent === 'wds-ic-status');
        }, { timeout: 20000 });

        await page.evaluate(() => {
            const titles = document.querySelectorAll('svg title');
            for (const title of titles) {
                if (title.textContent === 'wds-ic-status') {
                    const btn = title.closest('button') || title.closest('div[role="button"]') || title.closest('span');
                    if (btn) btn.click();
                    break;
                }
            }
        });
        await new Promise(resolve => setTimeout(resolve, 2000));

        // click the + add status button using svg title
        await page.waitForFunction(() => {
            const titles = document.querySelectorAll('svg title');
            return [...titles].some(t => t.textContent === 'ic-add-circle');
        }, { timeout: 20000 });

        await page.evaluate(() => {
            const titles = document.querySelectorAll('svg title');
            for (const title of titles) {
                if (title.textContent === 'ic-add-circle') {
                    const btn = title.closest('button') || title.closest('div[role="button"]') || title.closest('span');
                    if (btn) btn.click();
                    break;
                }
            }
        });
        await new Promise(resolve => setTimeout(resolve, 1500));

        // click Photos & videos from the popup menu by text content
        await page.waitForFunction(() => {
            const elements = document.querySelectorAll('*');
            return [...elements].some(el => el.childElementCount === 0 && el.textContent.trim() === 'Photos & videos');
        }, { timeout: 10000 });

        await page.evaluate(() => {
            const elements = document.querySelectorAll('*');
            for (const el of elements) {
                if (el.childElementCount === 0 && el.textContent.trim() === 'Photos & videos') {
                    el.click();
                    break;
                }
            }
        });
        await new Promise(resolve => setTimeout(resolve, 1500));

        // handle file input
        const fileSelector = isVideo ? 'input[accept*="video"]' : 'input[accept*="image"]';
        await page.waitForSelector(fileSelector, { timeout: 15000 });
        const inputUploadHandle = await page.$(fileSelector);
        await inputUploadHandle.uploadFile(absolutePath);
        await new Promise(resolve => setTimeout(resolve, 3000));

        // add caption if provided
        if (caption) {
            try {
                const footerInput = await page.waitForSelector('div[data-testid="media-caption-input-container"]', { timeout: 10000 });
                await footerInput.click();
                await page.keyboard.type(caption);
                await new Promise(resolve => setTimeout(resolve, 10000));
            } catch (err) {
                console.log('⚠️ Caption box not found — already auto-sent');
            }
        }

        // watch for first xhr request before clicking send
        const uploadAccepted = page.waitForResponse(
            response => response.request().resourceType() === 'xhr',
            { timeout: 5 * 60 * 1000 }
        );

        // click send button — may already be auto-sent after caption
        try {
            await page.waitForSelector('span[data-testid="wds-ic-send-filled"]', { visible: true, timeout: 5000 });
            await page.click('span[data-testid="wds-ic-send-filled"]');
        } catch (err) {
            console.log('⚠️ Send button not found — likely auto-sent already');
        }

        // wait for first xhr which means whatsapp accepted the upload
        await uploadAccepted;
        console.log(`✅ Status upload processed: ${filePath}`);

        // reset page after successful upload
        await resetPage();

        // delete file in background after 5 minutes
        setTimeout(async () => {
            try {
                await fs.promises.unlink(filePath);
                console.log(`🗑️ Deleted local file: ${filePath}`);
            } catch (err) {
                console.error(`⚠️ Could not wipe temporary file:`, err.message);
            }
        }, 5 * 60 * 1000);

    } catch (error) {
        console.error(`❌ Status update sequence failed:`, error.message);
        await page.screenshot({ path: 'debug.png' });
        console.log('📸 Saved debug.png to see current page state');
        await resetPage();
        console.error(`❌ Upload failed for: ${filePath}`);
    } finally {
        // always clear the flag when done
        isUploadingStatus = false;
    }
}

async function closeWhatsApp() {
    if (browser) await browser.close();
}

export { startWhatsApp, sendToStatus, closeWhatsApp };