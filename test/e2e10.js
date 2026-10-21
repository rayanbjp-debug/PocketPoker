'use strict';
// Ten players (the maximum) on desktop + one phone, plus the home screen. Screenshots only.
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const URL = process.env.URL || 'http://localhost:3111';
const OUT = process.argv[2] || '/tmp/pp-shots2';
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const errors = [];
  const names = ['Amira', 'Bilal', 'Chen', 'Dara', 'Elio', 'Farah', 'Gus', 'Hana', 'Ivo', 'Jade'];
  const pages = [];
  let code;
  for (const [i, name] of names.entries()) {
    const phone = i === 9;
    const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1366, height: 820 }, hasTouch: phone, isMobile: phone });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    pages.push(page);
    await page.goto(URL);
    if (i === 0) await page.screenshot({ path: `${OUT}/0-home.png` });
    await page.fill('#name', name);
    if (i === 0) { await page.click('#create'); await page.waitForSelector('#lcode'); code = (await page.textContent('#lcode')).trim(); }
    else { await page.fill('#code', code); await page.click('#join'); await page.waitForSelector('.lobby'); }
  }
  // 11th player must be refused
  const extra = await (await browser.newContext()).newPage();
  await extra.goto(URL); await extra.fill('#name', 'Extra'); await extra.fill('#code', code); await extra.click('#join');
  await sleep(500);
  console.log('11th player message:', (await extra.textContent('#home-err')).trim());
  await pages[0].waitForFunction(() => document.querySelectorAll('.prow').length === 10);
  await pages[0].screenshot({ path: `${OUT}/1-lobby-10.png` });
  await pages[0].click('#start');
  await Promise.all(pages.map((p) => p.waitForSelector('.seat.turn', { timeout: 10000 })));
  await sleep(1200);
  await pages[0].screenshot({ path: `${OUT}/2-table-10-desktop.png` });
  await pages[9].screenshot({ path: `${OUT}/3-table-10-phone.png` });
  // tips toggle: hover the call/check button on whoever's turn it is
  const turnIdx = await Promise.all(pages.map((p) => p.locator('button[data-act]').count()));
  const t = turnIdx.findIndex((c) => c > 0);
  if (t >= 0 && t !== 9) { await pages[t].hover('button[data-act="fold"]'); await sleep(300); await pages[t].screenshot({ path: `${OUT}/4-tooltip.png` }); }
  console.log('errors:', errors.length ? errors : 'none');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
