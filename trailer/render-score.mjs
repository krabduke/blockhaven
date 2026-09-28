// Renders trailer/score.js to trailer/out/score.wav in a headless browser.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const out = new URL('./out/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ path: new URL('./score.js', import.meta.url).pathname });
const { sampleRate, channels, data, peak } = await page.evaluate(() => window.renderScore());
const pcm = Buffer.from(data, 'base64');
const header = Buffer.alloc(44);
header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22);
header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
writeFileSync(out + 'score.wav', Buffer.concat([header, pcm]));
console.log('score.wav', (pcm.length / sampleRate / channels / 2).toFixed(1), 's, raw peak', peak.toFixed(2));
await browser.close();
