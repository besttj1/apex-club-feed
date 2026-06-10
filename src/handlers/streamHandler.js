import WebSocket from 'ws';
import { CONFIG_PATH, API_KEY } from '../config/constants.js';
import { readJsonFile } from '../utils/fileHelper.js';
import { captureTweetScreenshot } from '../services/screenshotService.js';
import { downloadTweetVideo } from '../services/videoService.js';
import { sendToStatus } from '../services/whatsappService.js';
import PQueue from 'p-queue';

function connectToStream() {
    console.log('📡 Handshaking with TwitterAPI.io WebSocket gateway...');

    // prevent multiple simultaneous reconnection attempts
    let isReconnecting = false;

    // process one tweet at a time in order
    const queue = new PQueue({ concurrency: 1 });

    // track processed tweet ids to avoid uploading the same tweet twice
    const processedTweets = new Set();

    // open a persistent websocket connection, api key goes in the header
    const ws = new WebSocket('wss://ws.twitterapi.io/twitter/tweet/websocket', {
        headers: { 'x-api-key': API_KEY }
    });

    ws.on('open', () => {
        console.log('✅ Real-time connection established. Active and waiting for events...');

        // ping every 30 seconds to keep connection alive and detect silent drops
        const pingInterval = setInterval(() => {
            if (ws.readyState === ws.OPEN) {
                ws.ping();
                console.log('🏓 WebSocket ping sent');
            } else if (!isReconnecting) {
                // connection dropped silently — reconnect
                isReconnecting = true;
                console.log('⚠️ WebSocket not open, reconnecting...');
                clearInterval(pingInterval);
                setTimeout(connectToStream, 15000);
            }
        }, 30000);
    });

    ws.on('message', async (rawData) => {
        try {
            const data = JSON.parse(rawData.toString());
            if (data.event_type !== 'tweet' || !data.tweets) return;

            const config = await readJsonFile(CONFIG_PATH);
            const targets = config.targetAccounts || [];
            const keywords = config.keywords || [];

            for (const tweet of data.tweets) {
                const authorHandle = tweet.author?.userName;
                const textContent = tweet.text || "";
                const tweetId = tweet.id;

                if (!authorHandle || !tweetId) continue;

                // skip if we already processed this tweet
                if (processedTweets.has(tweetId)) {
                    console.log(`⏭️ Skipping duplicate tweet: ${tweetId}`);
                    continue;
                }

                // skip tweets older than 5 minutes to avoid uploading stale news
                const tweetAge = Date.now() - new Date(tweet.createdAt).getTime();
                if (tweetAge > 5 * 60 * 1000) {
                    console.log(`⏭️ Skipping old tweet from @${authorHandle} (${Math.round(tweetAge / 60000)} mins old)`);
                    continue;
                }

                const isTarget = targets.some(acc => acc.toLowerCase() === authorHandle.toLowerCase());
                if (!isTarget) continue;

                const hasKeyword = keywords.some(kw => textContent.toLowerCase().includes(kw.toLowerCase()));
                if (!hasKeyword) continue;

                // skip if GoalAlertHQ is reposting content from accounts we already monitor
                // prevents duplicate news when GoalAlertHQ reposts FabrizioRomano etc.
                const isRedundantRepost = targets.some(acc => 
                    textContent.toLowerCase().includes(`—@${acc.toLowerCase()}`)
                );
                if (isRedundantRepost) {
                    console.log(`⏭️ Skipping redundant repost from @${authorHandle}`);
                    continue;
                }

                // mark tweet as processed before adding to queue to prevent race conditions
                processedTweets.add(tweetId);

                console.log(`\n🚨 [STREAM MATCH] Live post from @${authorHandle}!`);
                console.log(`💬 Content: "${textContent.replace(/\n/g, ' ')}"`);


                const cleanText = (textContent || '')
                .replace(/https:\/\/t\.co\/\S+/g, '')
                .trim();
                // add to queue so each tweet is processed one at a time in order
                queue.add(async () => {
                    // mediaItems — retweeted and quoted first so thumbnails don't block video detection
                    const mediaItems = (
                        tweet.retweeted_status?.extended_entities?.media ||
                        tweet.retweeted_status?.extendedEntities?.media ||
                        tweet.retweeted_status?.media ||
                        tweet.quoted_status?.extended_entities?.media ||
                        tweet.quoted_status?.extendedEntities?.media ||
                        tweet.quoted_status?.media ||
                        tweet.extended_entities?.media ||
                        tweet.extendedEntities?.media ||
                        tweet.media ||
                        []
                    );

                    const hasVideo = mediaItems.some(m => m.type === 'video' || m.type === 'animated_gif');

                    if (hasVideo) {
                        // check all possible url locations — direct, quote tweet, or repost
                        // videoTweetUrl — retweet first (your repost case), then main tweet, then quote
                        const videoTweetUrl = tweet.retweeted_status?.url ||
                        tweet.retweeted_status?.twitterUrl ||
                        tweet.url ||
                        tweet.twitterUrl ||
                        tweet.quoted_status?.url ||
                        tweet.quoted_status?.twitterUrl;

                        const videoPath = await downloadTweetVideo(videoTweetUrl, tweetId, authorHandle);
                        if (videoPath) await sendToStatus(videoPath, cleanText);
                    } else {
                        const screenshotPath = await captureTweetScreenshot(tweetId, authorHandle, tweet);
                        if (screenshotPath) await sendToStatus(screenshotPath);
                    }
                });
            }

        } catch (err) {
            console.error('⚠️ Error parsing incoming stream data frame:', err.message);
        }
    });

    ws.on('error', (error) => {
        console.error('❌ WebSocket Engine Exception:', error.message);
    });

    ws.on('close', (code, reason) => {
        console.log(`⚠️ Connection terminated (Code: ${code}). Reason: ${reason || 'None'}`);
        // only reconnect if not already reconnecting
        if (!isReconnecting) {
            isReconnecting = true;
            console.log('🔄 Reinitializing connection tunnel in 15 seconds...');
            setTimeout(connectToStream, 15000);
        }
    });
}

export { connectToStream };