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

        if (fileSizeMB > 10) {
            // compress if over 10MB so whatsapp web doesn't reject it
            console.log(`🗜️ Video is ${fileSizeMB.toFixed(1)}MB — compressing...`);
            await execAsync(`ffmpeg -i "${rawFilename}" -vcodec libx264 -crf 28 -preset fast -acodec aac -b:a 128k "${finalFilename}" -y`);
            await fs.unlink(rawFilename);
            console.log(`✅ Video compressed: ${finalFilename}`);
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