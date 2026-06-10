import puppeteer from 'puppeteer';
import { readFileSync } from 'fs';
import { getChromePath } from '../utils/chromePath.js';

// load logo once at startup and convert to base64 so puppeteer can render it without file access issues
const logoBase64 = `data:image/png;base64,${readFileSync('./logo.png').toString('base64')}`;

// whatsapp logo svg inline so no extra file needed
const whatsappSvg = `<svg width="28" height="28" viewBox="0 0 24 24" fill="#25D366"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>`;

// detect news type — more specific keywords take priority over generic ones
function detectNewsType(text) {
    const lower = text.toLowerCase();
    if (lower.includes('here we go')) return { label: '✅ HERE WE GO!', color: '#00b300' };
    if (lower.includes('done deal')) return { label: '🎉 DONE DEAL', color: '#0066cc' };
    if (lower.includes('official')) return { label: '🎉 OFFICIAL', color: '#0066cc' };
    if (lower.includes('confirmed')) return { label: '✔️ CONFIRMED', color: '#6600cc' };
    if (lower.includes('just in')) return { label: '⚡ JUST IN', color: '#cc6600' };
    if (lower.includes('breaking')) return { label: '🚨 BREAKING NEWS', color: '#cc0000' };
    return null; // no banner for normal tweets
}

// extract source handle from end of tweet text
function extractSource(text) {
    const match = text.match(/@(\w+)\s*$/);
    return match ? match[1] : null;
}

// remove trailing @handle from text since we show it in source line
function removeTrailingHandle(text) {
    return text.replace(/@(\w+)\s*$/, '').trim();
}

async function captureTweetScreenshot(tweetId, accountName, tweetData) {
    console.log(`📸 Rendering native tweet card for ID: ${tweetId}...`);
    let browser;
    try {
        // pull out photos only, we don't render videos here
        const mediaItems = (
            tweetData.extended_entities?.media ||
            tweetData.extendedEntities?.media ||
            tweetData.media ||
            []
        ).filter(m => m.type === 'photo' || m.type === 'animated_gif');

        console.log(`🖼️ Media found: ${mediaItems.length} item(s)`);

        browser = await puppeteer.launch({
            executablePath: getChromePath(),
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 600, height: 1000, deviceScaleFactor: 2 });

        // build the image grid html if there are photos, otherwise leave it empty
        const imagesHtml = mediaItems.length > 0 ? `
            <div class="media-grid media-${Math.min(mediaItems.length, 4)}">
                ${mediaItems.slice(0, 4).map(m => `
                    <div class="media-item">
                        <img src="${m.media_url_https || m.media_url}" />
                    </div>
                `).join('')}
            </div>
        ` : '';

        // safe date parsing, fall back to now if the date is missing or malformed
        const tweetDate = tweetData.createdAt ? new Date(tweetData.createdAt) : new Date();
        const finalDate = isNaN(tweetDate.getTime()) ? new Date() : tweetDate;
        const timeString = finalDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
        const dateString = finalDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        // strip t.co links from the tweet text before rendering
        const rawText = (tweetData.text || '').replace(/https:\/\/t\.co\/\S+/g, '').trim();

        // extract source handle before removing it from text
        const sourceHandle = extractSource(rawText);

        // remove trailing @handle from displayed text since it shows in source line
        const displayText = sourceHandle ? removeTrailingHandle(rawText) : rawText;

        const cleanText = displayText
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        // detect news type for dynamic banner
        const newsType = detectNewsType(rawText);

        // source line — if tweet ends with @handle, that's the source journalist
        // via and source handle use same green color for consistency
        const sourceLine = sourceHandle
            ? `<div class="source-line">📰 Source: <span class="source-handle">@${sourceHandle}</span> · Via: <span class="via-handle">@${accountName}</span></div>`
            : `<div class="source-line">📰 Source: <span class="source-handle">@${accountName}</span></div>`;

        // dynamic banner only shows when tweet contains known keywords
        const newsBanner = newsType
            ? `<div class="news-banner" style="background: linear-gradient(90deg, ${newsType.color}cc, ${newsType.color});">${newsType.label}</div>`
            : '';

        const tweetHtml = `
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    * { margin: 0; padding: 0; box-sizing: border-box; }
                    body {
                        background: #000;
                        display: flex;
                        justify-content: center;
                        align-items: flex-start;
                        padding: 20px;
                        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
                    }
                    .card {
                        background: linear-gradient(145deg, #0d0d0d 0%, #111827 60%, #0d1f0d 100%);
                        border: 1px solid #1a2e1a;
                        border-radius: 16px;
                        width: 560px;
                        color: #e7e9ea;
                        overflow: hidden;
                        box-shadow: 0 0 30px rgba(57, 255, 20, 0.08);
                    }

                    /* green neon accent line at top */
                    .neon-top {
                        height: 3px;
                        background: linear-gradient(90deg, #00ff41, #39ff14, #00ff41);
                        box-shadow: 0 0 10px #39ff14, 0 0 20px #39ff14;
                    }

                    /* dynamic news banner — bigger and bolder */
                    .news-banner {
                        color: white;
                        font-weight: 900;
                        font-size: 14px;
                        letter-spacing: 2px;
                        padding: 8px 16px;
                        text-align: center;
                        text-transform: uppercase;
                        text-shadow: 0 1px 3px rgba(0,0,0,0.4);
                    }

                    .card-inner { padding: 16px; }

                    /* header with apex branding */
                    .header {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        margin-bottom: 14px;
                        padding-bottom: 12px;
                        border-bottom: 1px solid #1e2d1e;
                    }
                    .apex-logo { width: 44px; height: 44px; border-radius: 50%; overflow: hidden; flex-shrink: 0; }
                    .apex-logo img { width: 100%; height: 100%; object-fit: cover; }
                    .name-block { display: flex; flex-direction: column; }
                    .display-name {
                        font-weight: 700;
                        font-size: 15px;
                        color: #39ff14;
                        text-shadow: 0 0 8px rgba(57, 255, 20, 0.4);
                    }
                    .handle { color: #4a7a4a; font-size: 13px; margin-top: 1px; }
                    .brand-logos { margin-left: auto; display: flex; align-items: center; gap: 8px; }

                    /* tweet content */
                    .text {
                        font-size: 15px;
                        line-height: 1.6;
                        margin-bottom: 12px;
                        white-space: pre-wrap;
                        word-break: break-word;
                        color: #e7e9ea;
                    }

                    /* media grid */
                    .media-grid { display: grid; gap: 4px; border-radius: 12px; overflow: hidden; margin-bottom: 12px; width: 100%; }
                    .media-1 { grid-template-columns: 1fr; }
                    .media-2 { grid-template-columns: 1fr 1fr; grid-template-rows: 280px; }
                    .media-3 { grid-template-columns: 1.2fr 1fr; grid-template-rows: 140px 140px; }
                    .media-4 { grid-template-columns: 1fr 1fr; grid-template-rows: 140px 140px; }
                    .media-item { overflow: hidden; width: 100%; height: 100%; }
                    .media-3 .media-item:first-child { grid-row: 1 / span 2; }
                    .media-item img { width: 100%; height: 100%; object-fit: cover; display: block; }

                    /* footer */
                    .footer {
                        border-top: 1px solid #1e2d1e;
                        padding-top: 10px;
                        margin-top: 4px;
                    }
                    .source-line {
                        font-size: 13px;
                        color: #6b8c6b;
                        margin-bottom: 6px;
                    }
                    /* both source and via use same green color */
                    .source-handle { color: #39ff14; font-weight: 600; }
                    .via-handle { color: #39ff14; font-weight: 600; }
                    .timestamp { font-size: 12px; color: #3a5a3a; }
                </style>
            </head>
            <body>
                <div class="card">
                    <div class="neon-top"></div>
                    ${newsBanner}
                    <div class="card-inner">
                        <div class="header">
                            <div class="apex-logo">
                                <img src="${logoBase64}" />
                            </div>
                            <div class="name-block">
                                <span class="display-name">Apex Club Feed</span>
                                <span class="handle">+2348107384307</span>
                            </div>
                            <div class="brand-logos">
                                ${whatsappSvg}
                            </div>
                        </div>
                        <div class="text">${cleanText}</div>
                        ${imagesHtml}
                        <div class="footer">
                            ${sourceLine}
                            <div class="timestamp">${timeString} · ${dateString}</div>
                        </div>
                    </div>
                </div>
            </body>
            </html>
        `;

        await page.setContent(tweetHtml, { waitUntil: 'domcontentloaded', timeout: 10000 });

        // wait for all images to fully load before taking the screenshot
        if (mediaItems.length > 0) {
            await page.waitForFunction(() => {
                const imgs = document.querySelectorAll('.media-item img');
                return [...imgs].every(img => img.complete && img.naturalHeight > 0);
            }, { timeout: 15000 }).catch(() => console.log("⚠️ Image loading timed out, rendering anyway..."));
        }

        await new Promise(resolve => setTimeout(resolve, 300));

        // resize viewport to fit the card exactly so nothing gets cut off
        const cardHeight = await page.$eval('.card', el => el.offsetHeight);
        await page.setViewport({ width: 600, height: cardHeight + 40, deviceScaleFactor: 2 });

        const element = await page.$('.card');
        const filename = `screenshot_${accountName}_${tweetId}.png`;
        await element.screenshot({ path: filename });

        console.log(`✅ Screenshot generated: ${filename}`);
        return filename;
    } catch (error) {
        console.error(`❌ Visual rendering engine failed:`, error.message);
        return null;
    } finally {
        if (browser) await browser.close();
    }
}

export { captureTweetScreenshot };