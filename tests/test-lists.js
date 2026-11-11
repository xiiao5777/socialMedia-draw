// Draw page with real-world lists: people who share a name, CSV files saved by Excel in Big5 / GBK,
// a giveaway too big for localStorage (kept in IndexedDB instead, or a warning when it can't be kept),
// the page opened by 送到抽獎系統 when no list arrives, a giveaway that lasts while a tab has it open,
// one giveaway per platform, and 留言截止時間.
const fs = require('fs');
const { SITE, launch, serveSite, check, done, pasteInto, version } = require('./helpers');

const url = SITE + 'draw.html';
const txt = (page, s) => page.$eval(s, n => n.textContent);
function result(kind, items, extra) {
  return JSON.stringify(Object.assign({ giveaway: 'list', v: 1, tool: version(), platform: 'facebook', kind, page: 'https://www.facebook.com/p/1', at: kind + Math.random(), items }, extra || {}));
}
// Bytes of a text in an encoding Excel uses on Chinese Windows (Node has no Big5 / GBK encoder)
const BIG5 = { '名字': 'a657a672', '留言': 'af64a8a5', '陳小明': 'b3afa470a9fa', '林雅婷': 'aa4cb6aeb440', '我要抽': 'a7daad6ea9e2', '好想要': 'a66eb751ad6e' };
const GBK = { '名字': 'c3fbd7d6', '留言': 'c1f4d1d4', '陈小明': 'b3c2d0a1c3f7', '我要抽': 'ced2d2aab3e9' };
function encode(table, text) {
  const parts = [];
  for (const piece of text.split(/([^\x00-\x7f]+)/)) {
    if (!piece) continue;
    if (/^[\x00-\x7f]+$/.test(piece)) parts.push(Buffer.from(piece, 'ascii'));
    else {
      if (!table[piece]) throw new Error('no bytes for ' + piece);
      parts.push(Buffer.from(table[piece], 'hex'));
    }
  }
  return Buffer.concat(parts);
}
// A popular post: n comments with the links and tags the 抓取工具 gives
function bigList(n) {
  const items = [];
  for (let i = 0; i < n; i++) {
    const id = 100000000000000 + i * 7919;
    items.push({ name: 'Participant ' + i, handle: 'fb:' + id, text: '我要抽！好想要這個獎品 @Friend' + i + ' @Buddy' + (i + 1) + ' 謝謝分享 ' + 'x'.repeat(i % 40),
      tags: ['fb:' + (id + 1), 'fb:' + (id + 2)], url: 'https://www.facebook.com/profile.php?id=' + id,
      link: 'https://www.facebook.com/permalink.php?story_fbid=pfbid0abcdefghijklmnopqrstuvwxyz123456789&id=100064&comment_id=' + (900000000 + i) });
  }
  return result('comment', items, { at: 'big' + n });
}

(async () => {
  const browser = await launch();
  const errors = [];
  const watch = (p, tag) => {
    p.on('pageerror', e => errors.push(tag + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
  };

  // ---------- Two accounts with one name ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await serveSite(ctx);
  const page = await ctx.newPage();
  watch(page, 'names');
  await page.goto(url + '#setup');
  await page.waitForTimeout(300);
  await page.click('#btn-clear-sample');
  await pasteInto(page, '#paste', result('comment', [
    { name: 'Jason Tan', handle: 'fb:111', text: '我要抽 @a @b', url: 'https://www.facebook.com/profile.php?id=111' },
    { name: 'Jason Tan', handle: 'fb:222', text: '我要抽', url: 'https://www.facebook.com/profile.php?id=222' },
    { name: 'Jason Tan', handle: 'fb:111', text: '再留一次' },
    { name: 'Amy Lim', handle: 'fb:amy.lim', text: '我要抽' }
  ]));
  await page.click('#btn-add');
  await page.waitForTimeout(150);
  check(await txt(page, '#s-people') === '3' && await txt(page, '#s-comments') === '4', 'two accounts named Jason Tan in one list are two people (people ' + await txt(page, '#s-people') + ')');
  const notes = await page.$$eval('#people .person', ns => ns.map(n => n.querySelector('.name').textContent + ':' + (n.querySelector('.meta') || {}).textContent));
  check(notes.filter(s => s.startsWith('Jason Tan:') && s.includes('有同名的人')).length === 2 && !notes.some(s => s.startsWith('Amy Lim:') && s.includes('有同名')), 'the roster says who shares a name ' + JSON.stringify(notes));
  // The likes list links Amy differently (numeric id): still the same Amy, since only one Amy commented
  await pasteInto(page, '#paste', result('like', [{ name: 'Amy Lim', handle: 'fb:1000999' }, { name: 'Jason Tan', handle: 'fb:222' }]));
  await page.click('#btn-add');
  await page.waitForTimeout(150);
  check(await page.isChecked('#r-comment') && await page.isChecked('#r-like'), 'the comment and like lists ticked 需要留言 and 需要按讚');
  check(await txt(page, '#s-people') === '3' && await txt(page, '#s-eligible') === '2', 'a liker linked differently still meets the one Amy who commented; only the Jason who liked qualifies (eligible ' + await txt(page, '#s-eligible') + ')');
  // 排除 one Jason: the entry names the account, the other Jason keeps playing
  const jason222 = page.locator('#people .person', { has: page.locator('a[href*="id=222"]') });
  await jason222.locator('.p-side button').click();
  await page.waitForTimeout(150);
  check(await page.$eval('#r-exclude', n => n.value) === 'Jason Tan（fb:222）' && await txt(page, '#s-eligible') === '1', '排除 on one of two namesakes leaves out that account only: ' + await page.$eval('#r-exclude', n => n.value));
  await jason222.locator('.p-side button').click();
  await page.waitForTimeout(150);
  check(await page.$eval('#r-exclude', n => n.value) === '' && await txt(page, '#s-eligible') === '2', '恢復 takes the entry out again');
  // X: different @handles are different people, even in different lists
  await page.click('#btn-clear-lists'); await page.click('#confirm-ok');
  await page.waitForTimeout(150);
  check(!(await page.isChecked('#r-comment')) && !(await page.isChecked('#r-like')), '清空名單 unticks the list rules the lists ticked');
  await pasteInto(page, '#paste', result('comment', [{ name: 'Mei', handle: '@mei_1', text: 'hi' }], { platform: 'x' }));
  await page.click('#btn-add');
  await pasteInto(page, '#paste', result('like', [{ name: 'Mei', handle: '@mei_2' }], { platform: 'x' }));
  await page.click('#btn-add');
  await page.waitForTimeout(150);
  check(await txt(page, '#s-people') === '2', 'X: @mei_1 who replied and @mei_2 who liked are two people');

  // ---------- CSV files from Excel ----------
  await page.click('#btn-clear-lists'); await page.click('#confirm-ok');
  await page.setInputFiles('#file', { name: '名單.csv', mimeType: 'text/csv', buffer: encode(BIG5, '名字,留言\r\n陳小明,我要抽\r\n林雅婷,好想要\r\n') });
  await page.waitForTimeout(300);
  let names = await page.$$eval('#people .person .name', ns => ns.map(n => n.textContent));
  check(JSON.stringify(names) === '["陳小明","林雅婷"]' && (await txt(page, '#toast')).includes('Big5'), 'a Big5 CSV (Excel, 繁體 Windows) reads correctly ' + JSON.stringify(names));
  await page.click('#btn-clear-lists'); await page.click('#confirm-ok');
  await page.setInputFiles('#file', { name: 'list.csv', mimeType: 'text/csv', buffer: encode(GBK, '名字,留言\n陈小明,我要抽\n') });
  await page.waitForTimeout(300);
  names = await page.$$eval('#people .person .name', ns => ns.map(n => n.textContent));
  check(JSON.stringify(names) === '["陈小明"]' && (await txt(page, '#toast')).includes('GBK'), 'a GBK CSV (Excel, 简体 Windows) reads correctly ' + JSON.stringify(names));
  await page.click('#btn-clear-lists'); await page.click('#confirm-ok');
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('名字\t留言\r\n林雅婷\t我要抽\r\n', 'utf16le')]);
  await page.setInputFiles('#file', { name: 'list.txt', mimeType: 'text/plain', buffer: utf16 });
  await page.waitForTimeout(300);
  check(JSON.stringify(await page.$$eval('#people .person .name', ns => ns.map(n => n.textContent))) === '["林雅婷"]', 'Excel\'s 「Unicode 文字」 (UTF-16) reads correctly');
  await page.click('#btn-clear-lists'); await page.click('#confirm-ok');
  await page.setInputFiles('#file', { name: 'utf8.csv', mimeType: 'text/csv', buffer: Buffer.from('名字\nKelly 黃\n', 'utf8') });
  await page.waitForTimeout(300);
  check(JSON.stringify(await page.$$eval('#people .person .name', ns => ns.map(n => n.textContent))) === '["Kelly 黃"]' && !(await txt(page, '#toast')).includes('編碼'), 'UTF-8 without a BOM reads as before, with no note');

  // ---------- A giveaway too big for localStorage ----------
  await page.click('#btn-clear-lists'); await page.click('#confirm-ok');
  await pasteInto(page, '#paste', bigList(16000));
  await page.click('#btn-add');
  await page.waitForTimeout(2500);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway-draw:v1:facebook')));
  check(await txt(page, '#s-people') === '16000' && saved && saved.v === 1 && !!saved.big && await page.isHidden('#save-banner'), '16,000 comments go to IndexedDB, localStorage keeps a note ' + JSON.stringify(saved).slice(0, 60));
  // Typing a keyword with a big list: the counts follow once the typing pauses
  await page.type('#r-kw-text', '想要', { delay: 30 });
  await page.waitForTimeout(600);
  check(await page.isChecked('#r-kw') && await txt(page, '#s-eligible') === '16000', 'typing a keyword with a big list still updates the counts');
  await page.fill('#r-kw-text', '');
  await page.uncheck('#r-kw');
  await page.waitForTimeout(600);
  // Another tab shows it; drawing there is saved for this tab too
  const other = await ctx.newPage();
  watch(other, 'other');
  await other.goto(url + '#draw');
  await other.waitForTimeout(1500);
  check(await txt(other, '#s-people') === '16000' && await other.isHidden('#loading'), 'a second tab reads the big giveaway from IndexedDB');
  await other.click('label.switch');
  await other.click('#btn-draw');
  await other.waitForTimeout(2500);
  check((await txt(page, '#s-drawn')).startsWith('1 /'), 'a winner drawn in the second tab shows up in the first (' + await txt(page, '#s-drawn') + ')');
  await other.close();
  await page.reload();
  await page.waitForTimeout(1500);
  check(await txt(page, '#s-people') === '16000' && (await txt(page, '#s-drawn')).startsWith('1 /') && await page.isHidden('#loading'), 'after a reload the big giveaway and its winner are still there');
  // Back to a small giveaway: localStorage again, and the IndexedDB copy is deleted
  await page.click('.view-tab[data-view="draw"]');
  await page.click('#btn-wipe'); await page.click('#confirm-ok');
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => new Promise(resolve => {
    const s = localStorage.getItem('giveaway-draw:v1:facebook');
    const req = indexedDB.open('giveaway-draw-state');
    req.onsuccess = () => { const g = req.result.transaction('state').objectStore('state').get('facebook'); g.onsuccess = () => resolve({ saved: s === null ? 'gone' : 'still there', idb: g.result === undefined ? 'gone' : 'still there' }); };
  }));
  check(after.saved === 'gone' && after.idb === 'gone' && await txt(page, '#s-people') === '0' && (await txt(page, '#toast')).startsWith('已清除 Facebook 抽獎的全部資料'),
    '清除全部資料 deletes the Facebook giveaway, its IndexedDB copy included ' + JSON.stringify(after));
  // Adding to it again saves to localStorage, as a small giveaway
  await page.click('.view-tab[data-view="setup"]');
  await pasteInto(page, 'body', result('comment', [{ name: 'Amy', handle: 'fb:1', text: 'hi' }]));
  await page.waitForTimeout(800);
  const again = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway-draw:v1:facebook')));
  check(again && !again.big && again.batches.length === 1, 'a list added after that is saved in localStorage again');

  // ---------- Nowhere to keep it: say so ----------
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await serveSite(ctx2);
  await ctx2.addInitScript(() => { Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true }); });
  const p2 = await ctx2.newPage();
  watch(p2, 'noidb');
  await p2.goto(url + '#setup');
  await p2.waitForTimeout(300);
  check(await p2.isHidden('#save-banner'), 'no warning while the giveaway fits');
  await pasteInto(p2, '#paste', bigList(16000));
  await p2.click('#btn-add');
  await p2.waitForTimeout(2500);
  const banner = await p2.isVisible('#save-banner') ? await txt(p2, '#save-banner') : '';
  check(banner.includes('存不下來') && banner.includes('下載 CSV 紀錄'), 'too big and no IndexedDB: a banner says the giveaway will not survive a reload');
  await p2.click('#btn-clear-lists'); await p2.click('#confirm-ok');
  await p2.waitForTimeout(500);
  check(await p2.isHidden('#save-banner'), 'the warning goes away once the giveaway fits again');
  await ctx2.close();

  // ---------- Opened by 送到抽獎系統, but no list comes ----------
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await serveSite(ctx3);
  const p3 = await ctx3.newPage();
  watch(p3, 'receive');
  await p3.clock.install();
  await p3.goto(url + '#receive');
  await p3.waitForTimeout(300);
  check(p3.url() === url && await p3.isVisible('#recv-banner') && await txt(p3, '#recv-title') === '正在接收抓取工具送來的名單…', '#receive: says a list is on its way, and the address drops #receive (' + p3.url() + ')');
  await p3.clock.fastForward(21000);
  check(await txt(p3, '#recv-title') === '沒有收到名單。' && (await txt(p3, '#recv-text')).includes('按抓取工具上的「複製結果」'), '#receive: when nothing comes, says to copy and paste instead');
  await pasteInto(p3, '#paste', result('comment', [{ name: 'A', handle: 'fb:1', text: '我要抽' }]));
  await p3.click('#btn-add');
  check(await p3.isHidden('#recv-banner') && await txt(p3, '#s-people') === '1', 'a pasted list clears that note');
  await ctx3.close();

  // ---------- A first giveaway, step by step: step 1 says what to do, the rules follow the lists ----------
  const ctx4 = await browser.newContext({ viewport: { width: 1366, height: 620 } });
  await serveSite(ctx4);
  const p4 = await ctx4.newPage();
  watch(p4, 'novice');
  await p4.goto(url + '#setup');
  await p4.waitForTimeout(300);
  await p4.click('#btn-clear-sample');
  await p4.waitForTimeout(150);
  const ticks = () => p4.evaluate(() => ['r-comment', 'r-like', 'r-share'].map(id => document.getElementById(id).checked ? '1' : '0').join(''));
  check(await p4.isVisible('#import-how') && await p4.isVisible('#quick-paste') && !(await p4.$eval('#more-import', d => d.open)) && await ticks() === '000',
    'after 清除範例, step 1 shows how the lists arrive and a paste box, the other ways are folded, no list rule is ticked');
  // A copied result pasted in 「送不過去的話」 goes straight in
  await pasteInto(p4, '#quick-paste', result('comment', [{ name: 'Amy', handle: 'fb:1', text: '我要抽' }, { name: 'Ben', handle: 'fb:2', text: '我要抽' }]));
  await p4.waitForTimeout(150);
  check(await txt(p4, '#s-people') === '2' && await ticks() === '100' && await p4.$eval('#quick-paste', n => n.value) === '', 'a copied comment list pasted in 送不過去的話 goes straight in and ticks 需要留言');
  check((await txt(p4, '#recv-title')).startsWith('已貼上 Facebook 的留言名單：加入 2 則留言') && (await txt(p4, '#recv-text')).includes('已勾選第 2 步的「需要留言」，不需要的話可以取消') && (await txt(p4, '#recv-text')).includes('還要抓按讚或分享的人'),
    'the banner says what came in, which rule it ticked and what is left: ' + await txt(p4, '#recv-text'));
  check(await p4.isHidden('#import-how') && (await txt(p4, '#import-next')).includes('還要抓按讚或分享的人'), 'step 1 then says what is left instead of the how-to');
  // Ctrl+V anywhere on the page works too
  await pasteInto(p4, 'body', result('like', [{ name: 'Amy', handle: 'fb:1' }]));
  await p4.waitForTimeout(150);
  check(await p4.locator('#batches .batch').count() === 2 && await ticks() === '110' && await txt(p4, '#s-eligible') === '1' && (await txt(p4, '#recv-text')).includes('還要抓分享的人'),
    'a like list pasted anywhere on the page ticks 需要按讚 (eligible ' + await txt(p4, '#s-eligible') + ')');
  await pasteInto(p4, 'body', result('share', [{ name: 'Ben', handle: 'fb:2' }]));
  await p4.waitForTimeout(150);
  check(await ticks() === '111' && (await txt(p4, '#recv-text')).includes('三份名單都到了') && (await txt(p4, '#import-next')).includes('三份名單都到了'), 'with all three lists in, the banner and step 1 say to check the rules and go draw');
  // Removing a list unticks its rule; a rule set by hand stays as it is
  await p4.uncheck('#r-share');
  await p4.locator('#batches .batch', { has: p4.locator('.pill-like') }).locator('button').click();
  await p4.click('#confirm-ok');
  await p4.waitForTimeout(150);
  check(await ticks() === '100' && (await txt(p4, '#toast')).includes('已取消第 2 步的「需要按讚」'), 'removing the like list unticks 需要按讚 and says so');
  await p4.locator('#batches .batch', { has: p4.locator('.pill-share') }).locator('button').click();
  await p4.click('#confirm-ok');
  await p4.waitForTimeout(150);
  await pasteInto(p4, 'body', result('share', [{ name: 'Ben', handle: 'fb:2' }]));
  await p4.waitForTimeout(150);
  check(await p4.locator('#batches .batch').count() === 2 && await ticks() === '100', '需要分享, unticked by hand, stays off when a share list comes again');
  // Names that are not a copied result go to 手動貼上, opened
  await pasteInto(p4, '#quick-paste', 'Carl\nDora');
  await p4.waitForTimeout(300);
  check(await p4.$eval('#more-import', d => d.open) && await p4.$eval('#paste', n => n.value) === 'Carl\nDora' && (await txt(p4, '#preview')).includes('讀到 2 筆') && await txt(p4, '#s-people') === '2',
    'plain names pasted in the quick box open 手動貼上 with the names in it, nothing added yet');
  // 抽出 1 位 fits a 1366×620 laptop screen: from 下一步：去抽獎 at the end of 準備, and from the 抽獎
  // tab at the top of the page (which scrolls the page header away)
  await p4.click('#btn-go-draw');
  await p4.waitForTimeout(300);
  const drawBtn = () => p4.$eval('#btn-draw', b => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom)]; });
  const b1 = await drawBtn();
  await p4.click('#btn-recv-ok');
  await p4.click('.view-tab[data-view="setup"]');
  await p4.evaluate(() => window.scrollTo(0, 0));
  await p4.waitForTimeout(100);
  await p4.click('.view-tab[data-view="draw"]');
  await p4.waitForTimeout(300);
  const b2 = await drawBtn();
  const barOk = await p4.$eval('.views-bar', n => n.getBoundingClientRect().top >= 0 && n.getBoundingClientRect().bottom < 140);
  check(b1[0] > 0 && b1[1] <= 620 && b2[0] > 0 && b2[1] <= 620 && barOk, '抽出 1 位 is on screen at 1366×620, with the tabs still there ' + JSON.stringify([b1, b2]));
  await ctx4.close();

  // ---------- 關掉分頁就清除: a giveaway lasts while a tab that has it is open ----------
  const ctx5 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await serveSite(ctx5);
  const stores = (p) => p.evaluate(() => new Promise(resolve => {
    const out = { keys: Object.keys(localStorage).filter(k => !k.startsWith('giveaway-draw:open:')).sort().join() };
    const r1 = indexedDB.open('giveaway-draw-state');
    r1.onsuccess = () => {
      const db = r1.result;
      if (!db.objectStoreNames.contains('state')) { out.big = 'none'; avs(); return; }
      const g = db.transaction('state').objectStore('state').count();
      g.onsuccess = () => { out.big = g.result ? 'saved' : 'none'; avs(); };
    };
    function avs() {
      const r2 = indexedDB.open('giveaway-draw-avatars');
      r2.onsuccess = () => {
        const db = r2.result;
        if (!db.objectStoreNames.contains('avatars')) { out.avatars = 0; resolve(out); return; }
        const c = db.transaction('avatars').objectStore('avatars').count();
        c.onsuccess = () => { out.avatars = c.result; resolve(out); };
      };
    }
  }));
  const t1 = await ctx5.newPage();
  watch(t1, 'tab1');
  await t1.goto(url + '#setup');
  await t1.waitForTimeout(300);
  await pasteInto(t1, '#paste', bigList(16000));
  await t1.click('#btn-add');
  await t1.waitForTimeout(2500);
  await pasteInto(t1, 'body', result('like', [{ name: 'Amy', handle: 'fb:amy' }], { avatars: { 'fb:amy': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' } }));
  await t1.waitForTimeout(1500);
  check(await txt(t1, '#s-people') === '16001' && (await stores(t1)).big === 'saved' && (await stores(t1)).avatars === 1, 'a big giveaway with an avatar is saved ' + JSON.stringify(await stores(t1)));
  await t1.reload();
  await t1.waitForTimeout(1500);
  check(await txt(t1, '#s-people') === '16001', 'a reload keeps the giveaway');
  // A duplicated tab copies sessionStorage: closing one of the two leaves the other listed
  const openCount = (p) => p.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('giveaway-draw:open:')).length);
  const dup = await ctx5.newPage();
  watch(dup, 'dup');
  await dup.goto(SITE);
  await dup.evaluate((n) => sessionStorage.setItem('giveaway-draw:tab', n), await t1.evaluate(() => sessionStorage.getItem('giveaway-draw:tab')));
  await dup.goto(url);
  await dup.waitForTimeout(1500);
  const dupOk = await txt(dup, '#s-people') === '16001' && await openCount(dup) === 2;
  await dup.close();
  const t6 = await ctx5.newPage();
  watch(t6, 'tab6');
  await t6.goto(url);
  await t6.waitForTimeout(1500);
  check(dupOk && await txt(t6, '#s-people') === '16001' && await openCount(t6) === 2, 'closing a duplicated tab keeps the giveaway for the tab it was copied from');
  await t6.close();
  // This tab goes to the homepage: the giveaway is still open in it
  await t1.goto(SITE);
  await t1.waitForTimeout(300);
  check(await t1.isVisible('#resume') && (await txt(t1, '#resume-text')).includes('關掉所有抽獎系統的分頁，這場抽獎就會清除'), 'the homepage in that tab says the giveaway is open and when it goes away');
  const t2 = await ctx5.newPage();
  watch(t2, 'tab2');
  await t2.goto(url);
  await t2.waitForTimeout(1500);
  check(await txt(t2, '#s-people') === '16001', 'a new draw tab shows it while another tab has it open');
  await t2.close();
  await t1.goto(url);
  await t1.waitForTimeout(1500);
  check(await txt(t1, '#s-people') === '16001', 'back on the draw page in the same tab, it is all there');
  // Close the last tab: the next visit starts over, with nothing left behind
  await t1.close();
  const h = await ctx5.newPage();
  watch(h, 'home-after');
  await h.goto(SITE);
  await h.waitForTimeout(300);
  check(await h.isHidden('#resume') && (await h.$eval('#cta-draw', a => a.textContent + (a.classList.contains('btn-primary') ? '*' : ''))) === '開始抽獎*' && await h.isVisible('#whats-new'),
    'after closing it, the homepage offers a new giveaway (as to someone who used it before)');
  const t3 = await ctx5.newPage();
  watch(t3, 'tab3');
  await t3.goto(url);
  await t3.waitForTimeout(800);
  const st3 = await stores(t3);
  check(await txt(t3, '#s-people') === '0' && await t3.isHidden('#sample-banner') && await t3.isVisible('#import-how'), 'the next draw tab starts empty, without the sample');
  check(st3.keys === 'giveaway-draw:used' && st3.big === 'none' && st3.avatars === 0, 'the closed giveaway is deleted: lists, summary, IndexedDB copy and avatars ' + JSON.stringify(st3));
  // A tab that is asleep (still listed) keeps it; one not heard from for 12 hours does not
  await pasteInto(t3, 'body', result('comment', [{ name: 'Ben', handle: 'fb:ben', text: 'hi' }]));
  await t3.waitForTimeout(300);
  await t3.evaluate(() => localStorage.setItem('giveaway-draw:open:asleep', Date.now() + '|facebook'));
  await t3.close();
  const t4 = await ctx5.newPage();
  watch(t4, 'tab4');
  await t4.goto(url);
  await t4.waitForTimeout(500);
  check(await txt(t4, '#s-people') === '1', 'a tab still listed (asleep in the background) keeps the giveaway');
  await t4.evaluate(() => localStorage.setItem('giveaway-draw:open:asleep', (Date.now() - 13 * 3600 * 1000) + '|facebook'));
  await t4.close();
  const t5 = await ctx5.newPage();
  watch(t5, 'tab5');
  await t5.goto(url);
  await t5.waitForTimeout(500);
  check(await txt(t5, '#s-people') === '0' && await t5.evaluate(() => localStorage.getItem('giveaway-draw:open:asleep')) === null, 'a tab not heard from for 12 hours is forgotten, and the giveaway with it');
  // A tab opened before this version has neither the note nor a listing, and its giveaway is in the
  // old place: a reload still keeps it, as the giveaway of its list's platform
  await pasteInto(t5, 'body', result('comment', [{ name: 'Cy', handle: 'fb:cy', text: 'hi' }], { avatars: { 'fb:cy': 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' } }));
  await t5.waitForTimeout(500);
  await t5.evaluate(() => new Promise(resolve => {
    sessionStorage.clear();
    Object.keys(localStorage).filter(k => k.startsWith('giveaway-draw:open:')).forEach(k => localStorage.removeItem(k));
    for (const [from, to] of [['giveaway-draw:v1:facebook', 'giveaway-draw:v1'], ['giveaway-draw:summary:facebook', 'giveaway-draw:summary']]) {
      const sum = JSON.parse(localStorage.getItem(from));
      delete sum.gid;
      localStorage.setItem(to, JSON.stringify(sum));
      localStorage.removeItem(from);
    }
    history.replaceState(null, '', location.pathname);
    // The older version kept avatars without the giveaway id
    const r = indexedDB.open('giveaway-draw-avatars');
    r.onsuccess = () => {
      const tx = r.result.transaction('avatars', 'readwrite'), st = tx.objectStore('avatars');
      const g = st.get('facebook\nfb:cy');
      g.onsuccess = () => { st.delete('facebook\nfb:cy'); st.put(g.result, 'fb:cy'); };
      tx.oncomplete = () => resolve();
    };
  }));
  await t5.reload();
  await t5.waitForTimeout(800);
  const moved = await t5.evaluate(() => ({ url: location.search, old: localStorage.getItem('giveaway-draw:v1'), now: !!localStorage.getItem('giveaway-draw:v1:facebook'), av: !!document.querySelector('#people .person img') }));
  check(await txt(t5, '#s-people') === '1' && await openCount(t5) === 1 && moved.url === '?g=facebook' && moved.old === null && moved.now && moved.av,
    'a reload keeps the giveaway of a tab opened before this version, moved to the Facebook giveaway with its avatar ' + JSON.stringify(moved));
  // Back from the back-forward cache, the page shows what is saved now: unchanged, or deleted meanwhile by a new tab
  const backFromCache = () => t5.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await backFromCache();
  await t5.waitForTimeout(300);
  const kept = await txt(t5, '#s-people');
  await t5.evaluate(() => localStorage.removeItem('giveaway-draw:v1:facebook'));
  await backFromCache();
  await t5.waitForTimeout(300);
  check(kept === '1' && await txt(t5, '#s-people') === '0', 'back from the back-forward cache, a page shows the giveaway as saved now (' + kept + ', then deleted)');
  await ctx5.close();

  // ---------- One giveaway per platform, each in its own tab ----------
  const ctx6 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await serveSite(ctx6);
  const ticksOf = (p) => p.evaluate(() => ['r-comment', 'r-like', 'r-share'].map(id => document.getElementById(id).checked ? '1' : '0').join(''));
  const switcher = async (p) => await p.isHidden('#gsw') ? 'hidden' : (await p.$$eval('#gsw .gsw-btn', bs => bs.map(b => b.textContent + (b.getAttribute('aria-pressed') === 'true' ? '*' : '')))).join(' ');
  const xList = (kind, items) => result(kind, items, { platform: 'x', page: 'https://x.com/brand/status/1' });
  const fb = await ctx6.newPage();
  watch(fb, 'fb-tab');
  await fb.goto(url + '#setup');
  await fb.waitForTimeout(300);
  await pasteInto(fb, 'body', result('comment', [{ name: 'Amy', handle: 'fb:1', text: '我要抽' }, { name: 'Ben', handle: 'fb:2', text: '我要抽' }]));
  await fb.waitForTimeout(300);
  check(fb.url() === url + '?g=facebook#setup' && await fb.title() === 'Facebook 抽獎｜抽獎系統' && await txt(fb, '#s-people') === '2' && await switcher(fb) === 'hidden',
    'a Facebook list makes the tab the Facebook giveaway (' + fb.url() + ')');
  // The tab 送到抽獎系統 opens for X: its own giveaway, next to the Facebook one
  const xt = await ctx6.newPage();
  watch(xt, 'x-tab');
  await xt.goto(url + '?g=x#setup');
  await xt.waitForTimeout(500);
  check(await xt.title() === 'X 抽獎｜抽獎系統' && await txt(xt, '#s-people') === '0' && await xt.isHidden('#sample-banner') && await switcher(xt) === 'Facebook2 位 X0 位*',
    'a tab opened for X shows an empty X giveaway, and the switcher lists the Facebook one (' + await switcher(xt) + ')');
  await pasteInto(xt, 'body', xList('like', [{ name: 'Cat', handle: '@cat' }, { name: 'Dan', handle: '@dan' }, { name: 'Eve', handle: '@eve' }]));
  await xt.waitForTimeout(500);
  check(await txt(xt, '#s-people') === '3' && await ticksOf(xt) === '010' && await txt(fb, '#s-people') === '2' && await ticksOf(fb) === '100',
    'each giveaway has its own lists and rules (X ' + await ticksOf(xt) + ', Facebook ' + await ticksOf(fb) + ')');
  check(await switcher(fb) === 'Facebook2 位* X3 位', 'the Facebook tab lists the X giveaway once it has people (' + await switcher(fb) + ')');
  // Drawing in one does not lock the other
  await fb.click('.view-tab[data-view="draw"]');
  await fb.click('label.switch');
  await fb.click('#btn-draw');
  await fb.waitForTimeout(2500);
  await pasteInto(xt, 'body', xList('comment', [{ name: 'Cat', handle: '@cat', text: 'me' }]));
  await xt.waitForTimeout(500);
  check((await txt(fb, '#s-drawn')).startsWith('1 /') && await xt.locator('#batches .batch').count() === 2 && await ticksOf(xt) === '110' && (await txt(xt, '#s-drawn')).startsWith('0 /'),
    'with a Facebook winner drawn, the X giveaway still takes lists (' + await txt(fb, '#s-drawn') + ')');
  // The homepage lists both
  const home6 = await ctx6.newPage();
  watch(home6, 'home-two');
  await home6.goto(SITE);
  await home6.waitForTimeout(300);
  const rt = await txt(home6, '#resume-text');
  check(await txt(home6, '#resume-title') === '你有 2 場抽獎還開著' && /^X：參加者 3 位，還沒開始抽.*；Facebook：參加者 2 位，/.test(rt) && rt.endsWith('每個平台各一場，關掉那場的分頁，那場就會清除。'),
    'the homepage lists both giveaways, the latest first: ' + rt);
  await home6.close();
  // Closing the X tab: the homepage lists the Facebook giveaway only, and the next draw tab deletes the X one
  await xt.close();
  const home7 = await ctx6.newPage();
  watch(home7, 'home-one');
  await home7.goto(SITE);
  await home7.waitForTimeout(300);
  const rt7 = await txt(home7, '#resume-text');
  check(await txt(home7, '#resume-title') === '你的抽獎還開著' && /^Facebook：參加者 2 位，全部 1 名都抽完了.*。關掉所有抽獎系統的分頁，這場抽獎就會清除。$/.test(rt7) && await txt(home7, '#cta-draw') === '查看抽獎結果',
    'with the X tab closed, the homepage lists the Facebook giveaway, all drawn: ' + rt7);
  await home7.close();
  const nt = await ctx6.newPage();
  watch(nt, 'next-tab');
  await nt.goto(url);
  await nt.waitForTimeout(800);
  check(await nt.title() === 'Facebook 抽獎｜抽獎系統' && (await txt(nt, '#s-drawn')).startsWith('1 /') && await nt.evaluate(() => localStorage.getItem('giveaway-draw:v1:x')) === null && await switcher(nt) === 'hidden' && await switcher(fb) === 'hidden',
    'after the X tab is closed, a new tab deletes the X giveaway and shows the Facebook one, still open in its tab');
  await nt.close();
  // An X list pasted in the Facebook tab (which has a winner) goes to a new X giveaway: the tab says so
  await fb.click('.view-tab[data-view="setup"]');
  await pasteInto(fb, 'body', xList('share', [{ name: 'Dan', handle: '@dan' }]));
  await fb.waitForTimeout(500);
  check(fb.url() === url + '?g=x#setup' && await fb.title() === 'X 抽獎｜抽獎系統' && await txt(fb, '#s-people') === '1' && await ticksOf(fb) === '001' && await switcher(fb) === 'Facebook2 位 X1 位*',
    'an X list pasted in the Facebook tab starts the X giveaway there (' + fb.url() + ')');
  check((await txt(fb, '#recv-text')).startsWith('這份放進 X 的抽獎，Facebook 的抽獎還在，用上面「你的抽獎」的按鈕切換。'), 'the banner says where it went and that the Facebook giveaway is still there: ' + await txt(fb, '#recv-text'));
  await fb.click('#gsw .gsw-btn[data-g="facebook"]');
  await fb.waitForTimeout(300);
  check(fb.url() === url + '?g=facebook#setup' && (await txt(fb, '#s-drawn')).startsWith('1 /') && await ticksOf(fb) === '100' && (await txt(fb, '#toast')).startsWith('現在顯示 Facebook 的抽獎'),
    'the switcher shows the Facebook giveaway again, its winner and rules as they were');
  await ctx6.close();

  // ---------- 留言截止時間: only comments left before it count ----------
  // The time typed is the browser's own (Malaysia here, UTC+8): 12:00 there is 04:00 UTC.
  const ctx8 = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'Asia/Kuala_Lumpur' });
  await serveSite(ctx8);
  const dl = await ctx8.newPage();
  watch(dl, 'deadline');
  await dl.goto(url + '#setup');
  await dl.waitForTimeout(300);
  await dl.click('#btn-clear-sample');
  // A person's row: what it says about them | why they do not qualify
  const row = (p, name) => p.locator('#people .person', { has: p.locator('.name', { hasText: new RegExp('^' + name + '(@\\w+)?$') }) });
  const rowText = (p, name) => row(p, name).evaluate(n => ((n.querySelector('.meta') || {}).textContent || '') + '|' + ((n.querySelector('.reasons') || {}).textContent || ''));
  // X replies have their exact time; Dan's list came from an older tool, without times
  await pasteInto(dl, '#paste', xList('comment', [
    { name: 'Ann', handle: '@ann', text: '我要抽 @a1 @a2', time: '2026-11-10T03:00:00.000Z' },
    { name: 'Ben', handle: '@ben', text: '我要抽 @b1 @b2', time: '2026-11-10T05:00:00.000Z' },
    { name: 'Cat', handle: '@cat', text: 'hi', time: '2026-11-10T02:00:00.000Z' },
    { name: 'Cat', handle: '@cat', text: '我要抽 @c1 @c2', time: '2026-11-10T06:00:00.000Z' },
    { name: 'Dan', handle: '@dan', text: '我要抽 @d1 @d2' }
  ]));
  await dl.click('#btn-add');
  await dl.waitForTimeout(200);
  check(await txt(dl, '#s-people') === '4' && await txt(dl, '#s-eligible') === '4' && !(await dl.isChecked('#r-time')) && await dl.isHidden('#r-time-note'), 'replies with times: no deadline yet, everyone who replied qualifies');
  await dl.fill('#r-time-at', '2026-11-10T12:00');
  await dl.waitForTimeout(200);
  const note = await txt(dl, '#r-time-note');
  check(await dl.isChecked('#r-time') && await txt(dl, '#s-eligible') === '3' && note.startsWith('截止時間是 2026/11/10 12:00，之後的 2 則留言不算。有 1 則留言沒有時間') && await dl.$eval('#r-time-note', n => n.classList.contains('warn')),
    'typing a deadline ticks the rule; the note counts what it left out and what has no time: ' + note);
  check((await rowText(dl, 'Ben')).endsWith('|截止時間後才留言') && (await rowText(dl, 'Cat')).includes('截止後的 1 則不算') && !(await rowText(dl, 'Cat')).includes('標記') && (await rowText(dl, 'Ann')).endsWith('標記 2 位|') && (await rowText(dl, 'Dan')).endsWith('|'),
    'Ben replied only after it, one of Cat\'s two replies was late, Dan has no time and counts ' + JSON.stringify([await rowText(dl, 'Ben'), await rowText(dl, 'Cat')]));
  // The keyword and tag rules count the replies before the deadline only
  await dl.fill('#r-kw-text', '我要抽');
  await dl.check('#r-tag');
  await dl.waitForTimeout(200);
  check(await txt(dl, '#s-eligible') === '2' && (await rowText(dl, 'Cat')).endsWith('|只標記 0 位（需要 1 位）、留言沒有關鍵字') && (await rowText(dl, 'Ben')).endsWith('|截止時間後才留言'),
    'Cat\'s keyword and tags came after the deadline, so they do not count: ' + await rowText(dl, 'Cat'));
  const chips = await dl.$$eval('#rule-sum .rs-chip', cs => cs.map(c => c.textContent));
  check(chips.includes('只算 11/10 12:00 前的留言'), 'the draw page lists the deadline with the rules ' + JSON.stringify(chips));
  await dl.uncheck('#r-time');
  await dl.waitForTimeout(200);
  check(await txt(dl, '#s-eligible') === '4' && await dl.isHidden('#r-time-note'), 'unticking the deadline counts every reply again');
  await dl.check('#r-time');
  await dl.waitForTimeout(200);
  check(await txt(dl, '#s-eligible') === '2', 'ticking it again uses the time still typed');

  // Facebook says only 「1天」: a comment whose span takes in the deadline counts, and is marked
  await pasteInto(dl, '#paste', result('comment', [
    { name: 'Amy', handle: 'fb:91', text: '我要抽', timeFrom: '2026-11-09T20:00:00.000Z', timeTo: '2026-11-10T10:00:00.000Z', timeText: '1天', link: 'https://www.facebook.com/p/1?comment_id=11' },
    { name: 'Bob', handle: 'fb:92', text: '我要抽', timeFrom: '2026-11-09T00:00:00.000Z', timeTo: '2026-11-09T12:00:00.000Z', timeText: '2天' },
    { name: 'Cid', handle: 'fb:93', text: '我要抽', timeFrom: '2026-11-10T06:00:00.000Z', timeTo: '2026-11-10T08:00:00.000Z', timeText: '3小時' },
    { name: 'Dee', handle: 'fb:94', text: '我要抽' }
  ]));
  await dl.click('#btn-add');
  await dl.waitForTimeout(300);
  check(dl.url() === url + '?g=facebook#setup' && await txt(dl, '#s-people') === '4' && !(await dl.isChecked('#r-time')) && await dl.$eval('#r-time-at', n => n.value) === '',
    'the Facebook list starts its own giveaway, with no deadline yet (' + dl.url() + ')');
  await dl.check('#r-time');
  await dl.waitForTimeout(200);
  check(await dl.evaluate(() => document.activeElement && document.activeElement.id) === 'r-time-at' && await txt(dl, '#r-time-note') === '填好截止時間才會生效。' && await txt(dl, '#s-eligible') === '4',
    'ticking the rule with no time typed asks for the time and leaves out nobody');
  await dl.fill('#r-time-at', '2026-11-10T12:00');
  await dl.waitForTimeout(200);
  const fbNote = await txt(dl, '#r-time-note');
  const unsure = await row(dl, 'Amy').evaluate(n => {
    const u = n.querySelector('.meta .unsure'), a = u && u.querySelector('a');
    return u ? u.textContent + ' ' + (a ? a.getAttribute('href') : '') : '';
  });
  check(await txt(dl, '#s-eligible') === '3' && (await rowText(dl, 'Cid')).endsWith('|截止時間後才留言') && (await rowText(dl, 'Bob')).endsWith('|'),
    'Bob (「2天」, before it) counts, Cid (「3小時」, after it) does not ' + await rowText(dl, 'Cid'));
  check(unsure === '留言時間不確定（1天），看留言 ↗ https://www.facebook.com/p/1?comment_id=11' && fbNote.includes('之後的 1 則留言不算。有 1 則 Facebook 留言只顯示「1天」這種時間'),
    'Amy\'s 「1天」 may be before or after it: she counts, marked, with a link to her comment: ' + unsure + ' / ' + fbNote);
  // A winner's comment time goes in the CSV: Facebook's span, in the browser's time
  await dl.fill('#r-exclude', 'Bob\nDee');
  await dl.waitForTimeout(200);
  check(await txt(dl, '#s-eligible') === '1', 'with Bob and Dee left out, only Amy is in the draw');
  await dl.click('.view-tab[data-view="draw"]');
  await dl.click('label.switch');
  await dl.click('#btn-draw');
  await dl.waitForFunction(() => !document.getElementById('btn-csv').disabled, null, { timeout: 8000 });
  await dl.waitForTimeout(300);
  const [csvDl] = await Promise.all([dl.waitForEvent('download'), dl.click('#btn-csv')]);
  const rows8 = fs.readFileSync(await csvDl.path(), 'utf8').replace(/^\uFEFF/, '').split('\r\n');
  check(rows8[0].includes(',留言連結,留言時間,狀態,') && rows8[1].includes(',Amy,') && rows8[1].includes(',https://www.facebook.com/p/1?comment_id=11,約 2026/11/10 04:00 ~ 2026/11/10 18:00,有效,'),
    'the CSV gives the winner\'s comment time as the span Facebook allows: ' + rows8[1]);
  await dl.click('.view-tab[data-view="setup"]');
  await dl.waitForTimeout(150);
  check(await dl.isDisabled('#r-time-at') && await dl.isDisabled('#r-time'), 'the deadline locks with the other rules once the draw starts');
  await ctx8.close();

  check(!errors.length, 'no page errors ' + JSON.stringify(errors));
  await browser.close();
  done();
})();
