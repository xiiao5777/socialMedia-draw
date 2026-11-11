// The 抓取工具 bookmarklet (as built into index.html) on simulated Facebook, X and Threads pages.
// Writes each result to tests/out/sample-*.json for test-site.js.
const fs = require('fs');
const path = require('path');
const mocks = require('./mocks.js');
const { colorOf, serveImage } = require('./avatars-mock.js');
const { SITE, OUT, launch, serveSiteFile, serveNoFonts, bookmarklet, version, check, done, pasteInto } = require('./helpers.js');
const BM = bookmarklet();
const code = BM.code;
const VER = version();

// A browser with the simulated sites and the Pages site.
async function newCtx(browser, imgLog = []) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 720 } });
  await ctx.route('**/*', (route) => {
    if (serveImage(route, imgLog)) return;
    if (serveSiteFile(route) || serveNoFonts(route)) return;
    const u = route.request().url().replace(/[?#].*$/, '');
    const key = Object.keys(mocks).find(k => k === u) || (u === 'https://www.facebook.com/' ? 'https://example.com/' : null);
    if (!key) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mocks[key]() });
  });
  return ctx;
}

// opts.viaLink: run the bookmark address itself, as a click on the bookmarks bar does.
async function runOn(browser, url, opts = {}) {
  const imgLog = [];
  const ctx = await newCtx(browser, imgLog);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(200);
  if (opts.before) { await opts.before(page); await page.waitForTimeout(400); }
  const t0 = Date.now();
  if (opts.viaLink) {
    await page.evaluate((href) => { const a = document.createElement('a'); a.href = href; a.textContent = '抓取抽獎名單'; document.body.prepend(a); a.click(); a.remove(); }, BM.href);
  } else await page.evaluate(code);
  let result = null, raw = '';
  if (!opts.noWait) {
    try {
      await page.waitForFunction(() => window.__giveawayResult || /沒有抓到資料/.test(document.getElementById('giveaway-collector-host')?.shadowRoot?.textContent || ''), null, { timeout: 120000, polling: 500 });
      raw = await page.evaluate(() => window.__giveawayResult) || '';
      result = raw ? JSON.parse(raw) : null;
    } catch (e) { errors.push('timeout: ' + e.message.split('\n')[0]); }
  } else {
    await page.waitForTimeout(800);
  }
  const ms = Date.now() - t0;
  const panelText = await panel(page);
  return { ctx, page, result, raw, errors, panelText, imgLog, ms };
}
const panel = (page) => page.evaluate(() => document.getElementById('giveaway-collector-host')?.shadowRoot?.textContent || '');
const btn = (page, text) => page.locator('#giveaway-collector-host button', { hasText: text });
// The next finished list after `prev` (each run stores its JSON in window.__giveawayResult).
async function nextResult(page, prev) {
  try {
    await page.waitForFunction((p) => window.__giveawayResult && window.__giveawayResult !== p, prev, { timeout: 60000, polling: 300 });
  } catch (e) { return { raw: '', result: null }; }
  const raw = await page.evaluate(() => window.__giveawayResult);
  return { raw, result: JSON.parse(raw) };
}
const copyNow = async (page) => { await page.bringToFront(); await btn(page, /複製結果|已複製|再複製一次/).first().click(); await page.waitForTimeout(300); };
// The panel's big number and what follows it, e.g. "22/ 22 則留言"
const countLine = (page) => page.evaluate(() => { const n = document.getElementById('giveaway-collector-host').shadowRoot.querySelector('span[style*="tabular-nums"]'); return n.textContent + n.nextSibling.textContent; });
const hasGoOn = async (page) => await btn(page, /^繼續抓$/).count() === 1;
// 送到抽獎系統, then the panel's answer once the draw page has replied
async function sendNow(page) {
  await page.bringToFront();
  await btn(page, '送到抽獎系統').click();
  await page.waitForFunction(() => /已送到抽獎系統|沒辦法直接送過去|鎖住|讀不懂|正在抽獎/.test(document.getElementById('giveaway-collector-host').shadowRoot.textContent), null, { timeout: 20000, polling: 200 }).catch(() => {});
  return panel(page);
}
const draws = (ctx) => ctx.pages().filter(p => p.url().startsWith(SITE + 'draw.html'));

// Centre colour of an avatar thumbnail, compared with the colour the simulated CDN served.
async function avatarMatches(page, dataUrl, srcUrl) {
  if (!dataUrl) return false;
  const px = await page.evaluate((d) => new Promise((res) => {
    const i = new Image();
    i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); res(Array.from(g.getImageData(i.width >> 1, i.height >> 1, 1, 1).data)); };
    i.onerror = () => res(null);
    i.src = d;
  }), dataUrl);
  const want = colorOf(srcUrl);
  return !!px && want.every((v, k) => Math.abs(v - px[k]) <= 12);
}

(async () => {
  const browser = await launch();
  const t0 = Date.now();

  // Facebook post with comments, replies, hidden comments, "see more"
  let r = await runOn(browser, 'https://www.facebook.com/brandpage/posts/pfbid0abc');
  const fb = r.result;
  check(fb && fb.platform === 'facebook' && fb.kind === 'comment' && fb.tool === VER, 'FB: comment mode detected, tool ' + VER);
  check(fb && fb.items.length === 22, 'FB: 20 comments + 2 replies collected (got ' + (fb && fb.items.length) + ')');
  const names = fb ? fb.items.map(i => i.name) : [];
  check(names.includes('蔡宜臻') && names.includes('Ong Wei Jie'), 'FB: comments behind "查看更多留言" collected');
  check(fb && fb.items.some(i => i.name === '王大同') && fb.items.some(i => i.name === '黃志豪'), 'FB: hidden comments revealed after switching to 所有留言');
  const xm = fb && fb.items.find(i => i.name === '陳小明');
  check(xm && xm.handle === 'fb:xiaoming.chen' && xm.tags && xm.tags.length === 2, 'FB: author handle and 2 tags (' + JSON.stringify(xm) + ')');
  const ly = fb && fb.items.filter(i => i.name === '林雅婷');
  check(ly && ly.length === 2 && ly.every(i => i.handle === 'fb:100045'), 'FB: profile.php id handle, reply counted as a comment');
  const long = fb && fb.items.find(i => i.name === '黃志豪');
  check(long && /後半段/.test(long.text), 'FB: "查看更多" expanded long comment (' + (long && long.text) + ')');
  check(fb && !fb.items.some(i => i.name === '我自己'), 'FB: page header links ignored');
  // links
  check(xm && xm.url === 'https://www.facebook.com/xiaoming.chen' && xm.link === 'https://www.facebook.com/brandpage/posts/pfbid0abc?comment_id=C1', 'FB: profile link and comment link (' + (xm && xm.url + ' ' + xm.link) + ')');
  const lyReply = ly && ly.find(i => /reply_comment_id/.test(i.link || ''));
  check(lyReply && lyReply.link === 'https://www.facebook.com/brandpage/posts/pfbid0abc?comment_id=C2&reply_comment_id=R1' && lyReply.url === 'https://www.facebook.com/profile.php?id=100045', 'FB: reply link and profile.php link (' + JSON.stringify(lyReply) + ')');
  check(fb && fb.items.every(i => /^https:\/\/www\.facebook\.com\//.test(i.url || '') && /comment_id=/.test(i.link || '')), 'FB: every comment has a profile link and a comment link');
  // avatars
  const av = (fb && fb.avatars) || {};
  check(Object.keys(av).length === 20 && !av['fb:jason.tan.9'], 'FB: 20 of 21 avatars (the one without CORS is left out) (got ' + Object.keys(av).length + ')');
  check(Object.values(av).every(d => /^data:image\/(webp|jpeg);base64,/.test(d) && d.length < 12000), 'FB: avatars are small webp/jpeg data URLs (max ' + Math.max(0, ...Object.values(av).map(d => d.length)) + ' chars)');
  check(await avatarMatches(r.page, av['fb:xiaoming.chen'], 'https://scontent.xx.fbcdn.net/v/t39.30808-1/xiaoming_chen_n.jpg'), 'FB: 陳小明 has his own avatar');
  check(await avatarMatches(r.page, av['fb:datong.wang'], 'https://scontent.xx.fbcdn.net/v/t39.30808-1/datong_wang_n.jpg'), 'FB: photo in a comment is not used as the avatar');
  check(await avatarMatches(r.page, av['fb:peishan.li'], 'https://scontent.xx.fbcdn.net/v/t39.30808-1/peishan_li_n.jpg'), 'FB: emoji in a comment is not used as the avatar');
  check(await avatarMatches(r.page, av['fb:100045'], 'https://scontent.xx.fbcdn.net/v/t39.30808-1/profile_php_id_100045_n.jpg'), 'FB: profile.php person has the right avatar');
  check(!r.imgLog.some(l => l.cors && /photo_777|emoji\.php/.test(l.url)), 'FB: the collector never fetched the photo or the emoji');
  check(/頭像 20 \/ 21 張，沒抓到的會用名字的第一個字代替/.test(r.panelText) && !/複製診斷資訊/.test(r.panelText), 'FB: a grey line reports avatars 20 / 21, no 複製診斷資訊 for one missing');
  check(await countLine(r.page) === '22/ 22 則留言' && !await hasGoOn(r.page), 'FB: reads 「22 則留言」 on the post and shows 22 / 22, nothing left to 繼續抓 (' + await countLine(r.page) + ')');
  const mainBtn = await r.page.evaluate(() => { const b = document.getElementById('giveaway-collector-host').shadowRoot.querySelector('button[style*="rgb(198, 43, 43)"]'); return b && b.textContent; });
  check(mainBtn === '送到抽獎系統', 'FB: 送到抽獎系統 is the main (red) button (' + mainBtn + ')');
  console.log('     FB result size', r.raw.length, 'chars');
  // copy button -> clipboard, then the green confirmation
  check(/複製結果|已複製/.test(r.panelText), 'FB: panel offers copy');
  await r.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.facebook.com' });
  await btn(r.page, /複製結果|已複製/).first().click();
  await r.page.waitForTimeout(300);
  const clip = await r.page.evaluate(() => navigator.clipboard.readText());
  check(clip === r.raw, 'FB: copy button puts the JSON on the clipboard');
  let pt = await panel(r.page);
  check(pt.includes('✓ 已複製成功！到抽獎系統第 1 步，點「送不過去的話」的框，按 Ctrl+V 貼上') && await btn(r.page, '✓ 已複製').count() === 1, 'FB: copying shows the green ✓ 已複製 confirmation');
  const green = await btn(r.page, '✓ 已複製').evaluate(b => getComputedStyle(b).backgroundColor);
  check(green === 'rgb(27, 110, 69)', 'FB: copy button turns green (' + green + ')');
  // 打開抽獎系統: opens the draw page, and the copied result pastes straight in
  const open = r.page.locator('#giveaway-collector-host a', { hasText: '打開抽獎系統' });
  const openAttrs = await open.evaluate(a => [a.href, a.target, a.rel]).catch(() => []);
  check(openAttrs[0] === SITE + 'draw.html' && openAttrs[1] === '_blank' && openAttrs[2] === 'noopener', 'FB: after copying, 打開抽獎系統 links to the draw page in a new tab ' + JSON.stringify(openAttrs));
  await r.page.screenshot({ path: path.join(OUT, 'shot-collector-fb.png') });
  const [drawPage] = await Promise.all([r.ctx.waitForEvent('page'), open.click()]);
  await drawPage.waitForLoadState();
  await drawPage.waitForTimeout(300);
  check(drawPage.url() === SITE + 'draw.html' && await drawPage.title() === '開始抽獎｜抽獎系統', 'FB: the draw page opens (' + drawPage.url() + ')');
  check(await pasteInto(drawPage, '#quick-paste', clip), 'FB: the copied result pastes into 送不過去的話 on the draw page');
  await drawPage.waitForTimeout(200);
  check(await drawPage.$eval('#s-people', n => n.textContent) === '21' && (await drawPage.$eval('#toast', n => n.textContent)).includes('含 20 張頭像'), 'FB: 21 people and 20 avatars land in the draw page');
  check(await drawPage.isHidden('#tool-banner'), 'FB: no update banner for the newest tool');
  await drawPage.close();
  await r.page.waitForTimeout(3200);
  check(await btn(r.page, '再複製一次').count() === 1 && (await panel(r.page)).includes('已複製成功'), 'FB: button becomes 再複製一次, confirmation stays');
  fs.writeFileSync(path.join(OUT, 'sample-fb.json'), clip);
  // clipboard blocked: the text is selected for Ctrl+C instead
  await r.page.evaluate(() => {
    navigator.clipboard.writeText = () => Promise.reject(new Error('blocked'));
    document.execCommand = () => false;
  });
  await btn(r.page, '再複製一次').click();
  await r.page.waitForTimeout(300);
  pt = await panel(r.page);
  const manual = await r.page.evaluate(() => {
    const ta = document.getElementById('giveaway-collector-host').shadowRoot.querySelector('textarea');
    return { shown: ta.style.display === 'block', selected: ta.selectionEnd - ta.selectionStart, len: ta.value.length };
  });
  check(manual.shown && manual.selected === manual.len && manual.len > 1000 && /Ctrl\+C/.test(pt) && !pt.includes('已複製成功') && await open.count() === 0, 'FB: blocked clipboard falls back to selected text + Ctrl+C tip ' + JSON.stringify(manual));
  check(!r.errors.length, 'FB: no page errors ' + JSON.stringify(r.errors));
  await r.ctx.close();

  // Facebook reactions dialog
  r = await runOn(browser, 'https://www.facebook.com/brandpage/posts/pfbid0likes');
  check(r.result && r.result.kind === 'like' && r.result.items.length === 35, 'FB reactions: 35 likers via dialog scrolling (got ' + (r.result && r.result.items.length) + ')');
  check(r.result && r.result.items.every(i => /^按讚者 \d+$/.test(i.name)), 'FB reactions: names come from link text, not avatar labels');
  const fbl = (r.result && r.result.avatars) || {};
  check(Object.keys(fbl).length === 35, 'FB reactions: 35 avatars (got ' + Object.keys(fbl).length + ')');
  check(await avatarMatches(r.page, fbl['fb:liker.1'], 'https://scontent.xx.fbcdn.net/v/t39.30808-1/liker_1_n.jpg'), 'FB reactions: avatar from the <image> next to the name, not the reaction badge');
  check(r.result && r.result.items.every(i => i.url && !i.link), 'FB reactions: profile links, no comment links');
  check(await countLine(r.page) === '35/ 35 位按讚的人', 'FB reactions: reads 「全部 35」 from the list (' + await countLine(r.page) + ')');
  fs.writeFileSync(path.join(OUT, 'sample-fb-likes.json'), r.raw);
  await r.ctx.close();

  // Facebook shares dialog (no pictures at all)
  r = await runOn(browser, 'https://www.facebook.com/brandpage/posts/pfbid0shares');
  check(r.result && r.result.kind === 'share' && r.result.items.length === 6, 'FB shares: 6 sharers, tagged friends ignored (got ' + (r.result && r.result.items.length) + ')');
  check(r.result && !r.result.avatars && /頭像 0 \/ 6 張/.test(r.panelText), 'FB shares: no avatars, reported as 0 / 6');
  check(await hasGoOn(r.page) && /比貼文上的數量少？/.test(r.panelText), 'FB shares: no number to compare, 繼續抓 offered');
  await r.ctx.close();

  // X post with virtualized replies, owner reply, parent tweet, "Show more replies"
  r = await runOn(browser, 'https://x.com/brand/status/111');
  const x = r.result;
  check(x && x.kind === 'comment' && x.items.length === 33, 'X: 30 + 3 replies collected through virtualization (got ' + (x && x.items.length) + ')');
  check(x && !x.items.some(i => i.handle === '@brand' || i.handle === '@someone'), 'X: main post, parent post and owner reply skipped');
  const u0 = x && x.items.find(i => i.handle === '@user_0');
  check(u0 && u0.name === 'User 0' && u0.tags && u0.tags.join() === '@friend_0,@friend_1', 'X: name, handle and mention tags (' + JSON.stringify(u0) + ')');
  check(u0 && u0.url === 'https://x.com/user_0' && u0.link === 'https://x.com/user_0/status/1000', 'X: profile link and reply link');
  check(/略過貼文作者/.test(r.panelText), 'X: panel reports skipped owner replies');
  check(await countLine(r.page) === '33/ 33 則留言' && !await hasGoOn(r.page), 'X: reads "34 replies" from the post, less the author\'s own, 33 / 33 (' + await countLine(r.page) + ')');
  const xav = (x && x.avatars) || {};
  check(Object.keys(xav).length === 33 && !xav['@brand'], 'X: 33 avatars, none for the owner (got ' + Object.keys(xav).length + ')');
  check(r.imgLog.some(l => l.cors && /user_0_bigger\.jpg$/.test(l.url)), 'X: asks for the sharper *_bigger avatar');
  check(await avatarMatches(r.page, xav['@user_3'], 'https://pbs.twimg.com/profile_images/11003/user_3_normal.jpg'), 'X: falls back to *_normal when *_bigger is missing');
  check(await avatarMatches(r.page, xav['@user_0'], 'https://pbs.twimg.com/profile_images/11000/user_0_normal.jpg'), 'X: user_0 has the right avatar');
  fs.writeFileSync(path.join(OUT, 'sample-x.json'), r.raw);
  await r.ctx.close();

  // X likes page
  r = await runOn(browser, 'https://x.com/brand/status/111/likes');
  check(r.result && r.result.kind === 'like' && r.result.items.length === 25, 'X likes: 25 likers (got ' + (r.result && r.result.items.length) + ')');
  check(r.result && r.result.items.every(i => /^Liker \d+$/.test(i.name) && /^@liker_\d+$/.test(i.handle)), 'X likes: bio mentions and sidebar ignored');
  check(r.result && Object.keys(r.result.avatars || {}).length === 25, 'X likes: 25 avatars');
  check(await countLine(r.page) === '25位按讚的人' && /比貼文上的數量少？/.test(await panel(r.page)) && await hasGoOn(r.page), 'X likes: no number on the list page, so 繼續抓 is offered in case');
  await r.ctx.close();

  // Threads post
  r = await runOn(browser, 'https://www.threads.com/@brandtw/post/DAbc123');
  const th = r.result;
  check(th && th.kind === 'comment' && th.items.length === 16, 'Threads: 16 replies collected (got ' + (th && th.items.length) + ')');
  const t0i = th && th.items.find(i => i.handle === '@th.user0');
  check(t0i && t0i.text === '我要抽 @pal_0 @pal_2' && t0i.tags && t0i.tags.length === 2, 'Threads: text and tags (' + JSON.stringify(t0i) + ')');
  check(t0i && t0i.url === 'https://www.threads.com/@th.user0' && t0i.link === 'https://www.threads.com/@th.user0/post/R0', 'Threads: profile link and reply link');
  check(th && !th.items.some(i => i.handle === '@brandtw'), 'Threads: main post and owner reply skipped');
  check(await countLine(r.page) === '16/ 16 則留言' && !await hasGoOn(r.page), 'Threads: reads the number next to the reply icon, 16 / 16 (' + await countLine(r.page) + ')');
  const tav = (th && th.avatars) || {};
  check(Object.keys(tav).length === 16 && await avatarMatches(r.page, tav['@th.user5'], 'https://scontent-tpe1-1.cdninstagram.com/v/t51.2885-19/th.user5_n.jpg'), 'Threads: 16 avatars, th.user5 correct');
  fs.writeFileSync(path.join(OUT, 'sample-threads.json'), r.raw);
  await r.ctx.close();

  // Threads likes dialog: the picture server refuses other pages (no CORS)
  r = await runOn(browser, 'https://www.threads.com/@brandtw/post/DAbc123/likes');
  check(r.result && r.result.kind === 'like' && r.result.items.length === 12, 'Threads likes: 12 likers (got ' + (r.result && r.result.items.length) + ')');
  check(r.result && !r.result.avatars && /頭像 0 \/ 12 張，沒抓到的會用名字的第一個字代替，不影響抽獎。複製診斷資訊/.test(r.panelText) && !/有些頭像抓不到/.test(r.panelText), 'Threads likes: avatars blocked, one grey line explains the letter fallback and offers 複製診斷資訊');
  check(await countLine(r.page) === '12/ 12 位按讚的人', 'Threads likes: the post\'s like number behind the list, 12 / 12 (' + await countLine(r.page) + ')');
  await r.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.threads.com' });
  await btn(r.page, '複製診斷資訊').click();
  await r.page.waitForTimeout(300);
  let diag = null;
  try { diag = JSON.parse(await r.page.evaluate(() => navigator.clipboard.readText())); } catch (e) { diag = null; }
  check(diag && diag.avatars && diag.avatars.found === 12 && diag.avatars.failed === 12 && diag.avatars.hosts['cdninstagram.com'] === 12, 'Threads likes: diagnostics count the blocked avatars ' + JSON.stringify(diag && diag.avatars));
  check(/已複製診斷資訊/.test(await panel(r.page)), 'Threads likes: diagnostics copy is confirmed');
  check(!r.errors.length, 'Threads likes: no page errors ' + JSON.stringify(r.errors));
  await r.ctx.close();

  // Guided flow (v1.3): comments first, then 按讚 / 分享 pressed on the panel before the list is open.
  r = await runOn(browser, 'https://www.facebook.com/brandpage/posts/pfbid0flow');
  check(r.result && r.result.kind === 'comment' && r.result.items.length === 4, 'Flow FB: 4 comments first (got ' + (r.result && r.result.items.length) + ')');
  check(await countLine(r.page) === '4/ 4 則留言', 'Flow FB: 4 / 4 comments');
  // 送到抽獎系統: the draw page opens in a new tab and takes the list
  let [drawTab] = await Promise.all([r.ctx.waitForEvent('page'), sendNow(r.page)]);
  drawTab.on('pageerror', e => r.errors.push('draw: ' + e.message));
  await drawTab.waitForTimeout(300);
  let ft = await panel(r.page);
  check(ft.includes('✓ 已送到抽獎系統：加入 4 則留言（含 3 張頭像）。') && /還要抓按讚或分享的人/.test(ft) && await btn(r.page, '✓ 已送出').count() === 1,
    'Send FB: 送到抽獎系統 adds the comments, the panel says so and offers 抓按讚 / 抓分享');
  const dtxt = (s) => drawTab.$eval(s, n => n.textContent.trim());
  check(drawTab.url() === SITE + 'draw.html' && await dtxt('#s-people') === '4' && await drawTab.locator('#batches .batch').count() === 1 && await drawTab.isHidden('#sample-banner'),
    'Send FB: the draw page has the 4 people in place of the sample, and its address lost #receive (' + drawTab.url() + ')');
  check(await drawTab.isVisible('#recv-banner') && (await dtxt('#recv-banner')).startsWith('已收到 Facebook 的留言名單：加入 4 則留言') && (await dtxt('#recv-banner')).includes('回到貼文的分頁'),
    'Send FB: the draw page says what it got and how to add the likes (' + (await dtxt('#recv-title')) + ')');
  await drawTab.screenshot({ path: path.join(OUT, 'shot-send-draw.png'), clip: { x: 0, y: 0, width: 1200, height: 420 } });
  await r.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.facebook.com' });
  await copyNow(r.page);
  ft = await panel(r.page);
  check(/還要抓按讚或分享的人/.test(ft) && await btn(r.page, '抓按讚').count() === 1 && await btn(r.page, '抓分享').count() === 1, 'Flow FB: after copying, the panel offers 抓按讚 and 抓分享');
  const shotPanel = (name) => r.page.locator('#giveaway-collector-host').screenshot({ path: path.join(OUT, name) });
  await shotPanel('shot-flow-1-next.png');
  await btn(r.page, '抓按讚').click();
  await r.page.waitForTimeout(1500);
  ft = await panel(r.page);
  check(/等你打開按讚名單/.test(ft) && /表情符號旁邊的數字/.test(ft) && /名單已經打開了/.test(ft) && await r.page.evaluate(() => window.__giveawayResult) === r.raw,
    'Flow FB: 按讚 without the likes list open waits and reads nothing');
  check(await r.page.evaluate(() => document.getElementById('giveaway-collector-host').shadowRoot.querySelector('span[style*="tabular-nums"]').parentElement.style.display) === 'none', 'Flow FB: no "0 位按讚的人" while waiting');
  await shotPanel('shot-flow-2-wait.png');
  await r.page.click('#reactions');
  const fl = await nextResult(r.page, r.raw);
  const flNames = fl.result ? fl.result.items.map(i => i.name) : [];
  check(fl.result && fl.result.kind === 'like' && flNames.length === 8 && flNames.includes('陳小明') && !flNames.includes('Jason Tan') && !flNames.includes('品牌粉專'),
    'Flow FB: opening the likes list starts by itself: 8 likers, no commenters who did not like (' + flNames.join(',') + ')');
  check(await countLine(r.page) === '8/ 8 位按讚的人', 'Flow FB: 8 / 8 likers, from the list\'s 「全部 8」');
  // The likes go to the same draw tab
  ft = await sendNow(r.page);
  await drawTab.waitForTimeout(300);
  check(ft.includes('✓ 已送到抽獎系統：加入 8 位按讚的人') && draws(r.ctx).length === 1 && await dtxt('#s-people') === '10' && await drawTab.locator('#batches .batch').count() === 2,
    'Send FB: the likes go to the same draw tab: 2 lists, 10 people (' + (await dtxt('#s-people')) + ', ' + draws(r.ctx).length + ' draw tabs)');
  // The same list again is not added twice
  await btn(r.page, '✓ 已送出').click();
  await r.page.waitForTimeout(1500);
  check((await panel(r.page)).includes('這份名單之前已經加入過了') && await drawTab.locator('#batches .batch').count() === 2, 'Send FB: sending the same list again adds nothing');
  // The draw starts: the draw page takes no more lists
  await drawTab.bringToFront();
  await drawTab.click('.view-tab[data-view="draw"]');
  await drawTab.click('#btn-draw');
  await drawTab.waitForFunction(() => document.getElementById('ticket').dataset.mode === 'won', null, { timeout: 8000 });
  await copyNow(r.page);
  ft = await panel(r.page);
  check(/還要抓分享的人/.test(ft) && await btn(r.page, '抓分享').count() === 1 && await btn(r.page, '抓按讚').count() === 0, 'Flow FB: after the likes, only 抓分享 is left');
  await r.page.screenshot({ path: path.join(OUT, 'shot-flow-3-likes.png') });
  check(JSON.parse(await r.page.evaluate(() => navigator.clipboard.readText())).kind === 'like', 'Flow FB: the likes are on the clipboard');
  await btn(r.page, '抓分享').click();
  await r.page.waitForTimeout(800);
  ft = await panel(r.page);
  check(/現在打開的是按讚名單/.test(ft) && /請先關掉它，再點貼文下方的「N 次分享」/.test(ft) && await r.page.evaluate(() => window.__giveawayResult) === fl.raw,
    'Flow FB: 分享 with the likes list still open asks to close it, and does not read the likes as shares');
  await shotPanel('shot-flow-4-close-first.png');
  await r.page.click('[role=dialog] [aria-label="關閉"]');
  await r.page.click('#shares');
  const fs2 = await nextResult(r.page, fl.raw);
  check(fs2.result && fs2.result.kind === 'share' && fs2.result.items.length === 3, 'Flow FB: then the shares list starts by itself: 3 sharers (got ' + (fs2.result && fs2.result.items.length) + ')');
  check(await countLine(r.page) === '3/ 3 位分享的人', 'Flow FB: 3 / 3 sharers, from the post\'s 「3 次分享」');
  ft = await sendNow(r.page);
  await drawTab.waitForTimeout(300);
  check(/抽獎已經開始，名單鎖住了，所以沒有加入/.test(ft) && !/還要抓/.test(ft) && await drawTab.locator('#batches .batch').count() === 2,
    'Send FB: once the draw has started, the draw page refuses the shares and the panel says why');
  check((await dtxt('#recv-banner')).startsWith('沒有加入 Facebook 的分享名單。') && await drawTab.$eval('#recv-banner', b => b.className) === 'banner banner-warn', 'Send FB: the draw page says it did not add them');
  await r.page.locator('#giveaway-collector-host').screenshot({ path: path.join(OUT, 'shot-send-locked.png') });
  await copyNow(r.page);
  ft = await panel(r.page);
  check(/三份名單都抓好了/.test(ft) && /第 2 步確認參加條件（會跟著名單自動勾好）/.test(ft), 'Flow FB: all three lists done, the panel points to 參加條件');
  await shotPanel('shot-flow-5-done.png');
  await btn(r.page, /^留言$/).click();
  await r.page.waitForTimeout(400);
  ft = await panel(r.page);
  check(/抓到 4 則留言/.test(ft) && await r.page.evaluate(() => window.__giveawayResult) === fs2.raw, 'Flow FB: 留言 shows the comments again without reading them again');
  await copyNow(r.page);
  check(JSON.parse(await r.page.evaluate(() => navigator.clipboard.readText())).kind === 'comment', 'Flow FB: copying from there copies the comments');
  // 名單已經打開了 with no list open: reads the page, and says so
  await r.page.click('[role=dialog] [aria-label="關閉"]');
  await btn(r.page, /^按讚$/).click();
  await r.page.waitForTimeout(300);
  check(/抓到 8 位按讚的人/.test(await panel(r.page)), 'Flow FB: 按讚 shows the stored likes');
  await btn(r.page, '重新抓取').click();
  await r.page.waitForTimeout(800);
  check(/等你打開按讚名單/.test(await panel(r.page)), 'Flow FB: 重新抓取 with the list closed waits for it');
  await btn(r.page, '名單已經打開了').click();
  const ff = await nextResult(r.page, fs2.raw);
  ft = await panel(r.page);
  check(ff.result && ff.result.kind === 'like' && /沒有找到名單視窗/.test(ft), 'Flow FB: 名單已經打開了 without a list reads the page and warns about it');
  check(!r.errors.length, 'Flow FB: no page errors ' + JSON.stringify(r.errors));
  await r.ctx.close();

  // Bookmark pressed with the likes list open, then 抓留言: waits for the list to be closed
  r = await runOn(browser, 'https://www.facebook.com/brandpage/posts/pfbid0flow', { before: (p) => p.click('#reactions') });
  check(r.result && r.result.kind === 'like' && r.result.items.length === 8, 'Flow FB: bookmark pressed on the open likes list reads the likes (got ' + (r.result && r.result.items.length) + ')');
  await r.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.facebook.com' });
  await copyNow(r.page);
  check(/還要抓留言或分享的人/.test(await panel(r.page)), 'Flow FB: then offers 抓留言 and 抓分享');
  await btn(r.page, '抓留言').click();
  await r.page.waitForTimeout(800);
  check(/請先關掉按讚或分享的名單視窗/.test(await panel(r.page)) && await r.page.evaluate(() => window.__giveawayResult) === r.raw, 'Flow FB: 抓留言 with the likes list open waits for it to close');
  await r.page.click('[role=dialog] [aria-label="關閉"]');
  const fc = await nextResult(r.page, r.raw);
  check(fc.result && fc.result.kind === 'comment' && fc.result.items.length === 4, 'Flow FB: closing the list starts the comments by itself (got ' + (fc.result && fc.result.items.length) + ')');
  await r.ctx.close();

  // X: the likes list is a page of its own; the panel follows the address change
  r = await runOn(browser, 'https://x.com/brand/status/222');
  check(r.result && r.result.kind === 'comment' && r.result.items.length === 3, 'Flow X: 3 replies first (got ' + (r.result && r.result.items.length) + ')');
  // The browser blocks the new tab: the result is copied instead
  await r.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://x.com' });
  await r.page.evaluate(() => { window.__open = window.open; window.open = () => null; });
  await btn(r.page, '送到抽獎系統').click();
  await r.page.waitForTimeout(400);
  check(await r.page.evaluate(() => navigator.clipboard.readText()) === r.raw && (await panel(r.page)).includes('已複製成功'), 'Send X: a blocked pop-up copies the result instead');
  // The site cuts the new tab off (it looks closed at once): say to copy, and stop offering to send
  await r.page.evaluate(() => { window.open = () => ({ closed: true, postMessage() {} }); });
  await btn(r.page, '送到抽獎系統').click();
  await r.page.waitForTimeout(700);
  check((await panel(r.page)).includes('沒辦法直接送過去。請按「複製結果」'), 'Send X: a tab the site cuts off: the panel says to use 複製結果');
  await r.page.evaluate(() => { window.open = window.__open; });
  await btn(r.page, /^留言$/).click();
  await r.page.waitForTimeout(300);
  check(await btn(r.page, '送到抽獎系統').count() === 0 && await btn(r.page, '複製結果').evaluate(b => b.style.backgroundColor) === 'rgb(198, 43, 43)', 'Send X: after that, 複製結果 is the main button');
  check(await countLine(r.page) === '3/ 3 則留言', 'Flow X: 3 / 3 replies');
  await btn(r.page, /^按讚$/).click();
  await r.page.waitForTimeout(800);
  ft = await panel(r.page);
  check(/等你打開按讚名單/.test(ft) && /\/likes/.test(ft), 'Flow X: 按讚 waits for the /likes page');
  await r.page.click('#likes-link');
  const xl = await nextResult(r.page, r.raw);
  check(xl.result && xl.result.kind === 'like' && xl.result.items.length === 5 && xl.result.items.every(i => /^@liker_\d$/.test(i.handle)), 'Flow X: the likes page is read by itself: 5 likers, no repliers (got ' + (xl.result && xl.result.items.map(i => i.handle).join(',')) + ')');
  check(await countLine(r.page) === '5/ 5 位按讚的人', 'Flow X: "5 likes" read on the post is kept for its /likes page (' + await countLine(r.page) + ')');
  check(!r.errors.length, 'Flow X: no page errors ' + JSON.stringify(r.errors));
  await r.ctx.close();

  // The post says 5 and has them at once, over a very long page: the run stops at 5 instead of
  // scrolling to the end. Run through the bookmark address itself, as the bookmarks bar does.
  r = await runOn(browser, 'https://www.facebook.com/brandpage/posts/pfbid0count', { viaLink: true });
  check(BM.href.length < 56000 && !/["<>&\s]/.test(BM.href), 'Bookmark: ' + BM.href.length + ' characters, nothing unsafe for the link');
  check(r.result && r.result.items.length === 5, 'Bookmark: the javascript: address runs the tool when pressed (got ' + (r.result && r.result.items.length) + ')');
  check(r.ms < 12000 && await countLine(r.page) === '5/ 5 則留言' && !await hasGoOn(r.page), 'Count: stops as soon as it has the post\'s 5 comments (' + r.ms + ' ms)');
  check(!r.errors.length, 'Count: no page errors ' + JSON.stringify(r.errors));
  await r.ctx.close();

  // The post says 12, 8 show: it ends short, says so, and 繼續抓 brings the rest, keeping the 8
  r = await runOn(browser, 'https://www.facebook.com/brandpage/posts/pfbid0more');
  let mt = await panel(r.page);
  check(r.result && r.result.items.length === 8 && await countLine(r.page) === '8/ 12 則留言', 'More: ends at 8 / 12 (' + (r.result && r.result.items.length) + ')');
  check(mt.includes('貼文上顯示 12 則留言，這次抓到 8。') && /差很多的話，按「繼續抓」可以接著抓/.test(mt) && await hasGoOn(r.page), 'More: says it got fewer than the post shows, with 繼續抓');
  await r.page.locator('#giveaway-collector-host').screenshot({ path: path.join(OUT, 'shot-collector-short.png') });
  const [moreTab] = await Promise.all([r.ctx.waitForEvent('page'), sendNow(r.page)]);
  await moreTab.waitForTimeout(300);
  check(await moreTab.$eval('#s-comments', n => n.textContent) === '8', 'More: the 8 go to the draw page');
  await r.page.evaluate(() => window.__unlock());
  await btn(r.page, /^繼續抓$/).click();
  const m2 = await nextResult(r.page, r.raw);
  check(m2.result && m2.result.items.length === 12 && m2.result.at === r.result.at && await countLine(r.page) === '12/ 12 則留言' && !await hasGoOn(r.page),
    'More: 繼續抓 keeps the 8, adds the other 4 (12 / 12), same list time (' + (m2.result && m2.result.items.length) + ')');
  mt = await sendNow(r.page);
  await moreTab.waitForTimeout(300);
  check(mt.includes('名單更新了，8 → 12 則留言') && await moreTab.locator('#batches .batch').count() === 1 && await moreTab.$eval('#s-comments', n => n.textContent) === '12',
    'More: sending again replaces the 8 with the 12 in the draw page, not a second list');
  // 停止 at once: 繼續抓 is offered
  await btn(r.page, '重新抓取').click();
  await r.page.waitForTimeout(150);
  await btn(r.page, '停止').click();
  await nextResult(r.page, m2.raw);
  mt = await panel(r.page);
  check(mt.includes('已經停止。按「繼續抓」可以接著抓') && await hasGoOn(r.page), 'More: after 停止 the panel offers 繼續抓');
  check(!r.errors.length, 'More: no page errors ' + JSON.stringify(r.errors));
  await r.ctx.close();

  // Another site cannot hand the draw page a list
  const ctxE = await newCtx(browser);
  const evil = await ctxE.newPage();
  await evil.goto('https://evil.example/');
  const [evilDraw] = await Promise.all([ctxE.waitForEvent('page'), evil.evaluate((u) => {
    window.__got = [];
    addEventListener('message', (e) => window.__got.push(e.data));
    window.__w = window.open(u + '#receive', 'giveaway-draw');
  }, SITE + 'draw.html')]);
  await evilDraw.waitForLoadState();
  await evilDraw.waitForTimeout(300);
  const lists0 = await evilDraw.locator('#batches .batch').count();
  await evil.evaluate((t) => { for (let i = 0; i < 3; i++) { window.__w.postMessage({ giveaway: 'tool', type: 'hello', id: 'e' }, '*'); window.__w.postMessage({ giveaway: 'tool', type: 'send', id: 'e', text: t }, '*'); } }, fs.readFileSync(path.join(OUT, 'sample-fb.json'), 'utf8'));
  await evil.waitForTimeout(1000);
  check(await evil.evaluate(() => window.__got.length) === 0 && await evilDraw.locator('#batches .batch').count() === lists0 && await evilDraw.isVisible('#sample-banner'),
    'Send: the draw page neither answers nor takes a list from another site');
  await ctxE.close();

  // Not a post page / other site
  r = await runOn(browser, 'https://www.facebook.com/', { noWait: true });
  check(/不是單一貼文頁面/.test(r.panelText) && /仍然抓取/.test(r.panelText) && r.panelText.includes('v' + VER), 'FB home: warns it is not a single post, shows v' + VER);
  await r.ctx.close();
  r = await runOn(browser, 'https://example.com/', { noWait: true });
  check(/只能在 Facebook、X 或 Threads/.test(r.panelText), 'Other site: explains where it works');
  await r.ctx.close();

  console.log('time', Math.round((Date.now() - t0) / 1000) + 's');
  await browser.close();
  done();
})();
