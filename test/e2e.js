'use strict';
// Browser test: several real browser pages play through the UI. Run the server first (PORT=3111 npm start).
// Needs playwright installed (not a dependency of the game). Usage: node test/e2e.js [outDir]
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }

const URL = process.env.URL || 'http://localhost:3111';
const OUT = process.argv[2] || '/tmp/pp-shots';
require('fs').mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const names = ['Amira', 'Bilal', 'Chen', 'Dara', 'Elio', 'Farah'];
  const errors = [];
  const pages = [];
  for (const [i, name] of names.entries()) {
    const ctx = await browser.newContext({ viewport: i === 5 ? { width: 390, height: 800 } : { width: 1366, height: 820 }, hasTouch: i === 5, isMobile: i === 5 });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
    pages.push(page);
    await page.goto(URL);
    await page.fill('#name', name);
    if (i === 0) {
      await page.click('#create');
    } else {
      await page.fill('#code', pages.code);
      await page.click('#join');
    }
    await page.waitForSelector('.lobby');
    if (i === 0) { pages.code = (await page.textContent('#lcode')).trim(); console.log('party code', pages.code); }
  }
  const host = pages[0];
  await host.waitForFunction(() => document.querySelectorAll('.prow').length === 6);
  // host edits settings: fast turns, 12 hands, rebuy 2
  await host.fill('#s_turnSeconds', '15'); await host.locator('#s_turnSeconds').dispatchEvent('change');
  await host.fill('#s_len', '12'); await host.locator('#s_len').dispatchEvent('change');
  await host.fill('#s_rebuyLimit', '2'); await host.locator('#s_rebuyLimit').dispatchEvent('change');
  await sleep(400);
  await host.screenshot({ path: path.join(OUT, '1-lobby-host.png') });
  await pages[1].screenshot({ path: path.join(OUT, '1b-lobby-guest.png') });
  console.log('start enabled:', await host.locator('#start').isEnabled());
  await host.click('#start');
  await Promise.all(pages.map((p) => p.waitForSelector('.game', { timeout: 8000 })));
  console.log('game started for all 6');

  // a bot loop: every page clicks check/call (sometimes raise or fold) when it is their turn
  let stop = false, shots = 0;
  const rnd = () => Math.random();
  async function play(page, idx) {
    while (!stop) {
      try {
        const btn = page.locator('button[data-act]');
        if (await btn.count()) {
          const r = rnd();
          let sel = 'button[data-act="check"], button[data-act="call"]';
          if (r < 0.12) sel = 'button[data-act="fold"]';
          else if (r > 0.88 && (await page.locator('button[data-act="raise"]').count())) sel = 'button[data-act="raise"]';
          else if (r > 0.8 && (await page.locator('button[data-act="allin"]').count())) sel = 'button[data-act="allin"]';
          const t = page.locator(sel).first();
          if (await t.count()) await t.click({ timeout: 1500 }).catch(() => {});
        }
      } catch (e) { /* page navigating */ }
      await sleep(350 + idx * 40);
    }
  }
  const bots = pages.map((p, i) => play(p, i));

  // screenshot the first betting moment seen by the host, the flop, and a showdown
  const want = { preflop: false, flop: false, over: false };
  const t0 = Date.now();
  while (Date.now() - t0 < 120000 && !(want.preflop && want.flop && want.over)) {
    const state = await host.evaluate(() => {
      const d = document.querySelector('#dline'); const b = document.querySelectorAll('#board .card:not(.slot)').length;
      return { line: d ? d.textContent : '', board: b, banner: (document.querySelector('#banner') || {}).textContent || '' };
    }).catch(() => null);
    if (state) {
      if (!want.preflop && /Preflop/.test(state.line) && state.board === 0) { await sleep(600); await host.screenshot({ path: path.join(OUT, '2-preflop.png') }); want.preflop = true; }
      else if (!want.flop && state.board === 3) { await sleep(900); await host.screenshot({ path: path.join(OUT, '3-flop.png') }); want.flop = true; }
      else if (!want.over && state.board === 5 && state.banner) { await sleep(1200); await host.screenshot({ path: path.join(OUT, '4-showdown.png') }); await pages[5].screenshot({ path: path.join(OUT, '5-mobile.png') }); want.over = true; }
    }
    await sleep(250);
  }
  console.log('captured', JSON.stringify(want));

  // open chat and players tab on host, send a message
  await host.fill('#chat-in', 'good luck everyone'); await host.press('#chat-in', 'Enter');
  await sleep(400);
  await host.click('.tabs button[data-tab="players"]');
  await sleep(300);
  await host.screenshot({ path: path.join(OUT, '6-players-tab.png') });

  // let the game run to the end (12 hands)
  const t1 = Date.now();
  while (Date.now() - t1 < 240000) {
    if (await host.locator('.modal-back h2').count()) break;
    await sleep(1000);
  }
  const over = await host.locator('.modal-back h2').count();
  console.log('results screen shown:', !!over);
  if (over) { await sleep(500); await host.screenshot({ path: path.join(OUT, '7-results.png') }); }
  stop = true;
  await Promise.all(bots);
  console.log('console errors:', errors.length ? errors : 'none');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
