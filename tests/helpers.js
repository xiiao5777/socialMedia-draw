// Shared test helpers: serve the repository as if it were the GitHub Pages site, read the built
// bookmarklet from index.html, and count PASS / FAIL lines.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const SITE = fs.readFileSync(path.join(ROOT, 'build.js'), 'utf8').match(/const SITE_URL = '([^']+)'/)[1];
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png' };

// Answers a request for the Pages site from the files on disk. Returns false for other hosts.
function serveSiteFile(route) {
  const url = route.request().url();
  if (!url.startsWith(SITE)) return false;
  let rel = decodeURIComponent(url.slice(SITE.length).replace(/[?#].*$/, ''));
  if (!rel || rel.endsWith('/')) rel += 'index.html';
  const file = path.resolve(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' });
  } else {
    route.fulfill({ status: 200, contentType: TYPES[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
  }
  return true;
}

// Web fonts are not fetched in tests: an empty stylesheet, so the pages use system fonts.
function serveNoFonts(route) {
  if (!/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(route.request().url())) return false;
  route.fulfill({ status: 200, contentType: 'text/css', body: '' });
  return true;
}

// The site, with every other request refused.
async function serveSite(ctx) {
  await ctx.route('**/*', (route) => {
    if (!serveSiteFile(route) && !serveNoFonts(route)) route.fulfill({ status: 404, body: '' });
  });
}

// A UTF-8 locale, so downloads keep their Chinese file names as they do on people's computers.
function launch() {
  return chromium.launch({ env: Object.assign({}, process.env, { LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }) });
}

// The bookmarklet exactly as the homepage hands it out.
function bookmarklet() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/id="bookmarklet" href="(javascript:[^"]+)"/);
  if (!m) throw new Error('index.html has no bookmarklet: run `npm run build` first');
  return { href: m[1], code: decodeURIComponent(m[1].slice('javascript:'.length)) };
}

function version() {
  return fs.readFileSync(path.join(ROOT, 'src/collector.js'), 'utf8').match(/var VERSION = '([^']+)'/)[1];
}

let failures = 0;
function check(cond, msg) {
  console.log((cond ? 'PASS ' : 'FAIL ') + msg);
  if (!cond) failures++;
}
function done() {
  console.log(failures ? failures + ' FAILURES' : 'ALL PASSED');
  process.exitCode = failures ? 1 : 0;
}

// A real paste into a text box: what the browser fires when someone presses Ctrl+V.
function pasteInto(page, sel, text) {
  return page.evaluate(([sel, text]) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    const ta = document.querySelector(sel);
    const fold = ta.closest('details');
    if (fold) fold.open = true;
    ta.focus();
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    ta.dispatchEvent(ev);
    return ev.defaultPrevented;
  }, [sel, text]);
}

module.exports = { ROOT, SITE, OUT, launch, serveSite, serveSiteFile, serveNoFonts, bookmarklet, version, check, done, pasteInto };
