// 抽獎名單抓取工具 — bookmarklet source.
// Runs on the open Facebook / X / Threads page, expands comments, collects
// commenters (or a likes / shares list), and copies a JSON result that the
// 抽獎系統 page imports on paste. build.js minifies it into the bookmark on index.html.
(function () {
  'use strict';
  // Keep in step with COLLECTOR_VERSION in draw.html (build.js checks).
  var VERSION = '1.3';
  // The 抽獎系統 page, filled in by build.js from the site address.
  var DRAW_URL = '__DRAW_URL__';
  var HOST_ID = 'giveaway-collector-host';
  var prev = document.getElementById(HOST_ID);
  if (prev) {
    try { if (prev.__gcStop) prev.__gcStop(); } catch (e) { /* ignore */ }
    prev.remove();
  }

  var hn = location.hostname.toLowerCase();
  var platform = /(^|\.)facebook\.com$/.test(hn) ? 'facebook'
    : (/(^|\.)x\.com$/.test(hn) || /(^|\.)twitter\.com$/.test(hn)) ? 'x'
    : /(^|\.)threads\.(net|com)$/.test(hn) ? 'threads' : null;
  var PLATFORM_LABEL = { facebook: 'Facebook', x: 'X', threads: 'Threads' };
  var KIND_LABEL = { comment: '留言', like: '按讚', share: '分享' };

  // ---------- utils ----------
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function txt(el) { return el ? String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim() : ''; }
  function $$(root, sel) { try { return Array.prototype.slice.call(root.querySelectorAll(sel)); } catch (e) { return []; } }
  function visible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function absUrl(href) { try { return new URL(href, location.href); } catch (e) { return null; } }
  function uniq(arr) { var s = []; arr.forEach(function (x) { if (x && s.indexOf(x) === -1) s.push(x); }); return s; }

  // ---------- profile links ----------
  var FB_RESERVED = /^(photo|photos|photo\.php|watch|reel|reels|stories|story\.php|hashtag|events|pages|marketplace|gaming|login|login\.php|help|policies|privacy|settings|notifications|messages|friends|bookmarks|search|ads|business|sharer|sharer\.php|share|permalink\.php|video\.php|l\.php|media|saved|memories|live|fundraisers|checkpoint|recover|reg|legal|about|careers|groups|games|feeds|home\.php|dialog|plugins|composer|ufi|reactions|watch_party|people|profile\.php)$/i;
  function fbHandle(href) {
    var u = absUrl(href);
    if (!u || !/(^|\.)facebook\.com$/.test(u.hostname)) return null;
    var parts = u.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    if (parts[0] === 'profile.php') { var id = (u.searchParams.get('id') || '').match(/\d+/); return id ? 'fb:' + id[0] : null; }
    if (parts[0] === 'people' && parts.length >= 3) return 'fb:' + parts[2];
    if (parts[0] === 'groups' && parts[2] === 'user' && parts[3]) return 'fb:' + parts[3];
    if (parts.length !== 1 || FB_RESERVED.test(parts[0])) return null;
    return 'fb:' + parts[0].toLowerCase();
  }
  var X_RESERVED = /^(home|explore|notifications|messages|i|settings|search|compose|tos|privacy|hashtag|login|signup|logout|intent|share|jobs|lists|communities|premium|bookmarks|grok|account|download)$/i;
  function xHandle(href) {
    var u = absUrl(href);
    if (!u || !/(^|\.)(x|twitter)\.com$/.test(u.hostname)) return null;
    var m = u.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/?$/);
    if (!m || X_RESERVED.test(m[1])) return null;
    return '@' + m[1];
  }
  function thHandle(href) {
    var u = absUrl(href);
    if (!u || !/(^|\.)threads\.(net|com)$/.test(u.hostname)) return null;
    var m = u.pathname.match(/^\/@([A-Za-z0-9_.]+)\/?$/);
    return m ? '@' + m[1] : null;
  }
  var handleOf = platform === 'facebook' ? fbHandle : platform === 'x' ? xHandle : thHandle;
  function hrefHandle(a) { return a && a.getAttribute ? handleOf(a.getAttribute('href') || '') : null; }
  function profileLinks(root) { return $$(root, 'a[href]').filter(function (a) { return !!hrefHandle(a); }); }
  function namedLink(links, skipAt) {
    for (var i = 0; i < links.length; i++) {
      var t = txt(links[i]);
      if (t && t.length <= 80 && !(skipAt && t.charAt(0) === '@')) return links[i];
    }
    return null;
  }

  // ---------- profile and comment links ----------
  function profileUrl(handle) {
    if (!handle) return '';
    if (platform === 'x') return 'https://x.com/' + handle.replace(/^@/, '');
    if (platform === 'threads') return location.origin + '/' + handle;
    var h = handle.replace(/^fb:/, '');
    return /^\d+$/.test(h) ? 'https://www.facebook.com/profile.php?id=' + h : 'https://www.facebook.com/' + h;
  }
  // A Facebook comment permalink: the post address plus comment_id (and reply_comment_id for replies),
  // without the tracking parameters. `base` gives the post address when the link itself is a profile link.
  function fbCommentLink(href, base) {
    var u = absUrl(href), b = base ? absUrl(base) : u;
    if (!u || !b) return '';
    var q = [];
    ['story_fbid', 'id', 'fbid', 'set', 'v'].forEach(function (k) { var v = b.searchParams.get(k); if (v) q.push(k + '=' + encodeURIComponent(v)); });
    ['comment_id', 'reply_comment_id'].forEach(function (k) { var v = u.searchParams.get(k); if (v) q.push(k + '=' + encodeURIComponent(v)); });
    return 'https://www.facebook.com' + b.pathname + (q.length ? '?' + q.join('&') : '');
  }
  function timeLinkUrl(c) {
    var t = c.querySelector('time');
    var a = t && t.closest('a[href]');
    var u = a && absUrl(a.getAttribute('href'));
    return u && /\/post\/|\/status\//.test(u.pathname) ? u.origin + u.pathname : '';
  }

  // ---------- avatars ----------
  // Avatars are re-drawn into small thumbnails (data URLs) because the 抽獎系統 page cannot load
  // pictures from other sites. That only works when the picture's server allows it (CORS);
  // otherwise the person simply has no avatar and the draw page shows the first letter.
  var AV = { src: new Map(), data: new Map(), failed: new Map(), miss: new Map(), queue: [], active: 0, onProgress: null };
  var AV_SIZE = 72, AV_MAX = 2000, AV_CONC = 4;
  var SKIP_IMG = /emoji|twemoji|\/rsrc\.php\/|\/images\/(emoji|reaction)|abs\.twimg\.com\/(emoji|hashflags|sticky)|\/hashflag/i;
  function personKey(handle, name) { return String(handle || name || '').toLowerCase(); }
  function avatarIn(root) {
    if (!root || !root.querySelectorAll) return null;
    var imgs = (root.matches && root.matches('img, image') ? [root] : []).concat($$(root, 'img, image'));
    for (var i = 0; i < imgs.length; i++) {
      var e = imgs[i];
      var raw = e.tagName.toLowerCase() === 'image'
        ? ((e.href && e.href.baseVal) || e.getAttribute('href') || e.getAttribute('xlink:href'))
        : (e.currentSrc || e.getAttribute('src'));
      var u = raw && absUrl(raw);
      if (!u || !/^https?:$/.test(u.protocol) || SKIP_IMG.test(u.href)) continue;
      var r = e.getBoundingClientRect();
      if (r.width && (r.width < 20 || r.width > 160)) continue;
      return u.href;
    }
    return null;
  }
  // The picture inside a link to this person's profile.
  function avatarFor(root, handle) {
    var key = (handle || '').toLowerCase();
    if (!key || !root) return null;
    var links = profileLinks(root);
    for (var i = 0; i < links.length; i++) {
      if ((hrefHandle(links[i]) || '').toLowerCase() !== key) continue;
      var s = avatarIn(links[i]);
      if (s) return s;
    }
    return null;
  }
  // Threads / Instagram label avatars "username's profile picture" / "username的大頭貼照".
  function avatarByAlt(root, handle) {
    var user = (handle || '').replace(/^@/, '').toLowerCase();
    if (!user || !root) return null;
    var imgs = $$(root, 'img[alt]').filter(function (i) { return (i.getAttribute('alt') || '').toLowerCase().indexOf(user) !== -1; });
    for (var i = 0; i < imgs.length; i++) { var s = avatarIn(imgs[i]); if (s) return s; }
    return null;
  }
  // From a name link, look outwards while the container still only belongs to this person.
  function avatarNear(el, handle) {
    var key = (handle || '').toLowerCase();
    for (var e = el && el.parentElement, i = 0; e && i < 6 && e !== document.body && e !== document.documentElement; e = e.parentElement, i++) {
      var others = profileLinks(e).some(function (l) { return (hrefHandle(l) || '').toLowerCase() !== key; });
      if (others) break;
      var s = avatarFor(e, handle) || avatarIn(e);
      if (s) return s;
    }
    return null;
  }
  function grabAvatar(pk, find) {
    if (!pk || AV.src.has(pk) || AV.src.size >= AV_MAX || (AV.miss.get(pk) || 0) >= 6) return;
    var src = null;
    try { src = find(); } catch (e) { src = null; }
    if (!src) { AV.miss.set(pk, (AV.miss.get(pk) || 0) + 1); return; }
    AV.src.set(pk, src);
    AV.queue.push(pk);
    pumpAvatars();
  }
  function thumb(src) {
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { end(null, 'timeout'); }, 10000);
      function end(d, why) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ data: d, why: why || '' });
      }
      function draw(img, w, h) {
        if (!w || !h) return null;
        var side = Math.min(w, h);
        var size = Math.max(24, Math.min(AV_SIZE, side));
        var c = document.createElement('canvas');
        c.width = c.height = size;
        var g = c.getContext('2d');
        g.fillStyle = '#FFFFFF';
        g.fillRect(0, 0, size, size);
        g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
        var d = c.toDataURL('image/webp', 0.8); // throws when the picture is not allowed to be read
        if (d.indexOf('data:image/webp') !== 0) d = c.toDataURL('image/jpeg', 0.82);
        return d.length > 64 ? d : null;
      }
      function viaFetch(why) {
        if (!window.fetch || !window.createImageBitmap) { end(null, why); return; }
        fetch(src, { mode: 'cors', credentials: 'omit', cache: 'reload' })
          .then(function (r) { if (!r.ok) throw new Error('http'); return r.blob(); })
          .then(function (b) { return createImageBitmap(b); })
          .then(function (bm) {
            var d = null;
            try { d = draw(bm, bm.width, bm.height); } catch (e) { d = null; }
            end(d, d ? '' : 'draw');
          })
          .catch(function () { end(null, why + '+fetch'); });
      }
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        var d = null;
        try { d = draw(img, img.naturalWidth, img.naturalHeight); } catch (e) { viaFetch('tainted'); return; }
        if (d) end(d); else viaFetch('empty');
      };
      img.onerror = function () { viaFetch('img'); };
      img.src = src;
    });
  }
  // X serves 48px avatars as *_normal; the 73px *_bigger version looks better on the draw page.
  function thumbBest(src) {
    var big = src.replace(/_normal(\.[A-Za-z0-9]+)(\?|$)/, '_bigger$1$2');
    if (big === src) return thumb(src);
    return thumb(big).then(function (r) { return r.data ? r : thumb(src); });
  }
  function pumpAvatars() {
    while (AV.active < AV_CONC && AV.queue.length) {
      (function (pk) {
        AV.active++;
        thumbBest(AV.src.get(pk)).then(function (r) {
          AV.active--;
          if (r.data) AV.data.set(pk, r.data); else AV.failed.set(pk, r.why || 'error');
          pumpAvatars();
          if (AV.onProgress) AV.onProgress();
        });
      })(AV.queue.shift());
    }
  }

  // Post owner (X and Threads URLs name the author), so their own replies are skipped.
  function ownerHandle() {
    var m;
    if (platform === 'x' && (m = location.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/\d+/))) return '@' + m[1].toLowerCase();
    if (platform === 'threads' && (m = location.pathname.match(/^\/@([A-Za-z0-9_.]+)\/post\//))) return '@' + m[1].toLowerCase();
    return null;
  }
  function mainPostId() {
    var m;
    if (platform === 'x' && (m = location.pathname.match(/\/status\/(\d+)/))) return m[1];
    if (platform === 'threads' && (m = location.pathname.match(/\/post\/([A-Za-z0-9_-]+)/))) return m[1];
    return null;
  }
  function looksLikePostPage() {
    var p = location.pathname + location.search;
    if (platform === 'x') return /\/status\/\d+/.test(p);
    if (platform === 'threads') return /\/post\//.test(p);
    return /\/posts\/|\/permalink|story_fbid=|\/photo|fbid=|\/videos\/|\/reel\/|\/share\/|\/watch|multi_permalinks|\/media\//.test(p);
  }

  // ---------- what to collect ----------
  var LIKE_RE = /心情|讚|喜歡|按讚|reaction|like/i;
  var SHARE_RE = /分享|轉發|轉貼|轉推|引用|share|repost|retweet|quote/i;
  function openDialogs() { return $$(document, '[role="dialog"]').filter(visible); }
  function dialogTitle(d) {
    var parts = [d.getAttribute('aria-label') || ''];
    var lb = d.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach(function (id) { var e = document.getElementById(id); if (e) parts.push(txt(e)); });
    var h = d.querySelector('h1, h2, h3, [role="heading"]');
    if (h) parts.push(txt(h));
    return parts.join(' ').slice(0, 200);
  }
  function hasComposer(d) { return !!d.querySelector('[contenteditable="true"], textarea, [role="textbox"]'); }
  // sure: the page names the list (an X list page, or the pop-up's title says 讚 / 分享).
  // guessed: a pop-up full of people that gives no hint at all.
  function detect() {
    var path = location.pathname;
    if (platform === 'x') {
      if (/\/status\/\d+\/likes\/?$/.test(path)) return { kind: 'like', scope: xScope(), sure: true };
      if (/\/status\/\d+\/(retweets|reposts)\/?$/.test(path)) return { kind: 'share', scope: xScope(), sure: true };
      if (/\/status\/\d+\/quotes\/?$/.test(path)) return { kind: 'share', scope: xScope(), quotes: true, sure: true };
    }
    var ds = openDialogs();
    for (var i = ds.length - 1; i >= 0; i--) {
      var d = ds[i];
      if (!profileLinks(d).length) continue;
      var title = dialogTitle(d);
      if (hasComposer(d)) return { kind: 'comment', scope: d };
      if (SHARE_RE.test(title)) return { kind: 'share', scope: d, sure: true };
      if (LIKE_RE.test(title)) return { kind: 'like', scope: d, sure: true };
      if (/動態|activity|互動/i.test(title) || d.querySelector('[role="tab"]')) return { kind: 'like', scope: d };
      if (/貼文|post|留言|comment/i.test(title)) return { kind: 'comment', scope: d };
      return { kind: 'like', scope: d, guessed: true };
    }
    return { kind: 'comment', scope: platform === 'x' ? xScope() : document };
  }
  function xScope() { return document.querySelector('[data-testid="primaryColumn"]') || document; }
  // The likes / shares list the person has opened (an X list page or a pop-up list), or null.
  // A pop-up with no hint (say, a profile card) does not count.
  function openList() {
    var d = detect();
    return d.kind !== 'comment' && !d.guessed ? d : null;
  }
  function onListPage() { return platform === 'x' && /\/status\/\d+\/(likes|retweets|reposts|quotes)\/?$/.test(location.pathname); }

  // ---------- collectors ----------
  // run: bumped for every new run, so a run that was replaced stops touching the panel.
  // wait: timer while waiting for the person to open a likes / shares list.
  // results: the finished list for each kind, kept while the panel stays open.
  var S = {
    kind: 'comment', scope: document, quotes: false,
    store: new Map(), skipIds: new Set(), skippedOwner: new Set(),
    owner: ownerHandle(), running: false, lastEl: null,
    run: 0, wait: null, results: {}, summary: '', notes: [], stale: null
  };
  function put(key, item, el) {
    var cur = S.store.get(key);
    if (cur) {
      // Keep the fullest version: text can grow after "See more" is expanded. Links that only
      // showed up later are kept either way.
      var keep = (item.text || '').length > (cur.text || '').length ? item : cur;
      var other = keep === item ? cur : item;
      ['handle', 'url', 'link'].forEach(function (k) { if (!keep[k] && other[k]) keep[k] = other[k]; });
      item = keep;
    }
    S.store.set(key, item);
    if (el) S.lastEl = el;
  }
  function isOwner(handle) { return !!(S.owner && handle && handle.toLowerCase() === S.owner); }

  // Facebook comments: [role=article] blocks labelled as comments/replies, or nested in the post.
  function fbCommentArticles(scope) {
    return $$(scope, '[role="article"]').filter(function (a) {
      var label = a.getAttribute('aria-label') || '';
      var nested = a.parentElement && a.parentElement.closest('[role="article"]');
      return /留言|回覆|回复|评论|評論|comment|reply/i.test(label) || !!nested;
    });
  }
  function ownedBy(el, art) { return el.closest('[role="article"]') === art; }
  function fbHarvestComments(scope) {
    fbCommentArticles(scope).forEach(function (art) {
      var links = profileLinks(art).filter(function (a) { return ownedBy(a, art); });
      var author = namedLink(links, false);
      if (!author) return;
      var handle = hrefHandle(author);
      var blocks = $$(art, 'div[dir="auto"]').filter(function (d) {
        return ownedBy(d, art) && !d.contains(author) && !author.contains(d) && !d.querySelector('div[dir="auto"]');
      });
      var text = blocks.map(txt).filter(Boolean).join(' ').replace(/(…|\.\.\.)?\s*(查看更多|See more|顯示更多)$/i, '').trim();
      var tags = [];
      blocks.forEach(function (b) {
        profileLinks(b).forEach(function (a) { var h = hrefHandle(a); if (h && h !== handle) tags.push(h); });
      });
      var cid = '';
      var idLinks = $$(art, 'a[href*="comment_id="]').filter(function (a) { return ownedBy(a, art); });
      var idLink = idLinks[0];
      if (idLink) {
        var u = absUrl(idLink.getAttribute('href'));
        if (u) cid = u.searchParams.get('reply_comment_id') || u.searchParams.get('comment_id') || '';
      }
      // The comment's time link points at the post; profile links also carry comment_id.
      var tsLink = idLinks.filter(function (a) { return !hrefHandle(a); })[0];
      var link = tsLink ? fbCommentLink(tsLink.getAttribute('href'))
        : (idLink && looksLikePostPage() ? fbCommentLink(idLink.getAttribute('href'), location.href) : '');
      var name = txt(author);
      put(cid ? 'c:' + cid : 'h:' + (handle || name) + '|' + text, { name: name, handle: handle, text: text, tags: uniq(tags), url: profileUrl(handle), link: link }, art);
      grabAvatar(personKey(handle, name), function () { return avatarFor(art, handle) || avatarNear(author, handle); });
    });
  }

  // X replies: article[data-testid=tweet] after the main post.
  function xStatusId(art) {
    var t = art.querySelector('a[href*="/status/"] time');
    var a = t && t.closest('a');
    var m = a && (a.getAttribute('href') || '').match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }
  function xAuthor(root) {
    var un = root.querySelector('[data-testid="User-Name"]') || root;
    var links = profileLinks(un);
    if (!links.length) return null;
    var handle = hrefHandle(links[0]);
    var nl = namedLink(links, true);
    return { handle: handle, name: nl ? txt(nl) : handle };
  }
  function xHarvestComments(scope) {
    $$(scope, 'article').forEach(function (art) {
      var id = xStatusId(art);
      if (!id || S.skipIds.has(id)) return;
      var au = xAuthor(art);
      if (!au) return;
      if (isOwner(au.handle)) { S.skippedOwner.add(id); return; }
      var tt = art.querySelector('[data-testid="tweetText"]');
      var tags = tt ? profileLinks(tt).map(hrefHandle).filter(function (h) { return h && h !== au.handle; }) : [];
      put('x:' + id, { name: au.name, handle: au.handle, text: txt(tt), tags: uniq(tags), url: profileUrl(au.handle), link: 'https://x.com/' + au.handle.slice(1) + '/status/' + id }, art);
      grabAvatar(personKey(au.handle), function () { return xAvatar(art, au.handle); });
    });
  }
  function xAvatar(root, handle) {
    return avatarIn(root.querySelector('[data-testid="Tweet-User-Avatar"]')) || avatarFor(root, handle);
  }
  // X changes the address before it draws the new list, so what was on screen before the person
  // opened the list (the post and its replies) is skipped.
  function fresh(el) { return !S.stale || !S.stale.has(el); }
  function staleNow() { return new Set($$(document, 'article, [data-testid="UserCell"]')); }
  function xHarvestPeople(scope) {
    $$(scope, '[data-testid="UserCell"]').filter(fresh).forEach(function (cell) {
      var links = profileLinks(cell);
      if (!links.length) return;
      var handle = hrefHandle(links[0]);
      var nl = namedLink(links, true);
      put('p:' + handle.toLowerCase(), { name: nl ? txt(nl) : handle, handle: handle, url: profileUrl(handle) }, cell);
      grabAvatar(personKey(handle), function () { return avatarFor(cell, handle) || avatarIn(cell); });
    });
  }
  function xHarvestQuotes(scope) {
    $$(scope, 'article').filter(fresh).forEach(function (art) {
      var id = xStatusId(art);
      if (!id || S.skipIds.has(id)) return;
      var au = xAuthor(art);
      if (!au || isOwner(au.handle)) return;
      put('p:' + au.handle.toLowerCase(), { name: au.name, handle: au.handle, url: profileUrl(au.handle), link: 'https://x.com/' + au.handle.slice(1) + '/status/' + id }, art);
      grabAvatar(personKey(au.handle), function () { return xAvatar(art, au.handle); });
    });
  }

  // Generic posts (Threads, and a fallback elsewhere): the largest block around each <time>.
  function timeContainers(scope) {
    var out = [];
    $$(scope, 'time').forEach(function (t) {
      var el = t;
      while (el && el.parentElement && el !== scope) {
        var p = el.parentElement;
        if (p.querySelectorAll('time').length > 1) break;
        el = p;
      }
      if (el && el !== scope && el !== document.body && el !== document.documentElement && out.indexOf(el) === -1) out.push(el);
    });
    return out;
  }
  function postIdOf(c) {
    var t = c.querySelector('time');
    var a = t && t.closest('a[href]');
    var href = a ? a.getAttribute('href') : '';
    var m = href.match(/\/post\/([A-Za-z0-9_-]+)/) || href.match(/\/status\/(\d+)/);
    return m ? m[1] : null;
  }
  var UI_WORDS = /^(翻譯|查看翻譯|翻译|Translate|See translation|作者|Author|已編輯|Edited|回覆|回复|Reply|讚|Like|·|•|更多|More|查看更多|See more|追蹤|Follow)$/i;
  function containerText(c, author, timeEl) {
    var cands = $$(c, '[dir="auto"]').filter(function (e) {
      if (e.closest('a[href]')) return false;
      if (author && (e.contains(author) || author.contains(e))) return false;
      if (timeEl && e.contains(timeEl)) return false;
      var t = txt(e);
      return !!t && !/^[\d,.\s]+[KkMm萬万]?$/.test(t) && !UI_WORDS.test(t);
    });
    return cands.filter(function (e) {
      return !cands.some(function (o) { return o !== e && e.contains(o); });
    });
  }
  function genericHarvestComments(scope) {
    timeContainers(scope).forEach(function (c) {
      var id = postIdOf(c);
      if (id && S.skipIds.has(id)) return;
      var author = namedLink(profileLinks(c), false);
      if (!author) return;
      var handle = hrefHandle(author);
      if (isOwner(handle)) { S.skippedOwner.add(id || handle); return; }
      var blocks = containerText(c, author, c.querySelector('time'));
      var text = blocks.map(txt).join(' ').trim();
      var tags = [];
      blocks.forEach(function (b) {
        profileLinks(b).forEach(function (a) { var h = hrefHandle(a); if (h && h !== handle) tags.push(h); });
      });
      var name = txt(author).replace(/^@/, '');
      put(id ? 'g:' + id : 'h:' + handle + '|' + text, { name: name, handle: handle, text: text, tags: uniq(tags), url: profileUrl(handle), link: timeLinkUrl(c) }, c);
      grabAvatar(personKey(handle, name), function () { return avatarFor(c, handle) || avatarByAlt(c, handle) || avatarNear(author, handle); });
    });
  }

  // Lists of people (likes / shares dialogs).
  function harvestPeople(scope) {
    var arts = $$(scope, '[role="article"]');
    if (arts.length) {
      arts.forEach(function (art) {
        var a = namedLink(profileLinks(art).filter(function (l) { return ownedBy(l, art); }), false);
        var h = hrefHandle(a);
        if (!h || isOwner(h)) return;
        put('p:' + h.toLowerCase(), { name: txt(a).replace(/^@/, ''), handle: h, url: profileUrl(h) }, art);
        grabAvatar(personKey(h), function () { return avatarFor(art, h) || avatarNear(a, h); });
      });
      return;
    }
    var links = profileLinks(scope);
    [true, false].forEach(function (textPass) {
      links.forEach(function (a) {
        var name = textPass ? txt(a) : (a.getAttribute('aria-label') || '').trim();
        var h = hrefHandle(a);
        if (!h || !name || name.length > 80 || isOwner(h)) return;
        put('p:' + h.toLowerCase(), { name: name.replace(/^@/, ''), handle: h, url: profileUrl(h) }, a);
        grabAvatar(personKey(h), function () { return avatarIn(a) || avatarNear(a, h); });
      });
    });
  }

  function harvest() {
    var s = S.scope;
    if (S.kind === 'comment') {
      if (platform === 'facebook') fbHarvestComments(s);
      else if (platform === 'x') xHarvestComments(s);
      if (!S.store.size || platform === 'threads') genericHarvestComments(s);
    } else if (platform === 'x' && S.quotes) xHarvestQuotes(s);
    else if (platform === 'x' && (onListPage() || (s.querySelector && s.querySelector('[data-testid="UserCell"]')))) xHarvestPeople(s);
    else harvestPeople(s);
  }

  // Posts above and including the main one (the post itself, parent posts) are not entries.
  function initSkip() {
    S.skipIds = new Set();
    var main = mainPostId();
    if (!main) return;
    S.skipIds.add(main);
    var ids = (platform === 'x' ? $$(S.scope, 'article').map(xStatusId) : timeContainers(S.scope).map(postIdOf)).filter(Boolean);
    if (ids.indexOf(main) !== -1) {
      for (var i = 0; i < ids.length && ids[i] !== main; i++) S.skipIds.add(ids[i]);
    }
  }

  // ---------- expanding & scrolling ----------
  var EXPAND_RE = /^(查看更多留言|查看之前的留言|查看更多評論|查看更多回覆|查看更多回复|查看更多评论|查看之前的评论|顯示更多回覆|顯示更多留言|显示更多回复|更多留言|更多回覆|載入更多|加载更多|View more comments|View previous comments|View more replies|Show more replies|Show additional replies|Show probable spam|Show replies|See more replies|Load more comments|Load more replies|顯示可能是垃圾|显示可能的垃圾)/i;
  var REPLIES_RE = /^(查看全部\s*\d+\s*則回覆|查看\s*\d+\s*則回覆|\d+\s*則回覆|查看全部\s*\d+\s*条回复|查看\s*\d+\s*条回复|\d+\s*条回复|View all \d+ replies|View \d+ repl(y|ies)|\d+ repl(y|ies)$|See all \d+ replies)/i;
  var SEEMORE_RE = /^(查看更多|顯示更多|See more|展开|展開)$/i;
  var clicks = new WeakMap();
  function expand() {
    var n = 0, now = Date.now();
    var cands = $$(S.scope, '[role="button"], button');
    for (var i = 0; i < cands.length && n < 6; i++) {
      var el = cands[i];
      var href = el.closest('a[href]');
      if (href && (href.getAttribute('href') || '#') !== '#') continue;
      var t = txt(el);
      if (!t || t.length > 40) continue;
      var ok = EXPAND_RE.test(t) || REPLIES_RE.test(t) ||
        (platform === 'facebook' && SEEMORE_RE.test(t) && !!el.closest('[role="article"]'));
      if (!ok || !visible(el)) continue;
      // The same button can stay on the page and load more each time; pace repeat clicks.
      var c = clicks.get(el) || { n: 0, t: 0 };
      if (c.n >= 40 || now - c.t < 1500) continue;
      c.n++;
      c.t = now;
      clicks.set(el, c);
      try { el.click(); n++; } catch (e) { /* ignore */ }
    }
    return n;
  }
  function scrollableAncestor(el) {
    for (var e = el && el.parentElement; e && e !== document.body && e !== document.documentElement; e = e.parentElement) {
      if (e.scrollHeight > e.clientHeight + 20) {
        var oy = getComputedStyle(e).overflowY;
        if (oy === 'auto' || oy === 'scroll') return e;
      }
    }
    return null;
  }
  function firstScrollable(scope) {
    var els = $$(scope, 'div');
    for (var i = 0; i < els.length && i < 5000; i++) {
      var e = els[i];
      if (e.scrollHeight > e.clientHeight + 20) {
        var oy = getComputedStyle(e).overflowY;
        if (oy === 'auto' || oy === 'scroll') return e;
      }
    }
    return null;
  }
  function scrollStep() {
    var target = (S.lastEl && S.lastEl.isConnected && scrollableAncestor(S.lastEl)) ||
      (S.scope !== document && S.scope.nodeType === 1 ? firstScrollable(S.scope) : null);
    if (target) {
      var y = target.scrollTop;
      target.scrollTop = y + Math.max(200, target.clientHeight * 0.85);
      return target.scrollTop !== y;
    }
    var y2 = window.scrollY;
    window.scrollBy(0, Math.max(300, window.innerHeight * 0.85));
    return window.scrollY !== y2;
  }

  // Facebook hides comments under "Most relevant"; switch to "All comments" when possible.
  async function fbAllComments(scope) {
    var sortRe = /^(最相關|最相关|Most relevant|熱門留言|热门评论|Top comments|最新|最新留言|Newest|Most recent)$/i;
    var btn = $$(scope, '[role="button"]').filter(function (b) { return sortRe.test(txt(b)) && visible(b); })[0];
    if (!btn) return 'none';
    btn.click();
    await sleep(900);
    var itemRe = /^(所有留言|全部留言|所有评论|全部评论|All comments)/i;
    var item = $$(document, '[role="menuitem"], [role="menuitemradio"], [role="option"]').filter(function (m) { return itemRe.test(txt(m)); })[0];
    if (!item) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return 'failed';
    }
    item.click();
    await sleep(1600);
    return 'switched';
  }

  // ---------- result ----------
  function items() {
    var out = [];
    S.store.forEach(function (v) {
      var o = { name: v.name };
      if (v.handle) o.handle = v.handle;
      if (v.text) o.text = v.text;
      if (v.tags && v.tags.length) o.tags = v.tags;
      if (v.url) o.url = v.url;
      if (v.link) o.link = v.link;
      out.push(o);
    });
    return out;
  }
  function peopleKeys() {
    var set = new Set();
    S.store.forEach(function (v) { set.add(personKey(v.handle, v.name)); });
    return Array.from(set);
  }
  function uniquePeople() { return peopleKeys().length; }
  // Avatar thumbnails, keyed by handle (or name when there is no handle).
  function avatarsMap() {
    var out = {}, n = 0;
    peopleKeys().forEach(function (k) {
      var d = AV.data.get(k);
      if (d) { out[k] = d; n++; }
    });
    return n ? out : null;
  }
  function resultText() {
    var o = {
      giveaway: 'list', v: 1, tool: VERSION, platform: platform, kind: S.kind,
      page: location.origin + location.pathname, at: new Date().toISOString(), items: items()
    };
    var av = avatarsMap();
    if (av) o.avatars = av;
    return JSON.stringify(o);
  }
  function avDiag() {
    var why = {}, hosts = {};
    AV.failed.forEach(function (w, k) {
      why[w] = (why[w] || 0) + 1;
      var u = absUrl(AV.src.get(k) || '');
      if (u) { var h = u.hostname.split('.').slice(-2).join('.'); hosts[h] = (hosts[h] || 0) + 1; }
    });
    return { found: AV.src.size, ok: AV.data.size, failed: AV.failed.size, pending: AV.queue.length + AV.active, why: why, hosts: hosts };
  }
  function diagText() {
    var d = {
      tool: VERSION, platform: platform, kind: S.kind, items: S.store.size, people: uniquePeople(),
      avatars: avDiag(),
      path: location.pathname.replace(/\d{5,}/g, '#'),
      dialogs: openDialogs().length,
      roleArticles: $$(document, '[role="article"]').length,
      articles: $$(document, 'article').length,
      times: $$(document, 'time').length,
      profileLinks: profileLinks(document).length,
      dirAuto: $$(document, '[dir="auto"]').length,
      labels: $$(document, '[role="article"][aria-label]').slice(0, 5).map(function (a) { return (a.getAttribute('aria-label') || '').slice(-14); }),
      buttons: uniq($$(document, '[role="button"]').map(txt).filter(function (t) { return t && t.length < 24; })).slice(0, 30)
    };
    return JSON.stringify(d);
  }

  // ---------- panel UI (shadow DOM, styles set through CSSOM) ----------
  var C = { ink: '#1A2030', muted: '#586174', line: '#D8DDE6', red: '#C62B2B', soft: '#F6EDD8', gold: '#85600F', bg: '#FFFFFF', paper: '#F2F4F7', ok: '#1B6E45' };
  function css(el, o) { for (var k in o) el.style[k] = o[k]; return el; }
  function mk(tag, style, text) { var e = document.createElement(tag); if (style) css(e, style); if (text != null) e.textContent = text; return e; }
  function btnStyle(primary) {
    return {
      font: 'inherit', fontSize: '14px', fontWeight: '600', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer',
      border: '1px solid ' + (primary ? C.red : C.line), background: primary ? C.red : C.bg, color: primary ? '#FFFFFF' : C.ink,
      lineHeight: '1.3'
    };
  }

  var host = mk('div', { position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647', all: 'initial' });
  css(host, { position: 'fixed', top: '16px', right: '16px', zIndex: '2147483647' });
  host.id = HOST_ID;
  var root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  var panel = mk('div', {
    width: '320px', maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box', background: C.bg, color: C.ink,
    border: '1px solid ' + C.line, borderRadius: '12px', boxShadow: '0 12px 36px rgba(16,24,40,.28)',
    padding: '14px 16px 16px', fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Segoe UI", sans-serif',
    fontSize: '14px', lineHeight: '1.5', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '10px'
  });
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '抓取抽獎名單');
  root.appendChild(panel);

  var head = mk('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' });
  var title = mk('div', { fontWeight: '700', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '8px' });
  var mark = mk('span', { display: 'inline-grid', placeItems: 'center', width: '22px', height: '22px', borderRadius: '5px', background: C.red, color: '#FFFFFF', fontSize: '13px', transform: 'rotate(-6deg)' }, '抽');
  title.appendChild(mark);
  title.appendChild(document.createTextNode('抓取抽獎名單'));
  title.appendChild(mk('span', { fontSize: '11px', fontWeight: '500', color: C.muted }, 'v' + VERSION));
  var close = mk('button', { border: '0', background: 'transparent', color: C.muted, fontSize: '22px', lineHeight: '1', cursor: 'pointer', padding: '0 4px' }, '×');
  close.setAttribute('aria-label', '關閉');
  head.appendChild(title);
  head.appendChild(close);
  panel.appendChild(head);

  var where = mk('div', { fontSize: '12.5px', color: C.muted });
  panel.appendChild(where);

  var modes = mk('div', { display: 'flex', gap: '4px', padding: '3px', background: C.paper, borderRadius: '8px' });
  var modeBtns = {};
  ['comment', 'like', 'share'].forEach(function (k) {
    var b = mk('button', { flex: '1', border: '0', borderRadius: '6px', padding: '6px 0', font: 'inherit', fontSize: '13px', cursor: 'pointer', background: 'transparent', color: C.muted }, KIND_LABEL[k]);
    b.addEventListener('click', function () { choose(k); });
    modeBtns[k] = b;
    modes.appendChild(b);
  });
  panel.appendChild(modes);

  var countRow = mk('div', { display: 'flex', alignItems: 'baseline', gap: '6px' });
  var countNum = mk('span', { fontSize: '30px', fontWeight: '700', fontVariantNumeric: 'tabular-nums', lineHeight: '1.1' }, '0');
  var countUnit = mk('span', { color: C.muted }, '');
  countRow.appendChild(countNum);
  countRow.appendChild(countUnit);
  panel.appendChild(countRow);

  var status = mk('div', { fontSize: '13px', color: C.muted });
  panel.appendChild(status);
  var tip = mk('div', { fontSize: '12.5px', background: C.soft, color: C.ink, borderRadius: '8px', padding: '8px 10px', display: 'none', whiteSpace: 'pre-line' });
  panel.appendChild(tip);
  // Big green confirmation once the result is on the clipboard.
  var okBox = mk('div', { display: 'none', fontSize: '14px', fontWeight: '700', lineHeight: '1.5', background: '#E3F4EA', color: '#14532D', border: '1px solid ' + C.ok, borderRadius: '8px', padding: '10px 12px' });
  okBox.setAttribute('role', 'status');
  panel.appendChild(okBox);
  var actions = mk('div', { display: 'flex', gap: '8px', flexWrap: 'wrap' });
  panel.appendChild(actions);
  // After copying: which lists are still to do (for example the likes), with a button for each.
  var nextBox = mk('div', { display: 'none', fontSize: '13px', color: C.ink, borderTop: '1px solid ' + C.line, paddingTop: '10px' });
  panel.appendChild(nextBox);
  var box = mk('textarea', { display: 'none', width: '100%', boxSizing: 'border-box', height: '90px', fontSize: '12px', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', border: '1px solid ' + C.line, borderRadius: '6px', padding: '6px' });
  box.readOnly = true;
  panel.appendChild(box);

  document.documentElement.appendChild(host);
  host.__gcStop = function () { S.running = false; S.run++; stopWait(); };
  close.addEventListener('click', function () { host.__gcStop(); host.remove(); });

  function setStatus(s) { status.textContent = s; }
  function setTip(s) { tip.textContent = s || ''; css(tip, { display: s ? 'block' : 'none' }); }
  // withLink adds an 「打開抽獎系統」 button under the message (after copying the result).
  function showOk(s, withLink) {
    okBox.textContent = s || '';
    if (s && withLink && /^https:\/\//.test(DRAW_URL)) {
      var a = mk('a', { display: 'inline-block', marginTop: '8px', padding: '6px 12px', borderRadius: '6px', background: C.ok, color: '#FFFFFF', fontSize: '13.5px', fontWeight: '700', textDecoration: 'none', cursor: 'pointer' }, '打開抽獎系統 ↗');
      a.href = DRAW_URL;
      a.target = '_blank';
      a.rel = 'noopener';
      okBox.appendChild(mk('br'));
      okBox.appendChild(a);
    }
    css(okBox, { display: s ? 'block' : 'none' });
  }
  var copyBtn = null, copiedTimer = null;
  function setActions(list) {
    while (actions.firstChild) actions.removeChild(actions.firstChild);
    copyBtn = null;
    clearTimeout(copiedTimer);
    list.forEach(function (a) {
      var b = mk('button', btnStyle(a.primary), a.label);
      b.addEventListener('click', a.onClick);
      if (a.copy) copyBtn = b;
      actions.appendChild(b);
    });
  }
  function markCopied() {
    if (box.style.display !== 'none') { setTip(''); css(box, { display: 'none' }); }
    if (S.summary) setStatus(S.summary);
    showOk('✓ 已複製成功！請到抽獎系統第 1 步貼上，再按「加入名單」。', true);
    showNext(true);
    var b = copyBtn;
    if (!b) return;
    b.textContent = '✓ 已複製';
    css(b, { background: C.ok, borderColor: C.ok, color: '#FFFFFF' });
    clearTimeout(copiedTimer);
    copiedTimer = setTimeout(function () {
      b.textContent = '再複製一次';
      css(b, btnStyle(false));
    }, 3000);
  }
  function renderMode() {
    ['comment', 'like', 'share'].forEach(function (k) {
      var on = S.kind === k;
      css(modeBtns[k], { background: on ? C.bg : 'transparent', color: on ? C.ink : C.muted, fontWeight: on ? '700' : '400', boxShadow: on ? '0 1px 2px rgba(0,0,0,.12)' : 'none' });
    });
    countUnit.textContent = S.kind === 'comment' ? '則留言' : (S.kind === 'like' ? '位按讚的人' : '位分享的人');
    where.textContent = PLATFORM_LABEL[platform] + '・' + (inDialog() ? '目前打開的視窗' : '目前頁面');
  }
  function updateCount() { countNum.textContent = String(S.store.size); }
  function listScope() {
    var d = detect();
    if (d.kind !== 'comment') return d.scope;
    var ds = openDialogs().filter(function (x) { return profileLinks(x).length && !hasComposer(x); });
    return ds.length ? ds[ds.length - 1] : (platform === 'x' ? xScope() : document);
  }
  function commentScope() {
    var ds = openDialogs().filter(hasComposer);
    return ds.length ? ds[ds.length - 1] : (platform === 'x' ? xScope() : document);
  }
  function inDialog() { return S.scope !== document && !!S.scope.getAttribute && S.scope.getAttribute('role') === 'dialog'; }
  function setKind(k) {
    S.kind = k;
    S.scope = k === 'comment' ? commentScope() : listScope();
    S.quotes = platform === 'x' && k === 'share' && /\/status\/\d+\/quotes\/?$/.test(location.pathname);
  }

  // ---------- choosing a list ----------
  // Likes and shares sit in their own list (a pop-up, or a page on X). Pressing 按讚 / 分享 here
  // waits for the person to open that list and then starts by itself, instead of reading the
  // post page, where the commenters would be counted as likers.
  function ready(k) {
    var d = openList();
    return k === 'comment' ? !d : !!d && d.kind === k;
  }
  function listHelp(k) {
    if (platform === 'x') {
      return k === 'like'
        ? '打開這則貼文的按讚名單（網址結尾是 /likes），工具會自動開始抓。X 只讓貼文作者看到按讚名單。'
        : '打開這則貼文的轉發名單（網址結尾是 /retweets）或引用名單（/quotes），工具會自動開始抓。';
    }
    if (platform === 'threads') return '點貼文下方的' + (k === 'like' ? '讚數' : '轉發數') + '或「動態」，跳出名單視窗後，工具會自動開始抓。';
    return k === 'like'
      ? '點貼文下方表情符號旁邊的數字，跳出按讚名單後，工具會自動開始抓。'
      : '點貼文下方的「N 次分享」，跳出分享名單後，工具會自動開始抓。';
  }
  // [status, tip] while waiting.
  function waitText(k) {
    if (k === 'comment') {
      return ['等你回到貼文…', platform === 'x'
        ? '請回到貼文頁（按瀏覽器的「上一頁」），工具會自動開始抓留言。'
        : '請先關掉按讚或分享的名單視窗，工具會自動開始抓留言。'];
    }
    var d = openList();
    var again = '\n沒有自動開始的話，按下面的「名單已經打開了」。';
    if (d && d.kind !== k) {
      return ['現在打開的是' + KIND_LABEL[d.kind] + '名單', (platform === 'x' ? '請改成' : '請先關掉它，再') + listHelp(k) + again];
    }
    return ['等你打開' + KIND_LABEL[k] + '名單…', '請' + listHelp(k) + again];
  }
  function stopWait() {
    if (S.wait) { clearInterval(S.wait); S.wait = null; }
  }
  function waitFor(k) {
    S.kind = k;
    S.scope = document;
    S.store = new Map();
    S.stale = platform === 'x' && k !== 'comment' ? staleNow() : null;
    renderMode();
    where.textContent = PLATFORM_LABEL[platform] + '・' + (k === 'comment' ? '等你回到貼文' : '等你打開名單');
    css(countRow, { display: 'none' });
    showOk('');
    showNext(false);
    css(box, { display: 'none' });
    setActions([{ label: k === 'comment' ? '直接抓留言' : '名單已經打開了', primary: false, onClick: function () { S.stale = null; setKind(k); start(); } }]);
    var shown = '';
    function check() {
      if (!host.isConnected) { stopWait(); return; }
      if (ready(k)) { stopWait(); setKind(k); start(); return; }
      var t = waitText(k);
      if (t.join('|') === shown) return;
      shown = t.join('|');
      setStatus(t[0]);
      setTip(t[1]);
    }
    S.wait = setInterval(check, 500);
    check();
  }
  // A press on 留言 / 按讚 / 分享 (at the top, or under a copied result). A list that is already
  // done is shown again rather than collected again; 重新抓取 passes again = true.
  function choose(k, again) {
    if (!again && k === S.kind && (S.running || S.wait)) return;
    stopWait();
    S.running = false;
    S.run++;
    S.stale = null;
    if (!again && S.results[k]) { showResult(S.results[k]); return; }
    if (ready(k)) { setKind(k); start(); } else waitFor(k);
  }
  // A finished list: its count, summary and the copy button.
  function showResult(res) {
    S.kind = res.kind;
    S.summary = res.summary;
    renderMode();
    css(countRow, { display: 'flex' });
    countNum.textContent = String(res.n);
    setStatus(res.summary);
    setTip(res.tip);
    showOk('');
    showNext(false);
    css(box, { display: 'none' });
    var acts = [
      { label: '複製結果', primary: true, copy: true, onClick: function () { copyText(res.text, markCopied); } },
      { label: '重新抓取', primary: false, onClick: function () { choose(res.kind, true); } }
    ];
    if (res.diag) {
      acts.push({ label: '複製診斷資訊', primary: false, onClick: function () {
        copyText(res.diag, function () { showOk('✓ 已複製診斷資訊，可以直接貼給開發者。'); });
      } });
    }
    setActions(acts);
  }
  function showNext(on) {
    while (nextBox.firstChild) nextBox.removeChild(nextBox.firstChild);
    css(nextBox, { display: on ? 'block' : 'none' });
    if (!on) return;
    var left = ['comment', 'like', 'share'].filter(function (k) { return !S.results[k]; });
    if (!left.length) {
      nextBox.textContent = '留言、按讚、分享三份名單都抓好了。都貼到抽獎系統之後，記得在第 2 步勾選參加條件。';
      return;
    }
    nextBox.appendChild(document.createTextNode('貼好之後，還要抓' + left.map(function (k) { return KIND_LABEL[k]; }).join('或') + '的人，就按：'));
    var row = mk('div', { display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' });
    left.forEach(function (k) {
      var b = mk('button', btnStyle(false), '抓' + KIND_LABEL[k]);
      css(b, { fontSize: '13px', padding: '5px 12px' });
      b.addEventListener('click', function () { choose(k); });
      row.appendChild(b);
    });
    nextBox.appendChild(row);
  }

  // ---------- copy ----------
  function copyText(text, onOk) {
    function manual() {
      showOk('');
      box.value = text;
      css(box, { display: 'block' });
      box.focus();
      box.select();
      setTip('瀏覽器不讓我自動複製。下面的文字已經選好了，請按 Ctrl+C（Mac 按 Cmd+C）複製，再到抽獎系統貼上。');
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      css(ta, { position: 'fixed', top: '0', left: '0', opacity: '0', width: '1px', height: '1px' });
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      if (ok) onOk(); else manual();
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onOk, fallback);
        return;
      }
    } catch (e) { /* fall through */ }
    fallback();
  }

  // ---------- run ----------
  async function start() {
    stopWait();
    var my = ++S.run;
    delete S.results[S.kind];
    S.store = new Map();
    S.skippedOwner = new Set();
    S.lastEl = null;
    S.summary = '';
    S.notes = [];
    S.running = true;
    renderMode();
    css(countRow, { display: 'flex' });
    updateCount();
    setTip('');
    showOk('');
    showNext(false);
    css(box, { display: 'none' });
    setActions([{ label: '停止', primary: false, onClick: function () { S.running = false; } }]);
    if (S.kind === 'comment') initSkip();
    if (S.kind === 'comment' && platform === 'facebook') {
      setStatus('正在把留言排序改成「所有留言」…');
      var r = await fbAllComments(S.scope);
      if (my !== S.run) return;
      if (r === 'failed') note('沒辦法自動切換成「所有留言」。請手動把留言排序改成「所有留言」再按「重新抓取」，不然 FB 可能會藏起部分留言。');
    }
    if (S.kind === 'comment' && (platform === 'x' || platform === 'threads')) window.scrollTo(0, 0);
    setStatus(S.kind === 'comment' ? '正在展開並讀取留言，請不要關閉這個分頁…' : '正在往下捲動名單並讀取…');
    var t0 = Date.now(), idle = 0;
    while (S.running) {
      var before = S.store.size;
      harvest();
      var clicked = S.kind === 'comment' ? expand() : 0;
      var moved = scrollStep();
      await sleep(clicked ? 1400 : 800);
      if (my !== S.run) return; // replaced by another run, or the panel was closed
      if (!S.running) break;
      harvest();
      updateCount();
      // Clicking alone is not progress: a button that loads nothing must not keep the run alive.
      if (S.store.size > before || moved) idle = 0; else idle++;
      if (idle >= 7) break;
      if (Date.now() - t0 > 8 * 60 * 1000) { note('已經抓了 8 分鐘，先停在這裡。'); break; }
    }
    harvest();
    finish(my);
  }
  // A remark about this run, kept with its result.
  function note(s) {
    S.notes.push(s);
    setTip(S.notes.join('\n'));
  }
  function copyDiag() {
    copyText(diagText(), function () { showOk('✓ 已複製診斷資訊，可以直接貼給開發者。'); });
  }
  // Thumbnails are made while scrolling; wait for the ones still loading (or let the user skip them).
  function waitAvatars(people, my) {
    return new Promise(function (resolve) {
      var t0 = Date.now(), skip = false, iv = null;
      function counts() {
        var total = 0, done = 0;
        people.forEach(function (k) {
          if (!AV.src.has(k)) return;
          total++;
          if (AV.data.has(k) || AV.failed.has(k)) done++;
        });
        return { total: total, done: done };
      }
      function tick() {
        var c = counts();
        if (c.done >= c.total || skip || my !== S.run || !host.isConnected || Date.now() - t0 > 90000) {
          clearInterval(iv);
          AV.onProgress = null;
          resolve();
          return;
        }
        setStatus('正在處理頭像 ' + c.done + ' / ' + c.total + '…');
      }
      var c0 = counts();
      if (c0.done >= c0.total) { resolve(); return; }
      setActions([{ label: '略過頭像', primary: false, onClick: function () { skip = true; tick(); } }]);
      AV.onProgress = tick;
      iv = setInterval(tick, 400);
      tick();
    });
  }
  async function finish(my) {
    S.running = false;
    updateCount();
    var n = S.store.size;
    if (!n) {
      setStatus('沒有抓到資料。');
      setTip('請確認：1. 打開的是單一貼文（FB 可以點貼文上的時間打開）；2. 要抓按讚或分享，先按上面的「按讚」或「分享」，再點開那個名單視窗。還是不行的話，按「複製診斷資訊」傳給開發者。');
      setActions([
        { label: '重新抓取', primary: true, onClick: function () { choose(S.kind, true); } },
        { label: '複製診斷資訊', primary: false, onClick: copyDiag }
      ]);
      return;
    }
    var people = peopleKeys();
    await waitAvatars(people, my);
    if (my !== S.run) return;
    var avOk = people.filter(function (k) { return AV.data.has(k); }).length;
    var summary = S.kind === 'comment'
      ? '抓到 ' + n + ' 則留言，共 ' + people.length + ' 位不重複。'
      : '抓到 ' + n + ' 位' + (S.kind === 'like' ? '按讚' : '分享') + '的人。';
    if (S.skippedOwner.size) summary += '已略過貼文作者自己的 ' + S.skippedOwner.size + ' 則回覆。';
    summary += '頭像 ' + avOk + ' / ' + people.length + ' 張。';
    var text = resultText();
    try { window.__giveawayResult = text; } catch (e) { /* ignore */ }
    var tips = S.notes.slice();
    // Read without a likes / shares list open (「名單已經打開了」 on a page with none).
    if (S.kind !== 'comment' && !inDialog() && !onListPage()) tips.push('沒有找到名單視窗，結果可能把頁面上的其他人（例如留言的人）也算進去，請確認人數對不對。');
    var fewAvatars = avOk < people.length / 2;
    if (fewAvatars) tips.push('有些頭像抓不到（網站不讓其他網頁讀取圖片），抽獎系統會用名字的第一個字代替，不影響抽獎。');
    var res = { kind: S.kind, n: n, text: text, summary: summary, tip: tips.join('\n'), diag: fewAvatars ? diagText() : '' };
    S.results[S.kind] = res;
    showResult(res);
    function askToCopy() { if (my === S.run && okBox.style.display === 'none') setStatus(summary + '按「複製結果」，再到抽獎系統第 1 步貼上。'); }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText && document.hasFocus()) {
        navigator.clipboard.writeText(text).then(function () { if (my === S.run) markCopied(); }, askToCopy);
      } else askToCopy();
    } catch (e) { askToCopy(); }
  }

  // ---------- boot ----------
  if (!platform) {
    setStatus('這個工具只能在 Facebook、X 或 Threads 的貼文頁面使用。');
    css(modes, { display: 'none' });
    css(countRow, { display: 'none' });
    where.textContent = '目前網站：' + location.hostname;
    setActions([{ label: '關閉', primary: false, onClick: function () { host.remove(); } }]);
    return;
  }
  var d0 = detect();
  S.kind = d0.kind;
  S.scope = d0.scope;
  S.quotes = !!d0.quotes;
  renderMode();
  if (S.kind === 'comment' && !inDialog() && !looksLikePostPage()) {
    setStatus('這裡看起來不是單一貼文頁面。');
    setTip(platform === 'facebook'
      ? '請先點貼文上的時間，打開那一則貼文，再按一次書籤列的「抓取抽獎名單」。'
      : '請先點進那一則貼文，再按一次書籤列的「抓取抽獎名單」。');
    setActions([
      { label: '仍然抓取', primary: false, onClick: function () { start(); } },
      { label: '關閉', primary: false, onClick: function () { host.remove(); } }
    ]);
    return;
  }
  start();
})();
