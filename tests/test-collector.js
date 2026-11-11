// The 抓取工具 bookmarklet (as built into index.html) on simulated Facebook, X and Threads pages.
// Writes each result to tests/out/sample-*.json for test-site.js.
const fs = require('fs');
const path = require('path');
const mocks = require('./mocks.js');
const { colorOf, serveImage } = require('./avatars-mock.js');
const { SITE, OUT, launch, serveSiteFile, serveNoFonts, bookmarklet, version, check, done, pasteInto } = require('./helpers.js');
const code = bookmarklet().code;
const VER = version();

async function runOn(browser, url, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 720 } });
  const imgLog = [];
  await ctx.route('**/*', (route) => {
    if (serveImage(route, imgLog)) return;
    if (serveSiteFile(route) || serveNoFonts(route)) return;
    const u = route.request().url().replace(/[?#].*$/, '');
    const key = Object.keys(mocks).find(k => k === u) || (u === 'https://www.facebook.com/' ? 'https://example.com/' : null);
    if (!key) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: mocks[key]() });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(200);
  await page.evaluate(code);
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
  const panelText = await panel(page);
  return { ctx, page, result, raw, errors, panelText, imgLog };
}
const panel = (page) => page.evaluate(() => document.getElementById('giveaway-collector-host')?.shadowRoot?.textContent || '');
const btn = (page, text) => page.locator('#giveaway-collector-host button', { hasText: text });

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
  check(/頭像 20 \/ 21 張/.test(r.panelText), 'FB: panel reports avatars 20 / 21');
  console.log('     FB result size', r.raw.length, 'chars');
  // copy button -> clipboard, then the green confirmation
  check(/複製結果|已複製/.test(r.panelText), 'FB: panel offers copy');
  await r.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.facebook.com' });
  await btn(r.page, /複製結果|已複製/).first().click();
  await r.page.waitForTimeout(300);
  const clip = await r.page.evaluate(() => navigator.clipboard.readText());
  check(clip === r.raw, 'FB: copy button puts the JSON on the clipboard');
  let pt = await panel(r.page);
  check(pt.includes('✓ 已複製成功！請到抽獎系統第 1 步貼上') && await btn(r.page, '✓ 已複製').count() === 1, 'FB: copying shows the green ✓ 已複製 confirmation');
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
  check(await pasteInto(drawPage, '#paste', clip), 'FB: the copied result pastes into the draw page');
  await drawPage.click('#btn-add');
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
  fs.writeFileSync(path.join(OUT, 'sample-fb-likes.json'), r.raw);
  await r.ctx.close();

  // Facebook shares dialog (no pictures at all)
  r = await runOn(browser, 'https://www.facebook.com/brandpage/posts/pfbid0shares');
  check(r.result && r.result.kind === 'share' && r.result.items.length === 6, 'FB shares: 6 sharers, tagged friends ignored (got ' + (r.result && r.result.items.length) + ')');
  check(r.result && !r.result.avatars && /頭像 0 \/ 6 張/.test(r.panelText), 'FB shares: no avatars, reported as 0 / 6');
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
  await r.ctx.close();

  // Threads post
  r = await runOn(browser, 'https://www.threads.com/@brandtw/post/DAbc123');
  const th = r.result;
  check(th && th.kind === 'comment' && th.items.length === 16, 'Threads: 16 replies collected (got ' + (th && th.items.length) + ')');
  const t0i = th && th.items.find(i => i.handle === '@th.user0');
  check(t0i && t0i.text === '我要抽 @pal_0 @pal_2' && t0i.tags && t0i.tags.length === 2, 'Threads: text and tags (' + JSON.stringify(t0i) + ')');
  check(t0i && t0i.url === 'https://www.threads.com/@th.user0' && t0i.link === 'https://www.threads.com/@th.user0/post/R0', 'Threads: profile link and reply link');
  check(th && !th.items.some(i => i.handle === '@brandtw'), 'Threads: main post and owner reply skipped');
  const tav = (th && th.avatars) || {};
  check(Object.keys(tav).length === 16 && await avatarMatches(r.page, tav['@th.user5'], 'https://scontent-tpe1-1.cdninstagram.com/v/t51.2885-19/th.user5_n.jpg'), 'Threads: 16 avatars, th.user5 correct');
  fs.writeFileSync(path.join(OUT, 'sample-threads.json'), r.raw);
  await r.ctx.close();

  // Threads likes dialog: the picture server refuses other pages (no CORS)
  r = await runOn(browser, 'https://www.threads.com/@brandtw/post/DAbc123/likes');
  check(r.result && r.result.kind === 'like' && r.result.items.length === 12, 'Threads likes: 12 likers (got ' + (r.result && r.result.items.length) + ')');
  check(r.result && !r.result.avatars && /頭像 0 \/ 12 張/.test(r.panelText) && /有些頭像抓不到/.test(r.panelText), 'Threads likes: avatars blocked, panel explains the letter fallback');
  await r.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'https://www.threads.com' });
  await btn(r.page, '複製診斷資訊').click();
  await r.page.waitForTimeout(300);
  let diag = null;
  try { diag = JSON.parse(await r.page.evaluate(() => navigator.clipboard.readText())); } catch (e) { diag = null; }
  check(diag && diag.avatars && diag.avatars.found === 12 && diag.avatars.failed === 12 && diag.avatars.hosts['cdninstagram.com'] === 12, 'Threads likes: diagnostics count the blocked avatars ' + JSON.stringify(diag && diag.avatars));
  check(/已複製診斷資訊/.test(await panel(r.page)), 'Threads likes: diagnostics copy is confirmed');
  check(!r.errors.length, 'Threads likes: no page errors ' + JSON.stringify(r.errors));
  await r.ctx.close();

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
