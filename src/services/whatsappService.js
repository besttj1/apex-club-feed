import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { getChromePath } from '../utils/chromePath.js';
import fs from 'fs';
import path from 'path';
import { handleNewSubscriber, isAlreadySubscribed } from './contactService.js';

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

    // check for new messages every 5 seconds
    setInterval(async () => {
        // skip if page is busy
        if (isUploadingStatus || isProcessingMessage) return;

        try {
            const unreadChats = await page.evaluate(() => {
                const chats = document.querySelectorAll('div[data-testid="cell-frame-container"]');
                const results = [];
                for (const chat of chats) {
                    const unreadBadge = chat.querySelector('span[data-testid="icon-unread-count"]');
                    if (unreadBadge) {
                        // skip whatsapp system messages
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
                processedChats.add(title);

                // only process if title looks like a phone number
                const isPhoneNumber = /^\+?[\d\s]{10,20}$/.test(title);

                if (isPhoneNumber) {
                    const phone = title.replace(/[\s+]/g, '');
                    console.log(`📱 New message from unsaved number: ${phone}`);

                    if (isAlreadySubscribed(phone)) {
                        console.log(`⏭️ Already subscribed: ${phone}`);
                        continue;
                    }

                    // add to queue
                    messageQueue.push({ title, phone });
                    console.log(`📥 Message queued: ${phone}`);
                } else {
                    console.log(`⏭️ Skipping saved contact: ${title}`);
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
        const { title, phone } = messageQueue.shift();

        try {
            // first try dom click
            await page.evaluate((chatTitle) => {
                const titleEl = document.querySelector(`span[title="${chatTitle}"]`);
                if (titleEl) {
                    const chatContainer = titleEl.closest('div[data-testid="cell-frame-container"]');
                    if (chatContainer) chatContainer.click();
                }
            }, title);

            // then use puppeteer native click for reliable mouse event
            const chatElement = await page.$(`span[title="${title}"]`);
            if (chatElement) {
                await chatElement.click();
                console.log(`🖱️ Clicked chat: ${title}`);
            } else {
                console.log(`⚠️ Chat element not found: ${title}`);
                await handleNewSubscriber(phone);
                return;
            }

            await new Promise(resolve => setTimeout(resolve, 2000));

            // random delay 2-7 seconds to avoid spam detection
            const delay = Math.floor(Math.random() * 5000) + 2000;
            console.log(`⏳ Waiting ${delay / 1000}s before replying...`);
            await new Promise(resolve => setTimeout(resolve, delay));

            // type message in compose box
            const messageBox = await page.waitForSelector('div[data-testid="conversation-compose-box-input"]', { timeout: 10000 });
            await messageBox.click();
            await page.keyboard.type('👋 Hi! You\'ve been added to Apex Club Feed — your #1 source for live football updates! ⚽🔥 Save this number to get transfer news, club updates, team lineups & goal highlights directly on your WhatsApp status! 📲');

            await new Promise(resolve => setTimeout(resolve, 1000));

            // click send button
            await page.waitForSelector('span[data-testid="wds-ic-send-filled"]', { visible: true, timeout: 10000 });
            await page.click('span[data-testid="wds-ic-send-filled"]');

            console.log(`✅ Auto reply sent to: ${title}`);
            await resetPage();

            // save after successful reply
            await handleNewSubscriber(phone);

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