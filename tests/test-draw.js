// The draw page with its built-in sample giveaway: rules, drawing, voiding, CSV, reset, own lists.
const fs = require('fs');
const path = require('path');
const { SITE, OUT, launch, serveSite, check, done } = require('./helpers.js');
const url = SITE + 'draw.html';

(async () => {
  const browser = await launch();
  const errors = [];

  // ---------- Functional run (desktop, light) ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
  await serveSite(ctx);
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(url);
  await page.waitForTimeout(300);

  const txt = sel => page.$eval(sel, n => n.textContent.trim());
  check(await txt('#s-comments') === '23', 'sample comments = 23 (got ' + await txt('#s-comments') + ')');
  check(await txt('#s-people') === '23', 'sample people = 23 (got ' + await txt('#s-people') + ')');
  check(await txt('#s-eligible') === '14', 'sample eligible = 14 (got ' + await txt('#s-eligible') + ')');
  check(await page.isVisible('#sample-banner'), 'sample banner visible');
  check(await page.isVisible('#btn-csv'), 'CSV button shown');

  // Ineligible reasons are shown
  const reasons = await page.$$eval('#people .reasons', ns => ns.map(n => n.textContent));
  check(reasons.some(r => r.includes('在排除名單')), 'excluded person shows reason');
  check(reasons.some(r => r.includes('只標記 1 位')), 'tag-count reason shown');

  // Turn animation off
  await page.click('label.switch');
  check(!(await page.isChecked('#opt-anim')), 'animation switched off');

  // Draw one
  await page.click('#btn-draw');
  await page.waitForTimeout(150);
  check(await page.$eval('#ticket', n => n.dataset.mode) === 'won', 'ticket shows winner');
  const first = await txt('#t-name');
  check(/抽獎池還有 13 位/.test(await txt('#pool-line')), 'pool shrinks to 13 after a draw');
  check(await page.isDisabled('#paste'), 'import locked after drawing starts');
  check(await page.isDisabled('#r-like'), 'rules locked after drawing starts');
  await page.screenshot({ path: path.join(OUT, 'shot-draw-desktop.png'), fullPage: true });

  // Void the first winner (two-step)
  const voidBtn = page.locator('#winners .wrow button').first();
  await voidBtn.click();
  check((await voidBtn.textContent()).includes('確定作廢'), 'void asks for confirmation');
  await voidBtn.click();
  await page.waitForTimeout(100);
  check(await page.locator('#winners .wrow.void').count() === 1, 'winner voided');
  check((await txt('#s-drawn')).startsWith('0 /'), 'drawn count back to 0');

  // Redraw first prize, then finish the rest
  await page.click('#btn-draw');
  await page.waitForTimeout(100);
  const second = await txt('#t-name');
  check(second !== first, 'voided person is not drawn again (' + first + ' -> ' + second + ')');
  // Now second prize selected automatically, draw rest (2)
  await page.click('#btn-draw-rest');
  await page.waitForTimeout(300);
  await page.click('#btn-draw-rest');
  await page.waitForTimeout(300);
  check((await txt('#s-drawn')) === '6 / 6', 'all 6 slots drawn (got ' + await txt('#s-drawn') + ')');
  check(await page.isDisabled('#btn-draw'), 'draw disabled when all prizes done');

  const winnerNames = await page.$$eval('#winners .wrow:not(.void) .name', ns => ns.map(n => n.textContent));
  const eligibleNames = await page.$$eval('#people .person', ns => ns.filter(n => !n.querySelector('.no.none')).map(n => n.querySelector('.name').firstChild.textContent));
  check(new Set(winnerNames).size === 6, 'six distinct winners');
  check(winnerNames.every(n => eligibleNames.includes(n)), 'every winner is eligible');
  check(!winnerNames.includes(first), 'voided winner not among active winners');

  // Copy announcement (clipboard may be refused headless; box must show text either way)
  await page.click('#btn-copy');
  await page.waitForTimeout(200);
  const ann = await page.$eval('#copy-box', n => n.value);
  check(!(await page.isHidden('#copy-box')) && ann.startsWith('【抽獎結果】'), 'announcement text produced');
  check(!ann.includes(first), 'announcement excludes voided winner');
  console.log('--- announcement ---\n' + ann + '\n---');

  // CSV: a real file download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
  const csvData = fs.readFileSync(await dl.path(), 'utf8');
  check(/^抽獎結果-\d{8}-\d{4}\.csv$/.test(dl.suggestedFilename()), 'CSV downloads as a file (' + dl.suggestedFilename() + ')');
  const saved = { data: csvData };
  const csvLines = csvData.split('\r\n');
  check(csvData.charCodeAt(0) === 0xFEFF, 'CSV has UTF-8 BOM');
  check(csvLines.length === 8, 'CSV has header + 7 rows (got ' + csvLines.length + ')');
  check(csvLines.some(l => l.includes('作廢')), 'CSV includes the voided row');

  // Log
  const logCount = await txt('#log-count');
  check(Number(logCount) === 9, 'log has start + 7 draws + 1 void = 9 (got ' + logCount + ')');

  // Reset (two-step)
  await page.click('#btn-reset');
  await page.click('#btn-reset');
  await page.waitForTimeout(100);
  check((await txt('#s-drawn')) === '0 / 6', 'reset clears winners');
  check(!(await page.isDisabled('#paste')), 'reset unlocks import');

  // Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  check(Number(await txt('#log-count')) === 10, 'log persisted across reload');

  // Clear sample and import own data
  await page.click('#btn-clear-sample');
  await page.waitForTimeout(100);
  check(await txt('#s-people') === '0', 'sample cleared');
  check(await page.isHidden('#sample-banner'), 'banner hidden after clearing');
  await page.fill('#paste', 'Alice | hi @bob @carl\n2. Bob | 我要抽\nalice | again\n\n');
  await page.waitForTimeout(250);
  check((await txt('#preview')).includes('讀到 3 筆留言，2 位不重複'), 'preview counts unique names');
  await page.click('#btn-add');
  await page.waitForTimeout(100);
  check(await txt('#s-people') === '2' && await txt('#s-comments') === '3', 'paste import dedupes (people 2, comments 3)');
  await page.click('#import-type button[data-type="like"]');
  await page.fill('#paste', 'Alice\n@Dan');
  await page.click('#btn-add');
  await page.waitForTimeout(100);
  check(await txt('#s-people') === '3', 'likes merge by name (people 3)');

  const csvFile = '﻿名字,留言,類型\nEve,"我要抽 @x @y, 謝謝",留言\nEve,,按讚\nFrank,,分享\n';
  await page.setInputFiles('#file', { name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from(csvFile, 'utf8') });
  await page.waitForTimeout(300);
  check(await txt('#s-people') === '5', 'CSV import adds Eve and Frank (people 5, got ' + await txt('#s-people') + ')');
  check(await txt('#s-comments') === '4', 'CSV comment counted (comments 4)');
  check(await page.locator('#batches .batch').count() === 5, 'five batches listed (got ' + await page.locator('#batches .batch').count() + ')');

  await page.check('#r-like');
  await page.waitForTimeout(100);
  check(await txt('#s-eligible') === '2', 'need-like rule leaves Alice and Eve (got ' + await txt('#s-eligible') + ')');
  await page.fill('#r-kw-text', '我要抽');
  await page.waitForTimeout(100);
  check(await page.isChecked('#r-kw'), 'typing a keyword turns the keyword rule on');
  check(await txt('#s-eligible') === '1', 'keyword rule leaves Eve only (got ' + await txt('#s-eligible') + ')');
  await page.check('#r-tag');
  await page.fill('#r-tag-n', '2');
  await page.waitForTimeout(100);
  check(await txt('#s-eligible') === '1', 'Eve tagged 2 people, still eligible');
  await page.fill('#r-exclude', 'eve');
  await page.waitForTimeout(100);
  check(await txt('#s-eligible') === '0', 'exclusion is case-insensitive');
  check(await page.isVisible('#pool-warn'), 'warning shown when nobody qualifies');

  // Prize editor
  await page.click('#btn-add-prize');
  check(await page.locator('#prize-list .prize-row').count() === 2, 'prize added');

  // ---------- Animated draw + mobile + dark screenshots ----------
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  await serveSite(ctx2);
  const p2 = await ctx2.newPage();
  p2.on('console', m => { if (m.type() === 'error') errors.push('m console: ' + m.text()); });
  p2.on('pageerror', e => errors.push('m pageerror: ' + e.message));
  await p2.goto(url);
  await p2.waitForTimeout(300);
  await p2.click('#btn-draw');
  await p2.waitForTimeout(800);
  check(await p2.$eval('#ticket', n => n.dataset.mode) === 'rolling', 'animated draw rolls names');
  await p2.waitForTimeout(2400);
  check(await p2.$eval('#ticket', n => n.dataset.mode) === 'won', 'animated draw lands on a winner');
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'no horizontal overflow at 390px (overflow ' + overflow + ')');
  await p2.locator('#stage').screenshot({ path: path.join(OUT, 'shot-draw-mobile-dark-stage.png') });
  await p2.screenshot({ path: path.join(OUT, 'shot-draw-mobile-dark.png'), fullPage: true });

  check(!errors.length, 'no page errors ' + JSON.stringify(errors));
  await browser.close();
  done();
})();
