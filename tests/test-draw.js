// The draw page with its built-in sample giveaway: the 準備 / 抽獎 views, rules, drawing, voiding,
// locked rules, CSV, reset, own lists.
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

  // Two views: a giveaway that has not started opens on 準備, with the roster beside the import step
  const view = () => page.$eval('.view-tab[aria-current="page"]', a => a.dataset.view);
  check(await view() === 'setup' && await page.isVisible('#sec-rules') && await page.isHidden('#stage'), 'opens on 準備 (setup view) before the draw starts');
  const pos = await page.evaluate(() => Object.fromEntries(['#sec-import', '#sec-people', '#sec-rules'].map(s => {
    const r = document.querySelector(s).getBoundingClientRect();
    return [s.slice(5), [Math.round(r.left), Math.round(r.top)]];
  })));
  check(pos.people[1] === pos.import[1] && pos.people[0] > pos.import[0] && pos.rules[1] > pos.import[1], 'roster sits beside step 1 on wide screens ' + JSON.stringify(pos));
  check((await txt('#next-text')) === '參加者 23 位，符合資格 14 位；3 個獎項，共 6 個名額。' && await page.isHidden('#next-warn'), '去抽獎 bar sums up the setup');

  // Picking someone out by hand: 排除 puts the name in step 2's exclusion list, 恢復 takes it out again
  const xm = page.locator('#people .person', { hasText: '陳小明' });
  check(await page.locator('#people .p-side .btn').count() === 23 && (await page.locator('#people .person', { hasText: '小編' }).locator('.p-side .btn').textContent()) === '恢復', 'every roster row has 排除, the excluded 小編 has 恢復');
  await xm.locator('.p-side .btn').click();
  await page.waitForTimeout(100);
  const xmOut = { eligible: await txt('#s-eligible'), list: await page.$eval('#r-exclude', n => n.value), reason: await xm.locator('.reasons').textContent(), btn: await xm.locator('.p-side .btn').textContent(), focus: await page.evaluate(() => document.activeElement.textContent) };
  check(xmOut.eligible === '13' && xmOut.list === '小編\n陳小明' && xmOut.reason.includes('在排除名單') && xmOut.btn === '恢復' && xmOut.focus === '恢復', '排除 disqualifies 陳小明 and adds the name to the exclusion list ' + JSON.stringify(xmOut));
  await xm.locator('.p-side .btn').click();
  await page.waitForTimeout(100);
  check(await txt('#s-eligible') === '14' && (await page.$eval('#r-exclude', n => n.value)) === '小編' && (await xm.locator('.p-side .btn').textContent()) === '排除', '恢復 puts 陳小明 back');
  await page.click('#btn-go-draw');
  await page.waitForTimeout(150);
  const under = await page.evaluate(() => ({ bar: Math.round(document.querySelector('.views-bar').getBoundingClientRect().bottom), stage: Math.round(document.getElementById('stage').getBoundingClientRect().top) }));
  check(await view() === 'draw' && page.url().endsWith('#draw') && await page.isHidden('#sec-rules') && under.stage >= under.bar && under.stage < 400, '下一步：去抽獎 opens the 抽獎 view right under the tab bar ' + JSON.stringify(under));
  const sum = await page.$$eval('#rule-sum .rs-chip', ns => ns.map(n => n.textContent));
  check(sum.join() === '需留言,需按讚,需標記 2 位,留言含「我要抽」,排除 1 人,同一人只算一次' && (await txt('#rule-sum .rs-edit')) === '修改條件', 'the 抽獎 view lists the rules in use ' + JSON.stringify(sum));
  check(await page.isVisible('#btn-csv') && await page.isHidden('#btn-try'), 'CSV button shown, 試抽看看 hidden on the 抽獎 view');

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
  check(await page.locator('#people .p-side .btn').count() === 0 && await page.isDisabled('#btn-clear-lists'), 'no 排除 or 清空名單 once the draw has started');
  await page.screenshot({ path: path.join(OUT, 'shot-draw-desktop.png'), fullPage: true });

  // Locked rules stay readable: a ticked box keeps its colour, rules that are not used step back
  await page.click('.view-tab[data-view="setup"]');
  await page.waitForTimeout(150);
  const lk = await page.evaluate(() => {
    const cs = s => getComputedStyle(document.querySelector(s));
    const row = s => getComputedStyle(document.querySelector(s).closest('.rule')).opacity;
    const note = document.querySelector('#sec-rules .lock-note');
    return { note: note.hidden ? '' : note.textContent, box: [cs('#r-like').opacity, cs('#r-like').backgroundColor], used: row('#r-like'), unused: row('#r-share'), kw: [cs('#r-kw-text').opacity, cs('#r-kw-text').color] };
  });
  check(lk.note.includes('打勾的就是這次用的條件') && lk.box.join() === '1,rgb(198, 43, 43)' && lk.used === '1' && lk.unused === '0.45' && lk.kw.join() === '1,rgb(26, 32, 48)', 'locked rules stay readable ' + JSON.stringify(lk));
  check((await txt('#next-text')).startsWith('已抽出 1 / 6 名') && (await txt('#btn-go-draw')) === '回到抽獎台 →', '去抽獎 bar says the draw has started');
  await page.locator('#sec-rules').screenshot({ path: path.join(OUT, 'shot-draw-rules-locked.png') });
  await page.goBack();
  await page.waitForTimeout(150);
  check(await view() === 'draw' && await page.isVisible('#stage'), 'the back button returns to the 抽獎 view');
  check((await txt('#rule-sum .rs-edit')) === '查看條件', 'rule summary offers 查看條件 once locked');

  // Void the first winner: a red button that asks in a dialog first
  const voidBtn = page.locator('#winners .wrow button').first();
  const red = await voidBtn.evaluate(n => [getComputedStyle(n).color, getComputedStyle(n).borderTopColor].join());
  check(red === 'rgb(174, 35, 35),rgb(174, 35, 35)', '作廢 is red ' + red);
  await voidBtn.click();
  const dlg = await page.evaluate(() => ({ title: document.getElementById('confirm-title').textContent, text: document.getElementById('confirm-text').textContent, ok: document.getElementById('confirm-ok').textContent, focus: document.activeElement.id, okBg: getComputedStyle(document.getElementById('confirm-ok')).backgroundColor }));
  check(await page.isVisible('#confirm') && dlg.title === '作廢「' + first + '」的得獎資格？' && dlg.text.includes('空出 1 個名額') && dlg.ok === '作廢' && dlg.okBg === 'rgb(198, 43, 43)', '作廢 asks in a dialog with a red 作廢 button ' + JSON.stringify(dlg));
  check(dlg.focus === 'confirm-cancel', 'the dialog starts on 取消, so Enter alone does not void');
  await page.waitForTimeout(250); // let the dialog finish fading in
  await page.screenshot({ path: path.join(OUT, 'shot-draw-confirm.png') });
  await page.click('#confirm-cancel');
  await page.waitForTimeout(100);
  check(await page.isHidden('#confirm') && await page.locator('#winners .wrow.void').count() === 0, '取消 keeps the winner');
  await voidBtn.click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  check(await page.isHidden('#confirm') && await page.locator('#winners .wrow.void').count() === 0, 'Esc keeps the winner');
  await voidBtn.click();
  await page.click('#confirm-ok');
  await page.waitForTimeout(100);
  check(await page.isHidden('#confirm') && await page.locator('#winners .wrow.void').count() === 1, 'winner voided after 作廢 in the dialog');
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

  // Reset asks first; a click on the dimmed page around the dialog cancels
  await page.click('#btn-reset');
  check((await txt('#confirm-title')) === '重新開始抽獎？' && (await txt('#confirm-text')).includes('已抽出的 7 筆結果會清除') && (await txt('#confirm-text')).includes('下載 CSV 紀錄'), 'reset asks in a dialog and suggests saving the CSV first');
  await page.mouse.click(6, 6);
  await page.waitForTimeout(100);
  check(await page.isHidden('#confirm') && (await txt('#s-drawn')) === '6 / 6', 'a click outside the dialog cancels');
  await page.click('#btn-reset');
  await page.click('#confirm-ok');
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
  check(await view() === 'setup' && await page.isVisible('#import-how') && (await txt('#toast')).includes('抓取抽獎名單'), 'clearing the sample goes to 準備 and says the next step is the bookmark on the post');
  check(!(await page.$eval('#more-import', n => n.open)) && await page.isHidden('#paste') && await page.isVisible('#quick-paste'), 'manual paste and CSV wait under 其他匯入方式; the quick paste box is out');
  check(!(await page.isChecked('#r-comment')) && !(await page.isChecked('#r-like')) && !(await page.isChecked('#r-share')), 'no list rule is ticked before a list arrives');
  await page.click('#more-import > summary');
  await page.fill('#paste', 'Alice | hi @bob @carl\n2. Bob | 我要抽\nalice | again\n\n');
  await page.waitForTimeout(250);
  check((await txt('#preview')).includes('讀到 3 筆留言，2 位不重複'), 'preview counts unique names');
  await page.click('#btn-add');
  await page.waitForTimeout(100);
  check(await txt('#s-people') === '2' && await txt('#s-comments') === '3', 'paste import dedupes (people 2, comments 3)');
  check(await page.isChecked('#r-comment') && (await txt('#toast')).includes('已勾選第 2 步的「需要留言」'), 'the first comment list ticks 需要留言 and says so');
  check(await page.isHidden('#import-how') && (await txt('#import-next')).includes('還要抓按讚或分享的人'), 'step 1 then says what is left to fetch');
  await page.click('#import-type button[data-type="like"]');
  await page.fill('#paste', 'Alice\n@Dan');
  await page.click('#btn-add');
  await page.waitForTimeout(100);
  check(await txt('#s-people') === '3', 'likes merge by name (people 3)');
  check(await page.isChecked('#r-like') && (await txt('#toast')).includes('已勾選第 2 步的「需要按讚」'), 'the first like list ticks 需要按讚');

  const csvFile = '﻿名字,留言,類型\nEve,"我要抽 @x @y, 謝謝",留言\nEve,,按讚\nFrank,,分享\n';
  await page.setInputFiles('#file', { name: 'list.csv', mimeType: 'text/csv', buffer: Buffer.from(csvFile, 'utf8') });
  await page.waitForTimeout(300);
  check(await txt('#s-people') === '5', 'CSV import adds Eve and Frank (people 5, got ' + await txt('#s-people') + ')');
  check(await txt('#s-comments') === '4', 'CSV comment counted (comments 4)');
  check(await page.locator('#batches .batch').count() === 5, 'five batches listed (got ' + await page.locator('#batches .batch').count() + ')');
  check(await page.isChecked('#r-share') && (await txt('#toast')).includes('「需要分享」'), 'the CSV share list ticks 需要分享');
  check((await txt('#import-next')).includes('三份名單都到了'), 'with all three kinds in, step 1 points to the rules and 去抽獎');
  check(await txt('#s-eligible') === '0', 'nobody commented, liked and shared (got ' + await txt('#s-eligible') + ')');

  await page.uncheck('#r-share');
  await page.waitForTimeout(100);
  check(await txt('#s-eligible') === '2', 'comment + like leaves Alice and Eve (got ' + await txt('#s-eligible') + ')');
  await page.fill('#r-kw-text', '我要抽');
  await page.waitForTimeout(100);
  check(await page.isChecked('#r-kw'), 'typing a keyword turns the keyword rule on');
  check(await txt('#s-eligible') === '1', 'keyword rule leaves Eve only (got ' + await txt('#s-eligible') + ')');
  await page.uncheck('#r-kw');
  await page.waitForTimeout(100);
  check(await txt('#s-eligible') === '2' && await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway-draw:v1')).rules.needKeyword) === false, 'unticking the keyword rule turns it off (got ' + await txt('#s-eligible') + ')');
  await page.check('#r-kw');
  await page.waitForTimeout(100);
  await page.check('#r-tag');
  await page.fill('#r-tag-n', '2');
  await page.waitForTimeout(100);
  check(await txt('#s-eligible') === '1', 'Eve tagged 2 people, still eligible');
  await page.fill('#r-exclude', 'eve');
  await page.waitForTimeout(100);
  check(await txt('#s-eligible') === '0', 'exclusion is case-insensitive');
  check(await page.isVisible('#next-warn') && (await txt('#next-warn')).includes('目前沒有人符合條件'), 'the 去抽獎 bar warns when nobody qualifies');
  await page.click('.view-tab[data-view="draw"]');
  await page.waitForTimeout(150);
  check(await page.isVisible('#pool-warn'), 'the draw stage warns too');
  await page.click('.view-tab[data-view="setup"]');

  // Prize editor
  await page.click('#btn-add-prize');
  check(await page.locator('#prize-list .prize-row').count() === 2, 'prize added');

  // 移除 on one list asks in a dialog too
  check((await txt('#batches .batches-title')) === '已匯入的名單（5 份）', 'the import step counts the lists');
  const lastBatch = page.locator('#batches .batch').last();
  const lastType = await lastBatch.locator('.pill').textContent();
  await lastBatch.locator('button').click();
  check((await txt('#confirm-title')) === '移除這份' + lastType + '名單？' && (await txt('#confirm-ok')) === '移除', '移除 asks in a dialog (' + lastType + ')');
  await page.click('#confirm-ok');
  await page.waitForTimeout(100);
  check(await page.locator('#batches .batch').count() === 4 && (await txt('#toast')).includes('已移除這份' + lastType + '名單'), '移除 takes out that one list');
  const left = await txt('#s-people');

  // 清空名單 at the top of step 1: asks in a dialog, then clears every imported list; the rules and prizes stay
  const beside = await page.evaluate(() => Math.round(document.getElementById('btn-clear-lists').getBoundingClientRect().top - document.getElementById('h-import').getBoundingClientRect().top));
  check(await page.isVisible('#btn-clear-lists') && Math.abs(beside) <= 12, '清空名單 sits beside the step 1 title (' + beside + 'px)');
  await page.click('#btn-clear-lists');
  check((await txt('#confirm-title')) === '清空全部名單？' && (await txt('#confirm-text')).includes('4 份名單（' + left + ' 位參加者）') && (await txt('#confirm-ok')) === '清空名單', '清空名單 asks in a dialog: ' + await txt('#confirm-text'));
  check((await txt('#confirm-text')).includes('「需要留言」、「需要按讚」也會跟著取消') && (await txt('#confirm-text')).includes('獎品和其他條件會留著'), 'the dialog says the ticked list rules go with the lists');
  await page.waitForTimeout(250); // let the dialog finish fading in
  await page.screenshot({ path: path.join(OUT, 'shot-draw-clear-dialog.png') });
  await page.click('#confirm-ok');
  await page.waitForTimeout(100);
  check(await txt('#s-people') === '0' && await page.locator('#batches .batch').count() === 0 && await page.isChecked('#r-kw') && await page.$eval('#r-exclude', n => n.value) === 'eve' && await page.locator('#prize-list .prize-row').count() === 2, '清空名單 clears the lists and keeps the other rules and prizes');
  check(!(await page.isChecked('#r-comment')) && !(await page.isChecked('#r-like')) && !(await page.isChecked('#r-share')), 'the list rules that came with the lists are off again');
  check((await txt('#toast')).includes('已移除全部 4 份名單，已取消第 2 步的「需要留言」、「需要按讚」') && await page.isHidden('#btn-clear-lists'), '清空名單 says what it did, then hides until there is a list again: ' + await txt('#toast'));
  check(await page.isVisible('#import-how') && await page.isHidden('#import-next'), 'with no lists, step 1 shows how to send them again');

  // ---------- Animated draw + mobile + dark screenshots ----------
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: 'dark' });
  await serveSite(ctx2);
  const p2 = await ctx2.newPage();
  p2.on('console', m => { if (m.type() === 'error') errors.push('m console: ' + m.text()); });
  p2.on('pageerror', e => errors.push('m pageerror: ' + e.message));
  await p2.goto(url);
  await p2.waitForTimeout(300);
  const order = await p2.evaluate(() => ['#sec-import', '#sec-people', '#sec-rules', '#sec-prizes', '#next-bar'].map(s => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  check(order.every((y, i) => i === 0 || y > order[i - 1]), 'phones: import, roster, rules, prizes, 去抽獎 from top to bottom ' + JSON.stringify(order));
  await p2.screenshot({ path: path.join(OUT, 'shot-draw-mobile-dark-setup.png'), fullPage: true });
  await p2.click('#btn-clear-lists');
  const box2 = await p2.$eval('#confirm', n => { const r = n.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.top), Math.round(r.bottom)]; });
  check((await p2.textContent('#confirm-title')) === '清除範例資料？' && box2[0] >= 16 && box2[1] <= 374 && box2[2] >= 0 && box2[3] <= 844, 'phones: the confirm dialog fits the screen ' + JSON.stringify(box2));
  await p2.waitForTimeout(250); // let the dialog finish fading in
  await p2.screenshot({ path: path.join(OUT, 'shot-draw-mobile-dark-confirm.png') });
  await p2.click('#confirm-cancel');
  await p2.waitForTimeout(100);
  check(await p2.isVisible('#sample-banner') && (await p2.textContent('#s-people')) === '23', 'phones: 取消 keeps the sample');
  await p2.click('#btn-try');
  await p2.waitForTimeout(200);
  const btn = await p2.$eval('#btn-draw', n => { const r = n.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; });
  check(p2.url().endsWith('#draw') && btn[0] > 0 && btn[1] <= 844, 'phones: 試抽看看 opens 抽獎 with the 抽出 1 位 button on screen ' + JSON.stringify(btn));
  await p2.click('#btn-draw');
  await p2.waitForTimeout(800);
  check(await p2.$eval('#ticket', n => n.dataset.mode) === 'rolling', 'animated draw rolls names');
  await p2.waitForTimeout(2400);
  check(await p2.$eval('#ticket', n => n.dataset.mode) === 'won', 'animated draw lands on a winner');
  const overflow = await p2.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 0, 'no horizontal overflow at 390px (overflow ' + overflow + ')');
  await p2.locator('#stage').screenshot({ path: path.join(OUT, 'shot-draw-mobile-dark-stage.png') });
  await p2.screenshot({ path: path.join(OUT, 'shot-draw-mobile-dark.png'), fullPage: true });

  // 清空名單 on the sample data clears the sample as a whole (its made-up rules and prizes too)
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await serveSite(ctx3);
  const p3 = await ctx3.newPage();
  p3.on('pageerror', e => errors.push('s pageerror: ' + e.message));
  await p3.goto(url);
  await p3.waitForTimeout(300);
  await p3.click('#btn-clear-lists');
  await p3.click('#confirm-ok');
  await p3.waitForTimeout(100);
  const s3 = await p3.evaluate(() => ({ people: document.getElementById('s-people').textContent, banner: document.getElementById('sample-banner').hidden, like: document.getElementById('r-like').checked, prizes: document.querySelectorAll('#prize-list .prize-row').length, exclude: document.getElementById('r-exclude').value }));
  check(s3.people === '0' && s3.banner && !s3.like && s3.prizes === 1 && s3.exclude === '', '清空名單 on the sample clears the sample data ' + JSON.stringify(s3));
  await ctx3.close();

  check(!errors.length, 'no page errors ' + JSON.stringify(errors));
  await browser.close();
  done();
})();
