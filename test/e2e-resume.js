'use strict';
// Reload mid-game (resume), host mute/kick, and leaving the party. Run the server first.
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/npm-tools/node_modules/playwright')); }
const URL = process.env.URL || 'http://localhost:3111';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (name, ok) => { console.log((ok ? '  ok  ' : ' FAIL ') + name); if (!ok) process.exitCode = 1; };
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
  const errors = [];
  const names = ['Host', 'Bob', 'Cleo', 'Dan'];
  const pages = [];
  let code;
  for (const [i, n] of names.entries()) {
    const p = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(URL); await p.fill('#name', n);
    if (i === 0) { await p.click('#create'); await p.waitForSelector('#lcode'); code = (await p.textContent('#lcode')).trim(); }
    else { await p.fill('#code', code); await p.click('#join'); await p.waitForSelector('.lobby'); }
    pages.push(p);
  }
  await pages[0].waitForFunction(() => document.querySelectorAll('.prow').length === 4);
  // taken name is refused
  const dup = await (await browser.newContext()).newPage();
  await dup.goto(URL); await dup.fill('#name', 'bob'); await dup.fill('#code', code); await dup.click('#join'); await sleep(400);
  check('duplicate name refused', /taken/.test(await dup.textContent('#home-err')));
  // guests cannot start
  check('guest has no start button', await pages[1].locator('#start').isHidden());
  await pages[0].click('#start');
  await Promise.all(pages.map((p) => p.waitForSelector('.game')));
  // Bob reloads: should come back to the same table
  await pages[1].reload();
  await pages[1].waitForSelector('.game .seat.me', { timeout: 8000 });
  check('reload resumes the same seat', true);
  // host mutes Cleo; Cleo's chat is refused
  await pages[0].click('.tabs button[data-tab="players"]');
  await pages[0].locator('.sp-row', { hasText: 'Cleo' }).locator('button[data-a="mute"]').click();
  await sleep(400);
  await pages[2].fill('#chat-in', 'hello?'); await pages[2].press('#chat-in', 'Enter');
  await sleep(500);
  check('muted player cannot chat', (await pages[2].locator('#toasts .toast').allTextContents()).some((t) => /muted/i.test(t)));
  // host kicks Dan
  pages[0].once('dialog', (d) => d.accept());
  await pages[0].locator('.sp-row', { hasText: 'Dan' }).locator('button[data-a="kick"]').click();
  await sleep(800);
  check('kicked player returns to the home screen', await pages[3].locator('.home').count() > 0);
  // Dan cannot rejoin with the same browser session
  await pages[3].fill('#name', 'Dan2'); await pages[3].fill('#code', code); await pages[3].click('#join'); await sleep(500);
  check('kicked player cannot rejoin', /removed/.test(await pages[3].textContent('#home-err')));
  // Cleo leaves
  pages[2].once('dialog', (d) => d.accept());
  await pages[2].click('#b-leave'); await sleep(600);
  check('leaving returns to home', await pages[2].locator('.home').count() > 0);
  check('no page errors', errors.length === 0);
  if (errors.length) console.log(errors);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(2); });
