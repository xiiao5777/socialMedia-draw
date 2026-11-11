// Simulated FB / X / Threads pages, shaped after each site's known markup,
// used only to exercise the collector's logic (expanding, scrolling, parsing).
const common = `<meta charset="utf-8"><style>body{font:14px sans-serif;margin:0}[role=article],article{padding:8px;border-bottom:1px solid #ddd}</style>`;

function fbComment(c) {
  const q = (p) => p.includes('?') ? '&amp;' : '?';
  const tags = (c.tags || []).map(t => ` <a href="https://www.facebook.com/${t.path}${q(t.path)}__cft__=x&amp;__tn__=-]K-R" role="link">${t.name}</a>`).join('');
  const id = c.reply ? `comment_id=${c.parent}&amp;reply_comment_id=${c.id}` : `comment_id=${c.id}`;
  const label = c.reply ? `${c.name}回覆了${c.parentName}的留言` : `${c.name}的留言`;
  return `<div role="article" aria-label="${label}">
    <a href="https://www.facebook.com/${c.path}${q(c.path)}${id}&amp;__tn__=R" role="link" aria-label="${c.name}" tabindex="-1"><svg width="32" height="32" style="width:32px;height:32px"><mask id="m-${c.id}"><circle cx="16" cy="16" r="16" fill="white"></circle></mask><g mask="url(#m-${c.id})"><image x="0" y="0" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" xlink:href="https://scontent.xx.fbcdn.net/v/t39.30808-1/${c.path.replace(/\W/g, '_')}${c.path === 'jason.tan.9' ? '_nocors' : ''}_n.jpg?stp=cp0_dst-jpg_s32x32&amp;_nc_cat=1&amp;oh=00_AbC&amp;oe=6740"></image></g></svg></a>
    <div><span><a href="https://www.facebook.com/${c.path}${q(c.path)}${id}&amp;__cft__=z" role="link"><span>${c.name}</span></a></span></div>
    <div><span lang="zh-Hant" dir="auto"><div><div dir="auto" style="text-align:start">${c.text}${tags}${c.photo ? '<div><a href="https://www.facebook.com/photo/?fbid=777"><img src="https://scontent.xx.fbcdn.net/v/t39.30808-6/photo_777_n.jpg" width="220" height="160" alt="可能是 1 張圖片"></a></div>' : ''}${c.long ? '<span class="rest" hidden> 這是被收起來的後半段</span> <div role="button" class="seemore">查看更多</div>' : ''}</div></div></span></div>
    <ul><li><div role="button">讚</div></li><li><div role="button">回覆</div></li><li><a href="https://www.facebook.com/brandpage/posts/pfbid0abc?${id}">${c.when || '1天'}</a></li></ul>
    ${c.replies ? `<div class="replies" data-for="${c.id}"></div><div role="button" class="show-replies" data-for="${c.id}"><span>查看全部 ${c.replies.length} 則回覆</span></div>` : ''}
  </div>`;
}

function fbPostPage() {
  const people = [
    ['陳小明', 'xiaoming.chen'], ['Amy Lim', 'amy.lim.123'], ['林雅婷', 'profile.php?id=100045'], ['Jason Tan', 'jason.tan.9'],
    ['黃志豪', 'zhihao.huang'], ['Siti Aisyah', 'siti.aisyah'], ['王大同', 'datong.wang'], ['Kelly Wong', 'kelly.wong.77'],
    ['張家瑋', 'jiawei.zhang'], ['李佩珊', 'peishan.li'], ['Muhammad Hafiz', 'm.hafiz'], ['吳美玲', 'meiling.wu'],
    ['Ong Wei Jie', 'weijie.ong'], ['蔡宜臻', 'yizhen.tsai'], ['Rachel Lee', 'rachel.lee.5'], ['劉建宏', 'jianhong.liu'],
    ['Nurul Huda', 'nurul.huda'], ['鄭凱文', 'kaiwen.cheng'], ['Tan Mei Ling', 'meiling.tan'], ['Daniel Chong', 'daniel.chong']
  ];
  const P = (i) => ({ name: people[i][0], path: people[i][1] });
  const comments = people.map((p, i) => ({
    id: 'C' + (i + 1), name: p[0], path: p[1],
    text: i % 5 === 3 ? '好漂亮 <img src="https://static.xx.fbcdn.net/images/emoji.php/v9/t51/1/16/1f60d.png" width="16" height="16" alt="😍">' : '我要抽！',
    tags: i % 5 === 3 ? [] : [P((i + 1) % 20), P((i + 2) % 20)],
    long: i === 4,
    photo: i === 6,
    when: ['3小時', '1天', '2天', '5分鐘', '1週', '2h'][i % 6],
    replies: i === 1 ? [{ id: 'R1', name: people[2][0], path: people[2][1], text: '我也要抽', tags: [P(0)] }, { id: 'R2', name: '品牌粉專', path: 'brandpage', text: '謝謝參加！' }] : null
  }));
  // first 6 visible, 2 hidden until "所有留言", the rest behind "查看更多留言"
  const data = JSON.stringify(comments);
  return `<!doctype html><html><head>${common}<title>FB post</title></head><body>
  <div role="banner"><a href="https://www.facebook.com/me.user">我自己</a></div>
  <div role="main"><div role="article">
    <a href="https://www.facebook.com/brandpage" role="link"><span>品牌粉專</span></a>
    <div dir="auto">年終抽獎！留言「我要抽」並標記 2 位朋友</div>
    <div><span role="button" tabindex="0"><span>22 則留言</span></span> <span>5 次分享</span></div>
    <div role="button" id="sort"><span>最相關</span></div>
    <div id="comments"></div>
    <div role="button" id="more"><span>查看更多留言</span></div>
    <div><div contenteditable="true" role="textbox" aria-label="留言……"></div></div>
  </div></div>
  <script>
    const comments = ${data};
    window.__fbComment = ${fbComment.toString()};
    let shown = 0, sortAll = false;
    const list = document.getElementById('comments');
    const hidden = new Set(['C7', 'C8']);
    function render(n) {
      list.innerHTML = '';
      let count = 0;
      for (const c of comments) {
        if (count >= n) break;
        if (!sortAll && hidden.has(c.id)) continue;
        list.insertAdjacentHTML('beforeend', __fbComment(c));
        count++;
      }
      shown = count;
    }
    render(6);
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[role=button], [role=menuitem]');
      if (!t) return;
      if (t.id === 'more') {
        setTimeout(() => {
          render(shown + 5);
          const total = sortAll ? comments.length : comments.length - hidden.size;
          if (shown >= total) t.remove();
        }, 400);
      } else if (t.id === 'sort') {
        document.body.insertAdjacentHTML('beforeend', '<div role="menu" id="menu"><div role="menuitem"><span>最相關</span><span>先顯示朋友的留言</span></div><div role="menuitem"><span>所有留言</span><span>顯示所有留言，包括可能是垃圾訊息的內容。</span></div></div>');
      } else if (t.getAttribute('role') === 'menuitem') {
        if (t.textContent.includes('所有留言')) { sortAll = true; document.querySelector('#sort span').textContent = '所有留言'; render(shown); }
        document.getElementById('menu').remove();
      } else if (t.classList.contains('show-replies')) {
        const c = comments.find(x => x.id === t.dataset.for);
        setTimeout(() => {
          const box = document.querySelector('.replies[data-for="' + c.id + '"]');
          box.innerHTML = c.replies.map(r => __fbComment(Object.assign({}, r, { reply: true, parent: c.id, parentName: c.name }))).join('');
          t.remove();
        }, 300);
      } else if (t.classList.contains('seemore')) {
        t.parentElement.querySelector('.rest').hidden = false;
        t.remove();
      }
    });
  </script></body></html>`;
}

function fbReactionsPage() {
  return `<!doctype html><html><head>${common}</head><body>
  <div role="main"><div role="article"><span>貼文</span></div></div>
  <div role="dialog" aria-labelledby="dlgtitle">
    <h2 id="dlgtitle" style="font-size:1px">　</h2>
    <div role="tablist"><div role="tab">全部 35</div><div role="tab">讚 30</div><div role="tab">大心 5</div></div>
    <div id="scroller" style="height:240px;overflow-y:auto"><div id="rows"></div></div>
  </div>
  <script>
    let n = 0;
    function more(k) {
      const rows = document.getElementById('rows');
      for (let i = 0; i < k && n < 35; i++, n++) {
        const path = n % 7 === 0 ? 'profile.php?id=9000' + n : 'liker.' + n;
        rows.insertAdjacentHTML('beforeend', '<div style="height:48px"><a href="https://www.facebook.com/' + path + '" aria-label="大頭貼照" tabindex="-1"><svg width="36" height="36" style="width:36px;height:36px"><image width="36" height="36" xlink:href="https://scontent.xx.fbcdn.net/v/t39.30808-1/liker_' + n + '_n.jpg?stp=cp0_dst-jpg_s40x40&amp;oh=1"></image></svg><img src="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E" width="16" height="16"></a> <a href="https://www.facebook.com/' + path + '"><span>按讚者 ' + n + '</span></a> <div role="button">加朋友</div></div>');
      }
    }
    more(10);
    document.getElementById('scroller').addEventListener('scroll', (e) => {
      const s = e.target;
      if (s.scrollTop + s.clientHeight > s.scrollHeight - 60) setTimeout(() => more(10), 300);
    });
  </script></body></html>`;
}

function fbSharesPage() {
  const items = Array.from({ length: 6 }, (_, i) => `<div role="article"><a href="https://www.facebook.com/sharer.${i}"><span>分享者 ${i}</span></a><div dir="auto">分享給 <a href="https://www.facebook.com/friend.of.${i}">朋友 ${i}</a> 看</div></div>`).join('');
  return `<!doctype html><html><head>${common}</head><body>
  <div role="dialog" aria-label="分享這則貼文的用戶"><div style="height:300px;overflow-y:auto">${items}</div></div></body></html>`;
}

// A post where the likes and shares lists open as pop-ups from the post, like on Facebook:
// for the guided flow (留言 first, then 按讚 / 分享 pressed on the panel before the list is open).
function fbFlowPage() {
  const commenters = [['陳小明', 'xiaoming.chen'], ['Amy Lim', 'amy.lim.123'], ['林雅婷', 'profile.php?id=100045'], ['Jason Tan', 'jason.tan.9']];
  const comments = commenters.map((p, i) => fbComment({ id: 'F' + (i + 1), name: p[0], path: p[1], text: '我要抽！' })).join('');
  const likers = [['陳小明', 'xiaoming.chen'], ['Amy Lim', 'amy.lim.123']].concat(Array.from({ length: 6 }, (_, i) => ['按讚粉絲 ' + i, 'fan.like.' + i]));
  const likeRows = likers.map(p => `<div style="height:44px"><a href="https://www.facebook.com/${p[1]}"><span>${p[0]}</span></a> <div role="button">加朋友</div></div>`).join('');
  const shareRows = [['陳小明', 'xiaoming.chen'], ['分享粉絲 1', 'fan.share.1'], ['分享粉絲 2', 'fan.share.2']]
    .map(p => `<div role="article"><a href="https://www.facebook.com/${p[1]}"><span>${p[0]}</span></a><div dir="auto">分享了一則貼文</div></div>`).join('');
  const dlg = 'position:fixed;top:60px;left:120px;width:420px;background:#fff;border:1px solid #999;padding:8px';
  return `<!doctype html><html><head>${common}</head><body>
  <div role="main"><div role="article">
    <a href="https://www.facebook.com/brandpage" role="link"><span>品牌粉專</span></a>
    <div dir="auto">抽獎！留言、按讚、分享</div>
    <div role="button" style="display:inline-block;padding:4px"><span>4 則留言</span></div>
    <div role="button" id="reactions" style="display:inline-block;padding:4px"><span>👍❤️</span> <span>8</span></div>
    <div role="button" id="shares" style="display:inline-block;padding:4px"><span>3 次分享</span></div>
    <div id="comments">${comments}</div>
    <div><div contenteditable="true" role="textbox" aria-label="留言……"></div></div>
  </div></div>
  <script>
    const reactions = ${JSON.stringify(`<div role="dialog" aria-labelledby="rt" style="${dlg}"><h2 id="rt" style="font-size:1px">　</h2><div role="button" aria-label="關閉">×</div><div role="tablist"><div role="tab">全部 8</div><div role="tab">讚 6</div><div role="tab">大心 2</div></div><div style="height:240px;overflow-y:auto">${likeRows}</div></div>`)};
    const shares = ${JSON.stringify(`<div role="dialog" aria-label="分享這則貼文的用戶" style="${dlg}"><div role="button" aria-label="關閉">×</div><div style="height:240px;overflow-y:auto">${shareRows}</div></div>`)};
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[role=button]');
      if (!t) return;
      if (t.id === 'reactions') setTimeout(() => document.body.insertAdjacentHTML('beforeend', reactions), 200);
      else if (t.id === 'shares') setTimeout(() => document.body.insertAdjacentHTML('beforeend', shares), 200);
      else if (t.getAttribute('aria-label') === '關閉') t.closest('[role=dialog]').remove();
    });
  </script></body></html>`;
}

// The post says 5 comments and has them all at once, above a very long page: the run stops when it
// has the 5, instead of scrolling to the end of the page first.
function fbCountPage() {
  const c = [['陳小明', 'xiaoming.chen'], ['Amy Lim', 'amy.lim.123'], ['林雅婷', 'profile.php?id=100045'], ['Kelly Wong', 'kelly.wong.77'], ['張家瑋', 'jiawei.zhang']]
    .map((p, i) => fbComment({ id: 'K' + (i + 1), name: p[0], path: p[1], text: '我要抽！' })).join('');
  return `<!doctype html><html><head>${common}</head><body>
  <div role="main"><div role="article">
    <a href="https://www.facebook.com/brandpage" role="link"><span>品牌粉專</span></a>
    <div dir="auto">抽獎！</div>
    <div role="button"><span>5 則留言</span></div>
    <div id="comments">${c}</div>
    <div><div contenteditable="true" role="textbox" aria-label="留言……"></div></div>
  </div></div>
  <div style="height:40000px"></div>
  </body></html>`;
}

// The post says 12 comments; 8 show, and the other 4 only come once window.__unlock() is called
// (by then the first run has ended short): 繼續抓 picks them up and keeps the first 8.
function fbMorePage() {
  const people = Array.from({ length: 12 }, (_, i) => ['粉絲 ' + (i + 1), 'fan.more.' + (i + 1)]);
  const all = people.map((p, i) => fbComment({ id: 'M' + (i + 1), name: p[0], path: p[1], text: '我要抽！' }));
  return `<!doctype html><html><head>${common}</head><body>
  <div role="main"><div role="article">
    <a href="https://www.facebook.com/brandpage" role="link"><span>品牌粉專</span></a>
    <div dir="auto">抽獎！</div>
    <div role="button"><span>12 則留言</span></div>
    <div id="comments">${all.slice(0, 8).join('')}</div>
    <div id="more-slot"></div>
    <div><div contenteditable="true" role="textbox" aria-label="留言……"></div></div>
  </div></div>
  <script>
    const rest = ${JSON.stringify(all.slice(8).join(''))};
    window.__unlock = () => { document.getElementById('more-slot').innerHTML = '<div role="button" id="more"><span>查看更多留言</span></div>'; };
    document.addEventListener('click', (e) => {
      const t = e.target.closest('#more');
      if (t) setTimeout(() => { document.getElementById('comments').insertAdjacentHTML('beforeend', rest); t.remove(); }, 300);
    });
  </script></body></html>`;
}

// A page on another site that tries to hand the draw page a list, the way the 抓取工具 does.
function evilPage() {
  return `<!doctype html><html><head>${common}</head><body><p>Not the collector</p></body></html>`;
}

function xArticle(t) {
  return `<article data-testid="tweet" role="article" tabindex="0">
    <div data-testid="Tweet-User-Avatar"><a href="/${t.handle}" role="link"><img alt="" width="40" height="40" src="https://pbs.twimg.com/profile_images/1${t.id}/${t.handle}_normal.jpg"></a></div>
    <div data-testid="User-Name"><a href="/${t.handle}" role="link"><span>${t.name}</span></a><a href="/${t.handle}" role="link" tabindex="-1"><span>@${t.handle}</span></a><a href="/${t.handle}/status/${t.id}" role="link"><time datetime="${t.time || '2026-11-10T10:00:00.000Z'}">${t.focal ? '10:00 AM · Nov 10, 2026' : '2h'}</time></a></div>
    <div data-testid="tweetText"><span>${t.text}</span>${(t.tags || []).map(h => ` <a href="/${h}" role="link">@${h}</a>`).join('')}</div>
    <div role="group"${t.stats ? ` aria-label="${t.stats}"` : ''}><div role="button" aria-label="3 replies"><span>3</span></div></div>
  </article>`;
}

function xPostPage() {
  const replies = Array.from({ length: 30 }, (_, i) => ({
    id: String(1000 + i), handle: 'user_' + i, name: 'User ' + i, time: new Date(Date.UTC(2026, 10, 10, 11 + i)).toISOString(),
    text: i % 6 === 5 ? 'nice' : '我要抽', tags: i % 6 === 5 ? [] : ['friend_' + i, 'friend_' + (i + 1)]
  }));
  replies.splice(4, 0, { id: '999', handle: 'brand', name: 'Brand', text: '謝謝大家', tags: [] });
  const hiddenMore = Array.from({ length: 3 }, (_, i) => ({ id: String(2000 + i), handle: 'late_' + i, name: 'Late ' + i, text: '我要抽', tags: ['a', 'b'] }));
  return `<!doctype html><html><head>${common}</head><body>
  <div data-testid="sidebarColumn"><a href="/trending_guy">Trending guy</a></div>
  <main><div data-testid="primaryColumn">
    <div id="feed"></div>
    <div id="spacer"></div>
  </div></main>
  <script>
    window.__xArticle = ${xArticle.toString()};
    const parent = { id: '100', handle: 'someone', name: 'Someone', text: 'parent post' };
    const focal = { id: '111', handle: 'brand', name: 'Brand', text: '抽獎！回覆我要抽並標記 2 位朋友', focal: true, stats: '34 replies, 12 reposts, 25 likes, 3 bookmarks, 4512 views' };
    const replies = ${JSON.stringify(replies)};
    const hiddenMore = ${JSON.stringify(hiddenMore)};
    // X folds replies away behind buttons, one after another (its English one is long): one reply each
    const folds = ['Show more replies', 'Show additional replies, including those that may contain offensive content', '顯示可能是垃圾訊息的回覆'];
    let loaded = 8, start = 0, extra = 0;
    const feed = document.getElementById('feed');
    function draw() {
      // virtualized: keep at most 10 replies in the DOM, earlier ones become a spacer
      const all = replies.slice(0, loaded).concat(hiddenMore.slice(0, extra));
      start = Math.max(0, all.length - 10);
      let html = start === 0 ? __xArticle(parent) + __xArticle(focal) : '<div style="height:' + (start * 120) + 'px"></div>';
      html += all.slice(start).map(__xArticle).join('');
      if (loaded >= replies.length && extra < folds.length) html += '<div role="button" id="showmore"><span>' + folds[extra] + '</span></div>';
      feed.innerHTML = html;
      document.querySelectorAll('article').forEach(a => a.style.height = '110px');
    }
    draw();
    window.addEventListener('scroll', () => {
      if (window.scrollY + innerHeight > document.body.scrollHeight - 200 && loaded < replies.length) {
        setTimeout(() => { loaded = Math.min(replies.length, loaded + 6); draw(); }, 250);
      }
    });
    document.addEventListener('click', (e) => {
      if (e.target.closest('#showmore')) setTimeout(() => { extra++; draw(); }, 300);
    });
  </script></body></html>`;
}

// X switches to the likes list without loading a new page (the address changes to /likes).
function xFlowPage() {
  return `<!doctype html><html><head>${common}</head><body>
  <main><div data-testid="primaryColumn"><div id="feed"></div></div></main>
  <script>
    window.__xArticle = ${xArticle.toString()};
    const focal = { id: '222', handle: 'brand', name: 'Brand', text: '抽獎！回覆、按讚、轉發', focal: true, stats: '3 replies, 0 reposts, 5 likes, 0 bookmarks, 80 views' };
    const replies = [1, 2, 3].map(i => ({ id: String(3000 + i), handle: 'fan_' + i, name: 'Fan ' + i, text: '我要抽' }));
    const feed = document.getElementById('feed');
    function post() { feed.innerHTML = __xArticle(focal) + '<a href="/brand/status/222/likes" id="likes-link" role="link">5 Likes</a>' + replies.map(__xArticle).join(''); }
    function likes() {
      feed.innerHTML = '<div aria-label="Timeline: Liked by">' + [0, 1, 2, 3, 4].map(i => '<div data-testid="UserCell" style="height:80px"><a href="/liker_' + i + '"><span>Liker ' + i + '</span></a><a href="/liker_' + i + '" tabindex="-1"><span>@liker_' + i + '</span></a><button>Follow</button></div>').join('') + '</div>';
    }
    post();
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#likes-link')) return;
      e.preventDefault();
      history.pushState({}, '', '/brand/status/222/likes');
      setTimeout(likes, 300);
    });
  </script></body></html>`;
}

function xLikesPage() {
  return `<!doctype html><html><head>${common}</head><body>
  <div data-testid="sidebarColumn"><a href="/who_to_follow">Who</a></div>
  <div data-testid="primaryColumn"><div aria-label="Timeline: Liked by" id="list"></div></div>
  <script>
    let n = 0;
    function more(k) {
      const list = document.getElementById('list');
      for (let i = 0; i < k && n < 25; i++, n++) {
        list.insertAdjacentHTML('beforeend', '<div data-testid="UserCell" style="height:80px"><a href="/liker_' + n + '"><img width="40" height="40" src="https://pbs.twimg.com/profile_images/7' + n + '/liker_' + n + '_normal.jpg"></a><a href="/liker_' + n + '"><span>Liker ' + n + '</span></a><a href="/liker_' + n + '" tabindex="-1"><span>@liker_' + n + '</span></a><div dir="auto">bio mentions <a href="/other_' + n + '">@other_' + n + '</a></div><button>Follow</button></div>');
      }
    }
    more(10);
    window.addEventListener('scroll', () => {
      if (window.scrollY + innerHeight > document.body.scrollHeight - 150) setTimeout(() => more(8), 200);
    });
  </script></body></html>`;
}

function thPost(p) {
  return `<div data-pressable-container="true" style="min-height:120px;padding:8px;border-bottom:1px solid #ddd">
    <div><a href="/@${p.user}" role="link" tabindex="-1"><img width="36" height="36" alt="${p.user}的大頭貼照" src="https://scontent-tpe1-1.cdninstagram.com/v/t51.2885-19/${p.user}_n.jpg?stp=dst-jpg_s150x150&amp;_nc_ht=x"></a></div>
    <div><span><a href="/@${p.user}" role="link"><span dir="auto"><span>${p.user}</span></span></a></span>
      <span><a href="/@${p.user}/post/${p.id}" role="link"><time datetime="${p.time || '2026-11-10T08:00:00.000Z'}" title="2026年11月10日">2小時</time></a></span>
      ${p.author ? '<span dir="auto">作者</span>' : ''}</div>
    <div><span dir="auto"><span>${p.text}</span>${(p.tags || []).map(t => ` <a href="/@${t}" role="link"><span dir="auto">@${t}</span></a>`).join('')}</span></div>
    <div><div role="button"><svg aria-label="讚" width="18" height="18"></svg><span dir="auto">${p.likes || 12}</span></div><div role="button"><svg aria-label="回覆" width="18" height="18"></svg><span dir="auto">${p.replies || 3}</span></div></div>
  </div>`;
}

function thPostPage() {
  const replies = Array.from({ length: 16 }, (_, i) => ({ id: 'R' + i, user: 'th.user' + i, time: new Date(Date.UTC(2026, 10, 10, 8, 30 * (i + 1))).toISOString(), text: i % 4 === 3 ? '好看' : '我要抽', tags: i % 4 === 3 ? [] : ['pal_' + i, 'pal_' + (i + 2)] }));
  replies.splice(2, 0, { id: 'R99', user: 'brandtw', text: '感謝參加', author: true });
  return `<!doctype html><html><head>${common}</head><body>
  <div id="feed"></div>
  <script>
    window.__thPost = ${thPost.toString()};
    const main = { id: 'DAbc123', user: 'brandtw', text: '雙十一抽獎！留言並標記朋友', author: true, replies: 17 };
    const replies = ${JSON.stringify(replies)};
    let loaded = 6;
    function draw() { document.getElementById('feed').innerHTML = __thPost(main) + replies.slice(0, loaded).map(__thPost).join(''); }
    draw();
    window.addEventListener('scroll', () => {
      if (window.scrollY + innerHeight > document.body.scrollHeight - 200 && loaded < replies.length) setTimeout(() => { loaded += 5; draw(); }, 250);
    });
  </script></body></html>`;
}

// The author answers most replies. The post's number (12) counts the replies to the post only, not
// the author's answers to them, and the last replies load after a pause.
function thOwnerPage() {
  const items = [];
  for (let i = 0; i < 12; i++) {
    items.push({ id: 'Q' + i, user: 'fan.' + i, text: '我要抽' });
    if (i < 10) items.push({ id: 'A' + i, user: 'brandtw', text: '已登記', author: true });
  }
  return `<!doctype html><html><head>${common}</head><body>
  <div id="feed"></div>
  <script>
    window.__thPost = ${thPost.toString()};
    const main = { id: 'DOwner1', user: 'brandtw', text: '留言抽獎！', author: true, replies: 12 };
    const items = ${JSON.stringify(items)};
    let loaded = 6, waiting = false;
    function draw() { document.getElementById('feed').innerHTML = __thPost(main) + items.slice(0, loaded).map(__thPost).join(''); }
    draw();
    window.addEventListener('scroll', () => {
      if (waiting || loaded >= items.length || window.scrollY + innerHeight <= document.body.scrollHeight - 200) return;
      waiting = true;
      setTimeout(() => { loaded = Math.min(items.length, loaded + 5); waiting = false; draw(); }, loaded >= 16 ? 4000 : 250);
    });
  </script></body></html>`;
}

function thLikesPage() {
  const rows = Array.from({ length: 12 }, (_, i) => `<div style="height:56px"><a href="/@fan_${i}" tabindex="-1"><img width="30" height="30" src="https://scontent-tpe1-1.cdninstagram.com/v/t51.2885-19/fan_${i}_nocors_n.jpg"></a> <a href="/@fan_${i}"><span dir="auto">fan_${i}</span></a> <span>粉絲 ${i}</span> <div role="button">追蹤</div></div>`).join('');
  return `<!doctype html><html><head>${common}</head><body>
  <div id="feed">${thPost({ id: 'DAbc123', user: 'brandtw', text: '雙十一抽獎', author: true })}</div>
  <div role="dialog" aria-label="讚"><div style="height:300px;overflow-y:auto">${rows}</div></div></body></html>`;
}

function otherPage() {
  return `<!doctype html><html><head>${common}</head><body><p>Not a social site</p></body></html>`;
}

module.exports = {
  'https://www.facebook.com/brandpage/posts/pfbid0abc': fbPostPage,
  'https://www.facebook.com/brandpage/posts/pfbid0likes': fbReactionsPage,
  'https://www.facebook.com/brandpage/posts/pfbid0shares': fbSharesPage,
  'https://www.facebook.com/brandpage/posts/pfbid0flow': fbFlowPage,
  'https://www.facebook.com/brandpage/posts/pfbid0count': fbCountPage,
  'https://www.facebook.com/brandpage/posts/pfbid0more': fbMorePage,
  'https://evil.example/': evilPage,
  'https://x.com/brand/status/111': xPostPage,
  'https://x.com/brand/status/222': xFlowPage,
  'https://x.com/brand/status/111/likes': xLikesPage,
  'https://www.threads.com/@brandtw/post/DAbc123': thPostPage,
  'https://www.threads.com/@brandtw/post/DAbc123/likes': thLikesPage,
  'https://www.threads.com/@brandtw/post/DOwner1': thOwnerPage,
  'https://example.com/': otherPage
};
