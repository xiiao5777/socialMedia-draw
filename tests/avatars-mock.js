// Tiny PNG avatars for the simulated CDNs. Each picture is one solid colour derived from its
// address, so a test can tell which picture ended up in the result.
const zlib = require('zlib');
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xFFFFFFFF; for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function colorKey(url) { return String(url).replace(/[?#].*$/, '').replace(/_(normal|bigger)(\.\w+)$/, '$2'); }
function colorOf(url) {
  let h = 2166136261;
  for (const ch of colorKey(url)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return [40 + (h & 0x7F), 40 + ((h >>> 8) & 0x7F), 40 + ((h >>> 16) & 0x7F)];
}
function png(url, size = 96) {
  const [r, g, b] = colorOf(url);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) { row[1 + x * 3] = r; row[2 + x * 3] = g; row[3 + x * 3] = b; }
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// Route handler part for avatar CDNs. Returns true when it answered the request.
function serveImage(route, log) {
  const full = route.request().url();
  const u = full.replace(/[?#].*$/, '');
  if (!/^https:\/\/(scontent[^/]*\.(fbcdn\.net|cdninstagram\.com)|pbs\.twimg\.com|static\.xx\.fbcdn\.net)\//.test(u)) return false;
  const origin = route.request().headers()['origin'] || '';
  if (log) log.push({ url: u, cors: !!origin });
  if (/_bigger\./.test(u) && /\/user_3_/.test(u)) { route.fulfill({ status: 404, body: '' }); return true; }
  // Playwright's fulfill() skips the browser's CORS check, so a server without CORS headers is
  // simulated by failing the cross-origin reads (they carry an Origin header); the page's own
  // <img> loads still work, as on the real sites.
  if (/_nocors/.test(u) && origin) { route.abort('failed'); return true; }
  route.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: png(u, /static\.xx/.test(u) ? 16 : 96) });
  return true;
}
module.exports = { png, colorOf, serveImage };
