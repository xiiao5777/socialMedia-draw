// Builds the bookmarklet from src/collector.js and writes index.html from src/index.template.html.
//   node build.js          build index.html
//   node build.js --check  exit 1 if index.html is out of date (nothing is written)
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

// Where GitHub Pages serves the site. The bookmarklet links back to draw.html here,
// so change this (and rebuild) if the repository is renamed or moved.
const SITE_URL = 'https://xiiao5777.github.io/socialMedia-draw/';
const REPO_URL = 'https://github.com/xiiao5777/socialMedia-draw';

const root = __dirname;
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const src = read('src/collector.js');
const version = (src.match(/var VERSION = '([^']+)'/) || [])[1];
const drawVersion = (read('draw.html').match(/var COLLECTOR_VERSION = '([^']+)'/) || [])[1];
if (!version) throw new Error('src/collector.js: VERSION not found');
if (drawVersion !== version) {
  throw new Error('draw.html COLLECTOR_VERSION is ' + drawVersion + ' but src/collector.js is ' + version +
    ': update both, so the draw page can tell people with an older bookmark to reinstall');
}
if (src.split("'__DRAW_URL__'").length !== 2) throw new Error('src/collector.js: expected one __DRAW_URL__ placeholder');

const code = esbuild.transformSync(src.replace("'__DRAW_URL__'", JSON.stringify(SITE_URL + 'draw.html')), {
  minify: true, target: 'es2017', charset: 'utf8', legalComments: 'none'
}).code.trim().replace(/;$/, '');
const bookmarklet = 'javascript:' + encodeURIComponent('void ' + code + ';');
if (/["<>&]/.test(bookmarklet)) throw new Error('bookmarklet has characters unsafe for an HTML attribute');
// Firefox stops accepting bookmark addresses around 64K characters.
if (bookmarklet.length > 64000) throw new Error('bookmarklet is ' + bookmarklet.length + ' characters, over the 64K limit');

const fill = (tpl) => tpl
  .split('__BOOKMARKLET__').join(bookmarklet)
  .split('__VERSION__').join(version)
  .split('__SITE_URL__').join(SITE_URL)
  .split('__REPO_URL__').join(REPO_URL);
const page = fill(read('src/index.template.html'));
if (/__[A-Z_]+__/.test(page)) throw new Error('index.html: unfilled placeholder ' + page.match(/__[A-Z_]+__/)[0]);

const out = path.join(root, 'index.html');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (current !== page) {
    console.error('index.html is out of date: run `npm run build` and commit the result');
    process.exit(1);
  }
  console.log('index.html is up to date (collector v' + version + ')');
} else {
  fs.writeFileSync(out, page);
  console.log('collector v' + version + ' | bookmarklet ' + bookmarklet.length + ' chars | index.html ' + page.length + ' chars');
}
