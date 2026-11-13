#!/usr/bin/env node
// Capture a live-gameplay screenshot (goal condition): diamond, players,
// crowd, clouds, sky, scoreboard HUD all visible. Expects the preview server
// on :4173 (npm run preview).
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'docs/gameplay.png';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:4173/');
await page.waitForSelector('canvas');
await page.evaluate(() => {
  window.__game.dispatch({ type: 'start', mode: '2p' });
  window.__game.dispatch({ type: 'pitch', pitch: 'fastball', lane: 0 });
});
await page.waitForTimeout(400); // ball mid-flight, HUD live
await page.screenshot({ path: out });
console.log(`screenshot saved: ${out}`);
await browser.close();
