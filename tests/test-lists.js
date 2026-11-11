// Draw page with real-world lists: people who share a name, CSV files saved by Excel in Big5 / GBK,
// a giveaway too big for localStorage (kept in IndexedDB instead, or a warning when it can't be kept),
// and the page opened by 送到抽獎系統 when no list arrives.
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
  await page.click('#r-like');
  await page.waitForTimeout(150);
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
  await page.click('#r-like');
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
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('giveaway-draw:v1')));
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
    const s = JSON.parse(localStorage.getItem('giveaway-draw:v1'));
    const req = indexedDB.open('giveaway-draw-state');
    req.onsuccess = () => { const g = req.result.transaction('state').objectStore('state').get('state'); g.onsuccess = () => resolve({ big: !!s.big, batches: (s.batches || []).length, idb: g.result === undefined ? 'gone' : 'still there' }); };
  }));
  check(!after.big && after.batches === 0 && after.idb === 'gone', '清除全部資料 saves to localStorage again and deletes the IndexedDB copy ' + JSON.stringify(after));

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

  check(!errors.length, 'no page errors ' + JSON.stringify(errors));
  await browser.close();
  done();
})();
