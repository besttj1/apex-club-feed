import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';

// promisify exec so we can use async/await instead of callbacks
const execAsync = promisify(exec);

async function downloadTweetVideo(tweetUrl, tweetId, accountName) {
    const rawFilename = `raw_video_${accountName}_${tweetId}.mp4`;
    const finalFilename = `video_${accountName}_${tweetId}.mp4`;
    console.log(`🎥 Downloading video for Tweet ID: ${tweetId}...`);
    try {
        // let yt-dlp handle the actual download
        await execAsync(`yt-dlp -o "${rawFilename}" "${tweetUrl}"`);
        console.log(`✅ Video downloaded: ${rawFilename}`);

        // check file size to decide if compression is needed
        const stats = await fs.stat(rawFilename);
        const fileSizeMB = stats.size / (1024 * 1024);

        if (fileSizeMB > 8) {
            // compress if over 8MB — gives buffer to stay under whatsapp's 10MB limit
            console.log(`🗜️ Video is ${fileSizeMB.toFixed(1)}MB — compressing...`);
            await execAsync(`ffmpeg -i "${rawFilename}" -vcodec libx264 -crf 32 -preset fast -acodec aac -b:a 96k -vf scale=720:-2 "${finalFilename}" -y`);
            await fs.unlink(rawFilename);
            console.log(`✅ Video compressed: ${finalFilename}`);

            // check compressed file size — if still over 10MB compress again more aggressively
            const compressedStats = await fs.stat(finalFilename);
            const compressedSizeMB = compressedStats.size / (1024 * 1024);
            if (compressedSizeMB > 10) {
                console.log(`🗜️ Still ${compressedSizeMB.toFixed(1)}MB — compressing again more aggressively...`);
                const recompressedFilename = `recompressed_video_${accountName}_${tweetId}.mp4`;
                await execAsync(`ffmpeg -i "${finalFilename}" -vcodec libx264 -crf 38 -preset fast -acodec aac -b:a 64k -vf scale=480:-2 "${recompressedFilename}" -y`);
                await fs.unlink(finalFilename);
                await fs.rename(recompressedFilename, finalFilename);
                console.log(`✅ Video recompressed: ${finalFilename}`);
            }
        } else {
            // small enough, just rename it
            await fs.rename(rawFilename, finalFilename);
            console.log(`✅ Video ready (${fileSizeMB.toFixed(1)}MB — no compression needed): ${finalFilename}`);
        }

        return finalFilename;
    } catch (error) {
        console.error(`❌ Video download/compress failed:`, error.message);
        return null;
    }
}

export { downloadTweetVideo };