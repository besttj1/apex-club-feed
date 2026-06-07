import 'dotenv/config';

export const CONFIG_PATH = './config.json';
export const API_KEY = process.env.TWITTERAPI_IO_KEY;
export const WS_URL = 'wss://ws.twitterapi.io/twitter/tweet/websocket';