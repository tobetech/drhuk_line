const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.QIMEN_LICENSE_KEY = 'TEST-KEY';
process.env.QIMEN_WEB_ENABLED = 'true';
process.env.QIMEN_PRICE_THB = '19';
process.env.QIMEN_NOTIFY_SECRET = 'shared-secret';
process.env.QIMEN_WEB_HOST = 'qimen.example.com';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'web-'));
const origErr = console.error; console.error = () => {};

const app = require('./index');

const READING = {
  ai_ok: true, reading: 'คำแนะนำ <b>ทดสอบ</b>',
  chart: { time: { valid_from: '2026-11-06 11:00', valid_until: '2026-11-06 13:00' },
    palaces: Object.fromEntries('巽離坤震中兌艮坎乾'.split('').map((n) => [n, n === '中' ? { direction: 'C' } : { door: '開', star: '芮', god: '虎', direction: 'S' }])) },
  directions: { best: { direction_th: 'ทิศใต้', door: '開', palace: '離' }, avoid: { direction_th: 'ทิศเหนือ', door: '死', palace: '坎' } },
};
const g = { n: 0, paid: new Set(), failReading: false, readings: 0, sales: 0 };
const jr = (s, b) => ({ ok: s < 400, status: s, json: async () => b });
app.set('qimenFetch', async (url) => {
  if (url.endsWith('/v1/qr-payment/create')) { g.n += 1; return jr(200, { order_id: `qimen17000000${String(g.n).padStart(2, '0')}abcdef`, qr_display: 'PAYLOAD-' + g.n, amount: 19 }); }
  if (url.includes('/v1/qr-payment/status/')) { const id = decodeURIComponent(url.split('/status/')[1].split('?')[0]); return jr(200, { status: g.paid.has(id) ? 'paid' : 'waiting' }); }
  if (url.endsWith('/v1/line-reading')) { g.readings += 1; return g.failReading ? jr(500, { error: 'ai down' }) : jr(200, READING); }
  if (url.endsWith('/v1/log-transaction')) { g.sales += 1; return jr(200, { ok: true }); }
  throw new Error('unexpected ' + url);
});

const server = http.createServer(app);
function req(method, p, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ port: server.address().port, path: p, method, headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const buf = Buffer.concat(chunks); let json = null; try { json = JSON.parse(buf.toString()); } catch (_) { /* ไม่ใช่ JSON */ } resolve({ status: res.statusCode, json, buf, headers: res.headers }); });
    });
    r.on('error', reject); if (body) r.write(typeof body === 'string' ? body : JSON.stringify(body)); r.end();
  });
}
const notify = (oid) => {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = crypto.createHmac('sha256', 'shared-secret').update(`${ts}.${oid}`).digest('hex');
  return req('POST', '/internal/payment-notify', { ts, order_id: oid }, { 'X-Notify-Signature': sig });
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  // หน้าเว็บ: ที่ /qimen และที่รากของโดเมนเว็บ มี CSP
  const page = await req('GET', '/qimen');
  assert.strictEqual(page.status, 200);
  assert.ok(page.headers['content-security-policy'].includes("script-src 'self'"));
  assert.ok(page.buf.toString().includes('ฤกษ์ยามฉีเหมิน'));
  assert.strictEqual((await req('GET', '/', null, { Host: 'qimen.example.com' })).headers['content-type'].includes('html'), true);
  assert.ok((await req('GET', '/', null, { Host: 'line.example.com' })).buf.toString().includes('running'));
  assert.strictEqual((await req('GET', '/qimen/app.js')).status, 200);

  const cfg = await req('GET', '/api/qimen/config');
  assert.strictEqual(cfg.json.price, 19); assert.strictEqual(cfg.json.topics.length, 6);

  // สร้างออเดอร์
  assert.strictEqual((await req('POST', '/api/qimen/order', { topic: 'hack' })).status, 400);
  const o = await req('POST', '/api/qimen/order', { topic: 'money' }, { 'X-Forwarded-For': '1.1.1.1' });
  assert.strictEqual(o.status, 200);
  const tok = o.json.token;
  assert.ok(/^[0-9a-f]{48}$/.test(tok) && o.json.amount === 19 && !JSON.stringify(o.json).includes('PAYLOAD'));
  const png = await req('GET', `/api/qimen/qr/${tok}.png`);
  assert.strictEqual(png.status, 200); assert.strictEqual(png.buf.slice(1, 4).toString(), 'PNG');
  assert.strictEqual((await req('GET', '/api/qimen/qr/' + 'a'.repeat(48) + '.png')).status, 404);
  assert.strictEqual((await req('GET', '/api/qimen/order/' + 'a'.repeat(48))).status, 404);
  assert.strictEqual((await req('GET', '/api/qimen/order/bad')).status, 404);

  // ยังไม่จ่าย -> waiting
  let st = await req('GET', `/api/qimen/order/${tok}`);
  assert.strictEqual(st.json.status, 'waiting');
  // จ่ายแล้ว แต่ยังอยู่ในช่วงหน่วง 10 วินาที: poll ไม่ถาม Ksher ซ้ำ จึงยัง waiting; webhook ข้ามช่วงหน่วงได้
  g.paid.add('qimen1700000001abcdef');
  assert.strictEqual((await req('GET', `/api/qimen/order/${tok}`)).json.status, 'waiting');
  assert.strictEqual((await notify('qimen1700000001abcdef')).json.result, 'done');
  st = await req('GET', `/api/qimen/order/${tok}`);
  assert.strictEqual(st.json.status, 'done');
  assert.strictEqual(st.json.result.topic, 'การเงิน');
  assert.strictEqual(st.json.result.grid.length, 3);
  assert.strictEqual(st.json.result.grid[0][1].kind, 'best');
  assert.strictEqual(st.json.result.grid[2][1].kind, 'avoid');
  assert.ok(st.json.result.reading.includes('<b>ทดสอบ</b>'), 'ข้อความส่งเป็นข้อความล้วน ฝั่งเว็บใช้ textContent');
  // สัญญาณซ้ำ/โพลซ้ำ: ไม่สร้างผลใหม่ ไม่นับยอดขายซ้ำ
  await notify('qimen1700000001abcdef'); await req('GET', `/api/qimen/order/${tok}`);
  assert.strictEqual(g.readings, 1); assert.strictEqual(g.sales, 1);
  assert.strictEqual((await req('GET', `/api/qimen/qr/${tok}.png`)).status, 404, 'จ่ายแล้วไม่เสิร์ฟ QR อีก');
  // order id ที่ไม่ใช่ของเว็บ ยังตกไปทางสายบอท LINE (unknown)
  assert.strictEqual((await notify('qimen1700000099abcdef')).json.result, 'unknown');

  // จ่ายแล้วแต่ AI ล้มเหลว: ไม่หายเงียบ ลองใหม่ได้ และสุดท้ายแจ้ง failed พร้อมรหัสอ้างอิง
  g.failReading = true;
  const o2 = await req('POST', '/api/qimen/order', { topic: 'love' }, { 'X-Forwarded-For': '2.2.2.2' });
  g.paid.add('qimen1700000002abcdef');
  assert.strictEqual((await notify('qimen1700000002abcdef')).json.result, 'working');
  for (let i = 0; i < 5; i++) await notify('qimen1700000002abcdef');
  st = await req('GET', `/api/qimen/order/${o2.json.token}`);
  assert.strictEqual(st.json.status, 'failed'); assert.strictEqual(st.json.ref, 'qimen1700000002abcdef');
  g.failReading = false;
  assert.strictEqual((await notify('qimen1700000002abcdef')).json.result, 'done', 'AI กลับมา ส่งมอบผลได้');

  // จำกัดอัตราสร้างออเดอร์ต่อ IP
  let last;
  for (let i = 0; i < 6; i++) last = await req('POST', '/api/qimen/order', { topic: 'health' }, { 'X-Forwarded-For': '3.3.3.3' });
  assert.strictEqual(last.status, 429);

  // QR หมดอายุ (เกิน 10 นาที + เผื่อ) และยังไม่จ่าย -> expired (ผ่านสโตร์เริ่มต้นของแอป)
  const { getDefaultWebStore } = require('./qimen_web');
  getDefaultWebStore().put('e'.repeat(48), { gid: 'qimen1700000005abcdef', topic: 'love', created: Date.now() - 3600e3, expires: Date.now() - 3000e3, paid: false });
  assert.strictEqual((await req('GET', `/api/qimen/order/${'e'.repeat(48)}`)).json.status, 'expired');

  // ปิดบริการ: ตอบ 503
  process.env.QIMEN_WEB_ENABLED = 'false';
  assert.strictEqual((await req('GET', '/api/qimen/config')).status, 503);

  server.close();
  console.error = origErr;
  console.log('ผ่านการทดสอบหน้าเว็บฤกษ์ยาม ✅');
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
