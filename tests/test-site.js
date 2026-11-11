// The homepage, and the draw page with real 抓取工具 results (from tests/out, written by
// test-collector.js): import, avatars, links, version banner, CSV, cross-tab sync, 繼續抽獎.
const fs = require('fs');
const path = require('path');
const { SITE, OUT, launch, serveSite, bookmarklet, version, check, done, pasteInto } = require('./helpers.js');
const VER = version();
const REPO = fs.readFileSync(path.join(__dirname, '..', 'build.js'), 'utf8').match(/const REPO_URL = '([^']+)'/)[1];
const sample = (name) => {
  const f = path.join(OUT, name);
  if (!fs.existsSync(f)) throw new Error(f + ' is missing: run tests/test-collector.js first');
  return fs.readFileSync(f, 'utf8');
};

(async () => {
  const browser = await launch();
  const errors = [];
  const watch = (page, tag) => {
    page.on('pageerror', e => errors.push(tag + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(tag + ' console: ' + m.text()); });
  };

  // ---------- Built files ----------
  for (const f of ['index.html', 'draw.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    check(html.startsWith('<!doctype html>') && /<html lang="zh-Hant">/.test(html) && /<meta charset="utf-8">/.test(html) && /name="viewport"/.test(html), f + ': a complete HTML document');
    check(!/claude\.ai|window\.claude/.test(html) && !/__[A-Z_]+__/.test(html), f + ': no Claude-only links or unfilled placeholders');
  }

  // ---------- Homepage, first visit ----------
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await serveSite(ctx);
  const home = await ctx.newPage();
  watch(home, 'home');
  await home.goto(SITE);
  await home.waitForTimeout(300);
  const htxt = (s) => home.$eval(s, n => n.textContent.trim());
  check(await home.title() === '抽獎系統｜Facebook、X、Threads 貼文抽獎', 'home: title');
  check(await home.$eval('#cta-draw', a => [a.href, a.textContent].join(' ')) === SITE + 'draw.html 開始抽獎' && await home.isHidden('#resume'), 'home: first visit shows 開始抽獎, no 繼續 line');
  const anchors = await home.$$eval('a[href^="#"]', as => as.map(a => a.getAttribute('href')));
  const brokenAnchors = await home.evaluate((hs) => hs.filter(h => !document.getElementById(h.slice(1))), anchors);
  check(anchors.length >= 6 && !brokenAnchors.length, 'home: every # link has a target ' + JSON.stringify(brokenAnchors));
  check((await htxt('.meta')).includes('v' + VER) && (await htxt('#whats-new h3')) === 'v' + VER + ' 更新了', 'home: shows the newest tool version v' + VER);
  const combo = await home.$$eval('#combo ol.steps > li', ls => ls.map(l => l.textContent));
  check(combo.length === 4 && combo[1].includes('在工具上按「按讚」') && combo[3].includes('需要留言') && combo[3].includes('需要分享'), 'home: step-by-step 留言＋按讚＋分享 walkthrough ' + JSON.stringify(combo.map(t => t.slice(0, 6))));
  check(!(await home.$eval('main', m => m.textContent)).includes('再按一次書籤'), 'home: no more 「再按一次書籤」');
  check(await home.$eval('.foot a', a => a.href) === REPO && (await htxt('.foot')).includes('v' + VER), 'home: footer links to the GitHub repository');
  const bm = bookmarklet();
  const href = await home.$eval('#bookmarklet', a => a.getAttribute('href'));
  check(href === bm.href && href.startsWith('javascript:') && href.length > 30000 && href.length < 64000, 'home: carries the bookmarklet (' + href.length + ' chars)');
  check(await home.$eval('#code', t => t.value) === href, 'home: code box holds the same bookmarklet');
  check(bm.code.includes(JSON.stringify(SITE + 'draw.html')), 'bookmarklet links back to ' + SITE + 'draw.html');
  await home.click('#bookmarklet');
  await home.waitForTimeout(150);
  check((await htxt('#toast')).includes('拖到書籤列') && home.url() === SITE, 'home: clicking the bookmarklet explains to drag it');
  await home.click('#btn-copy-code');
  await home.waitForTimeout(200);
  check(/已複製程式碼|已選取程式碼/.test(await htxt('#toast')), 'home: copy-code button answers');
  const demo = await home.evaluate(() => ({
    anims: document.getAnimations().filter(a => a.playState === 'running').length,
    steps: Array.from(document.querySelectorAll('#demo .demo-steps li')).map(l => l.textContent)
  }));
  check(demo.anims >= 10 && demo.steps.length === 3 && demo.steps[1].includes('往上拖到書籤列'), 'home: drag demo plays (' + demo.anims + ' animations)');
  const frame = await home.evaluate(() => {
    const f = document.getElementById('demo'), tag = f.querySelector('.demo-tag');
    const fr = f.getBoundingClientRect(), tr = tag.getBoundingClientRect();
    return { border: getComputedStyle(f).borderTopStyle, tag: tag.textContent, onEdge: tr.top < fr.top && tr.bottom > fr.top, visible: tr.width > 0 };
  });
  check(frame.border === 'dashed' && frame.tag === '示範動畫・只是示範，不能拖' && frame.onEdge && frame.visible, 'home: the demo sits in a dashed frame labelled 示範動畫 ' + JSON.stringify(frame));
  await home.click('#demo-toggle');
  await home.waitForTimeout(100);
  check(await home.evaluate(() => getComputedStyle(document.querySelector('#demo .d-cursor')).animationPlayState) === 'paused' && await htxt('#demo-toggle') === '播放動畫', 'home: demo can be paused');
  await home.click('#demo-toggle');
  const faq = home.locator('.faq details').first();
  await faq.locator('summary').click();
  check(await faq.evaluate(d => d.open) && (await faq.textContent()).includes('不用'), 'home: FAQ answers open on click');
  await home.click('.topnav a[href="#install"]');
  await home.waitForTimeout(700);
  const installTop = await home.$eval('#install', n => Math.round(n.getBoundingClientRect().top));
  check(installTop >= 0 && installTop < 60, 'home: 安裝抓取工具 in the top bar scrolls to the install section (' + installTop + ')');
  await home.evaluate(() => scrollTo(0, 0));
  await home.waitForTimeout(500);
  await home.screenshot({ path: path.join(OUT, 'shot-home.png'), fullPage: true });
  await home.screenshot({ path: path.join(OUT, 'shot-home-top.png') });

  // ---------- Homepage → draw page ----------
  await home.click('#cta-draw');
  await home.waitForLoadState();
  await home.waitForTimeout(300);
  const page = home;
  const txt = (s) => page.$eval(s, n => n.textContent.trim());
  check(page.url() === SITE + 'draw.html' && await page.isVisible('#sample-banner'), 'draw: 開始抽獎 opens the draw page with the sample giveaway');
  const nav = await page.$$eval('.sitenav a', as => as.map(a => a.href));
  check(nav.join() === [SITE, SITE + '#use', SITE + '#install'].join(), 'draw: navigation back to the homepage ' + JSON.stringify(nav));
  check(await page.$eval('.callout a', a => [a.href, a.target].join()) === SITE + '#install,_blank', 'draw: 安裝抓取工具 opens the install section in a new tab');
  check((await txt('.sitefoot')).includes('v' + VER) && await page.$eval('.sitefoot a[href*="issues"]', a => a.href) === REPO + '/issues', 'draw: footer shows v' + VER + ' and links to 回報問題');

  // A real paste: the big JSON stays out of the text box, which shows a summary instead.
  const fbJson = sample('sample-fb.json');
  check(JSON.parse(fbJson).tool === VER && Object.keys(JSON.parse(fbJson).avatars).length === 20, 'sample FB result comes from collector ' + VER + ' with 20 avatars');
  check(await pasteInto(page, '#paste', fbJson), 'draw: pasting a collector result is intercepted');
  await page.waitForTimeout(150);
  const boxText = await page.$eval('#paste', t => t.value);
  check(boxText.startsWith('【Facebook 抓取結果】22 則留言・21 位・20 張頭像') && boxText.length < 120, 'draw: text box shows a short summary (' + boxText.split('\n')[0] + ')');
  check((await txt('#preview')).includes('偵測到 Facebook 抓取結果：22 則留言，21 位不重複，20 張頭像'), 'draw: preview recognises collector JSON');
  check(await page.locator('#preview .av img').count() >= 2, 'draw: preview shows avatars');
  await page.click('#btn-add');
  await page.waitForTimeout(150);
  check((await txt('#toast')).includes('含 20 張頭像') && await page.$eval('#paste', t => t.value) === '', 'draw: import confirms 20 avatars and clears the box');
  check(await page.isHidden('#tool-banner') && await page.isHidden('#sample-banner'), 'draw: import replaces the sample data, no update banner');
  check(await page.locator('#people .person .av img').count() === 20 && await page.locator('#people .person .av-letter').count() === 1, 'draw: roster has 20 avatars + 1 letter');
  const xmLink = page.locator('#people .person .name a[href="https://www.facebook.com/xiaoming.chen"]');
  check(await xmLink.count() === 1 && await xmLink.getAttribute('target') === '_blank', 'draw: names link to Facebook profiles in a new tab');
  check(await txt('#s-comments') === '22' && await txt('#s-people') === '21', 'draw: 22 comments, 21 people');

  // The same result again is refused
  await page.fill('#paste', fbJson);
  await page.click('#btn-add');
  await page.waitForTimeout(150);
  check(await page.locator('#batches .batch').count() === 1 && (await txt('#toast')).includes('已經加入過了'), 'draw: duplicate collector result refused');
  await page.fill('#paste', '');

  // Likes from the same post merge by FB profile handle; a result without a version asks to update
  const likes = { giveaway: 'list', v: 1, platform: 'facebook', kind: 'like', page: 'https://www.facebook.com/brandpage/posts/pfbid0abc', at: '2026-11-11T03:00:00Z',
    items: [{ name: '陳小明', handle: 'fb:xiaoming.chen' }, { name: '林雅婷', handle: 'fb:100045' }, { name: 'Amy L.', handle: 'fb:amy.lim.123' }, { name: '路人甲', handle: 'fb:someone.else' }] };
  await page.fill('#paste', JSON.stringify(likes));
  await page.waitForTimeout(200);
  await page.click('#btn-add');
  await page.waitForTimeout(150);
  check(await txt('#s-people') === '22', 'draw: likes merge by profile handle (people 22)');
  check(await page.isVisible('#tool-banner') && (await txt('#tool-banner')).includes('抓取工具有新版 v' + VER), 'draw: result without a tool version shows the update banner');
  check(await page.$eval('#tool-banner-link', a => [a.href, a.target, a.textContent].join()) === SITE + '#install,_blank,看安裝方法', 'draw: update banner links to the install section');
  check((await txt('#tool-banner-text')).includes('照安裝說明重新拖一次新版'), 'draw: update banner says how to reinstall');
  await page.check('#r-like');
  await page.waitForTimeout(100);
  check(await txt('#s-eligible') === '3', 'draw: need-like leaves 3 (got ' + await txt('#s-eligible') + ')');
  await page.uncheck('#r-like');

  // X result: @handles, then a draw with the animation
  const xJson = sample('sample-x.json');
  await page.fill('#paste', xJson);
  await page.click('#btn-add');
  await page.waitForTimeout(150);
  check(await txt('#s-people') === String(22 + 33) && await page.isHidden('#tool-banner'), 'draw: X replies added, newest-tool result clears the banner');
  // 排除 on an X reply writes the @handle (unique on X) into the exclusion list
  const u1 = page.locator('#people .person', { has: page.locator('.handle', { hasText: /^@user_1$/ }) });
  const before = await txt('#s-eligible');
  await u1.locator('.p-side .btn').click();
  await page.waitForTimeout(100);
  check(await page.$eval('#r-exclude', n => n.value) === '@user_1' && Number(await txt('#s-eligible')) === Number(before) - 1, 'draw: 排除 on an X reply adds @user_1 to the exclusion list');
  await u1.locator('.p-side .btn').click();
  await page.waitForTimeout(100);
  check(await page.$eval('#r-exclude', n => n.value) === '' && await txt('#s-eligible') === before, 'draw: 恢復 takes @user_1 out again');
  await page.click('.view-tab[data-view="draw"]');
  await page.click('#btn-draw');
  await page.waitForFunction(() => document.getElementById('ticket').dataset.mode === 'won', null, { timeout: 8000 });
  const tAv = await page.$eval('#t-av', a => ({ hidden: a.hidden, src: (a.querySelector('img') || {}).src || '' }));
  check(!tAv.hidden && /^data:image\/(webp|jpeg);base64,/.test(tAv.src), 'draw: winning ticket shows the avatar');
  const wl = await page.$$eval('#winners .wrow .wlinks a', as => as.map(a => [a.textContent, a.href, a.target]));
  check(wl.length === 2 && wl[0][0] === '個人檔案 ↗' && wl[1][0] === '看留言 ↗' && wl.every(l => l[2] === '_blank'), 'draw: winner row links to profile and comment');
  await page.locator('#stage').screenshot({ path: path.join(OUT, 'shot-draw-stage.png') });

  // CSV as a real download
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btn-csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '').split('\r\n');
  check(/^抽獎結果-\d{8}-\d{4}\.csv$/.test(dl.suggestedFilename()) && csv[0] === '獎項,名次,抽獎編號,名字,帳號,個人檔案連結,留言,留言連結,狀態,抽出時間,當時抽獎池人數,作廢時間' && /,https:\/\/[^,]+,.*,https:\/\/[^,]+,有效,/.test(csv[1] || ''), 'draw: CSV downloads with link columns (' + dl.suggestedFilename() + ')');

  // ---------- Homepage remembers the giveaway ----------
  await page.waitForTimeout(300);
  const home2 = await ctx.newPage();
  watch(home2, 'home2');
  await home2.goto(SITE);
  await home2.waitForTimeout(300);
  const resume = await home2.$eval('#resume-text', n => n.textContent);
  check(await home2.isVisible('#resume') && /^參加者 55 位，全部 1 名都抽完了/.test(resume) && await home2.$eval('#cta-draw', a => a.textContent) === '查看抽獎結果', 'home: returning visitor sees last giveaway (' + resume.slice(0, 30) + ')');
  // Start the draw over in the draw tab: the homepage line follows without reloading
  await page.click('#btn-reset'); await page.click('#btn-reset');
  await page.waitForTimeout(500);
  const resume2 = await home2.$eval('#resume-text', n => n.textContent);
  check(/^參加者 55 位，還沒開始抽/.test(resume2) && await home2.$eval('#cta-draw', a => a.textContent) === '繼續抽獎', 'home: 繼續抽獎 line updates live from the draw tab (' + resume2.slice(0, 20) + ')');
  await home2.screenshot({ path: path.join(OUT, 'shot-home-returning.png') });
  await home2.close();

  // ---------- Two draw tabs stay in step ----------
  const other = await ctx.newPage();
  watch(other, 'other');
  await other.goto(SITE + 'draw.html');
  await other.waitForTimeout(300);
  await page.click('#btn-add-prize');
  await page.waitForTimeout(500);
  check(await other.locator('#prize-list .prize-row').count() === 2, 'tabs: a prize added in one tab appears in the other');
  await other.check('#r-like');
  await other.waitForTimeout(500);
  check(await page.isChecked('#r-like') && await page.$eval('#s-eligible', n => n.textContent) === await other.$eval('#s-eligible', n => n.textContent), 'tabs: a rule changed in the other tab comes back');
  // The first tab, now up to date, changes something: nothing from the other tab is lost
  await page.click('.view-tab[data-view="setup"]');
  await page.fill('#r-kw-text', '我要抽');
  await page.waitForTimeout(500);
  await other.reload();
  await other.waitForTimeout(300);
  check(await other.locator('#prize-list .prize-row').count() === 2 && await other.isChecked('#r-like') && await other.$eval('#r-kw-text', n => n.value) === '我要抽', 'tabs: after edits in both tabs, both edits are saved');
  await other.close();

  // A crafted result cannot sneak in script links or non-image data
  await page.click('.view-tab[data-view="draw"]');
  await page.click('#btn-wipe'); await page.click('#btn-wipe');
  await page.waitForTimeout(200);
  check(page.url().endsWith('#setup') && await page.isVisible('#paste'), 'draw: 清除全部資料 goes back to 準備');
  const evil = { giveaway: 'list', v: 1, tool: VER, platform: 'x', kind: 'comment', page: 'https://x.com/a/status/1', at: '2026-11-11T05:00:00Z',
    items: [{ name: 'Evil', handle: '@evil', text: '我要抽 @a @b', url: 'javascript:alert(1)', link: 'https://evil.example/x' }],
    avatars: { '@evil': 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' } };
  await pasteInto(page, '#paste', JSON.stringify(evil));
  await page.click('#btn-add');
  await page.waitForTimeout(150);
  check(await page.locator('#people .person').count() === 1 && await page.locator('#people .person a').count() === 0 && await page.locator('#people .person .av img').count() === 0, 'draw: unsafe links and non-image avatars are dropped');

  // Old-tool result: imported, then the banner asks to reinstall; 知道了 dismisses it for good
  const old = { giveaway: 'list', v: 1, tool: '1.1', platform: 'threads', kind: 'like', page: 'https://www.threads.com/@a/post/OLD', at: '2026-11-11T05:10:00Z', items: [{ name: 'oldfan', handle: '@oldfan' }] };
  await pasteInto(page, '#paste', JSON.stringify(old));
  await page.waitForTimeout(150);
  check((await txt('#preview')).includes('這是用舊版抓取工具（v1.1）抓的，可以照常加入，但建議更新到 v' + VER), 'draw: preview warns about a v1.1 result');
  await page.click('#btn-add');
  await page.waitForTimeout(150);
  check((await txt('#tool-banner')).includes('舊版（v1.1）'), 'draw: banner names the old version');
  await page.screenshot({ path: path.join(OUT, 'shot-draw-update-banner.png'), clip: { x: 0, y: 0, width: 1280, height: 480 } });
  await page.click('#btn-tool-ok');
  await page.reload();
  await page.waitForTimeout(300);
  check(await page.isHidden('#tool-banner'), 'draw: 知道了 dismisses the banner for good');
  await ctx.close();

  // ---------- 黑底／白底 ----------
  for (const f of ['index.html', 'draw.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    check(html.indexOf('<script src="theme.js"></script>') > 0 && html.indexOf('<script src="theme.js"></script>') < html.indexOf('<style>'), f + ': theme.js runs before the styles, so a dark choice never flashes white');
  }
  const ctxT = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'light' });
  await serveSite(ctxT);
  const th = await ctxT.newPage();
  watch(th, 'theme');
  await th.goto(SITE);
  await th.waitForTimeout(200);
  const look = (p) => p.evaluate(() => ({
    theme: document.documentElement.getAttribute('data-theme'),
    bg: getComputedStyle(document.body).backgroundColor,
    label: Array.from(document.querySelectorAll('#theme-toggle > span')).filter(s => getComputedStyle(s).display !== 'none').map(s => s.textContent).join(),
    meta: Array.from(document.querySelectorAll('meta[name="theme-color"]')).map(m => m.content).join()
  }));
  const LIGHT = 'rgb(242, 244, 247)', DARK = 'rgb(17, 21, 28)';
  let l = await look(th);
  check(l.theme === null && l.bg === LIGHT && l.label === '切換成黑底', 'theme: light computer shows 白底 and offers 黑底 ' + JSON.stringify(l));
  await th.click('#theme-toggle');
  l = await look(th);
  check(l.theme === 'dark' && l.bg === DARK && l.label === '切換成白底' && l.meta === '#11151C,#11151C', 'theme: 黑底 button turns the homepage dark ' + JSON.stringify(l));
  await th.screenshot({ path: path.join(OUT, 'shot-theme-home-dark.png') });
  await th.reload();
  await th.waitForTimeout(200);
  l = await look(th);
  check(l.theme === 'dark' && l.bg === DARK, 'theme: the choice is remembered after reload');
  const thDraw = await ctxT.newPage();
  watch(thDraw, 'theme-draw');
  await thDraw.goto(SITE + 'draw.html');
  await thDraw.waitForTimeout(300);
  l = await look(thDraw);
  check(l.theme === 'dark' && l.bg === DARK && l.label === '切換成白底', 'theme: the draw page uses the same choice ' + JSON.stringify(l));
  await thDraw.screenshot({ path: path.join(OUT, 'shot-theme-draw-dark.png') });
  await thDraw.click('#theme-toggle');
  await thDraw.waitForTimeout(300);
  l = await look(thDraw);
  const homeAfter = await look(th);
  check(l.theme === 'light' && l.bg === LIGHT && homeAfter.theme === 'light' && homeAfter.bg === LIGHT, 'theme: 白底 on the draw page also switches the open homepage tab');
  await thDraw.screenshot({ path: path.join(OUT, 'shot-theme-draw-light.png'), clip: { x: 0, y: 0, width: 1280, height: 260 } });
  await ctxT.close();
  const ctxD = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark' });
  await serveSite(ctxD);
  const td = await ctxD.newPage();
  watch(td, 'theme-dark');
  await td.goto(SITE);
  await td.waitForTimeout(200);
  l = await look(td);
  check(l.theme === null && l.bg === DARK && l.label === '切換成白底', 'theme: dark computer starts dark and offers 白底 ' + JSON.stringify(l));
  await td.click('#theme-toggle');
  l = await look(td);
  check(l.theme === 'light' && l.bg === LIGHT && l.label === '切換成黑底' && l.meta === '#F2F4F7,#F2F4F7', 'theme: 白底 overrides the dark computer ' + JSON.stringify(l));
  await ctxD.close();

  // ---------- Phones, dark mode, reduced motion ----------
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  await serveSite(ctxM);
  const pm = await ctxM.newPage();
  watch(pm, 'mobile');
  await pm.goto(SITE);
  await pm.waitForTimeout(300);
  const ov = await pm.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const bg = await pm.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(ov <= 0 && bg === 'rgb(17, 21, 28)', 'home: no horizontal overflow on phones, dark background (' + ov + ', ' + bg + ')');
  check(await pm.isVisible('.topnav .btn') && await pm.isVisible('#theme-toggle') && await pm.isHidden('.topnav a[href="#faq"]'), 'home: phones keep 黑底／白底 and 開始抽獎 in the top bar');
  await pm.screenshot({ path: path.join(OUT, 'shot-home-mobile-dark.png'), fullPage: true });
  await pm.goto(SITE + 'draw.html');
  await pm.waitForTimeout(300);
  check(await pm.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'draw: no horizontal overflow on phones (準備)');
  await pm.click('.view-tab[data-view="draw"]');
  await pm.waitForTimeout(150);
  check(await pm.isVisible('#stage') && await pm.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, 'draw: no horizontal overflow on phones (抽獎)');
  await ctxM.close();
  const ctxR = await browser.newContext({ viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce' });
  await serveSite(ctxR);
  const pr = await ctxR.newPage();
  await pr.goto(SITE + '#install');
  await pr.waitForTimeout(300);
  const rm = await pr.evaluate(() => ({ running: document.getAnimations().length, arrow: getComputedStyle(document.querySelector('#demo .d-arrow')).display, seal: getComputedStyle(document.querySelector('.seal')).animationName }));
  check(rm.running === 0 && rm.arrow !== 'none' && rm.seal === 'none', 'home: reduced motion shows still pictures ' + JSON.stringify(rm));
  await ctxR.close();

  check(!errors.length, 'no page errors ' + JSON.stringify(errors));
  await browser.close();
  done();
})();
