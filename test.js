const assert = require('assert');
const crypto = require('crypto');
const http = require('http');

process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';

const { FORTUNES } = require('./fortunes');
const { handleText, buildFlex, pickDaily } = require('./fortune');

// 1) ข้อมูล 60 ใบครบ ไม่มีช่องว่าง
assert.strictEqual(FORTUNES.length, 60);
const titles = new Set();
for (const f of FORTUNES) {
  for (const k of ['title', 'poem', 'work', 'money', 'love', 'health']) {
    assert.ok(f[k] && f[k].trim(), `ใบที่ ${f.no} ขาด ${k}`);
  }
  assert.ok([1, 2, 3, 4].includes(f.level));
  titles.add(f.title);
}
assert.strictEqual(titles.size, 60, 'ชื่อใบซ้ำกัน');
const dist = [1, 2, 3, 4].map((l) => FORTUNES.filter((f) => f.level === l).length);
console.log('จำนวนตามระดับ [ดีเยี่ยม, ดี, กลาง, ระวัง]:', dist);

// 2) Flex ทุกใบ serialize ได้ และ altText ไม่เกิน 400 ตัวอักษร
for (const f of FORTUNES) {
  const m = buildFlex(f);
  assert.ok(m.altText.length <= 400);
  JSON.parse(JSON.stringify(m));
}

// 3) คำสั่งข้อความ
assert.strictEqual(handleText('สวัสดีครับ แอดมินอยู่ไหม', 'U1'), null);
assert.strictEqual(handleText('ขอราคาสินค้า', 'U1'), null);
assert.ok(handleText('เสี่ยงเซียมซี', 'U1').length === 2);
assert.ok(handleText('สุ่มเซียมซี', 'U1')[0].type === 'flex');
assert.ok(handleText('ใบที่ 12', 'U1')[0].altText.includes('ใบที่ 12'));
assert.ok(handleText('60', 'U1')[0].altText.includes('ใบที่ 60'));
assert.ok(handleText('61', 'U1')[0].type === 'text');
assert.ok(handleText('วิธีใช้', 'U1')[0].text.includes('เสี่ยงเซียมซี'));

// 4) ใบประจำวัน: วันเดียวกันได้ใบเดิม วันต่างกันกระจายตัว
const d1 = new Date('2026-11-06T03:00:00Z');
assert.strictEqual(pickDaily('U1', d1).no, pickDaily('U1', new Date('2026-11-06T10:00:00Z')).no);
const seen = new Set();
for (let i = 0; i < 500; i++) seen.add(pickDaily('U' + i, d1).no);
console.log('ผู้ใช้ 500 คน ได้ใบไม่ซ้ำกัน', seen.size, 'ใบ');
assert.ok(seen.size >= 55);

// 5) webhook: signature ถูก/ผิด
const app = require('./index');
const server = app.listen(0, async () => {
  const port = server.address().port;
  const body = JSON.stringify({ destination: 'U0', events: [] });
  const sig = crypto.createHmac('sha256', 'test-secret').update(body).digest('base64');
  const post = (signature) =>
    new Promise((resolve) => {
      const req = http.request(
        { port, path: '/webhook', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signature } },
        (res) => { res.resume(); resolve(res.statusCode); }
      );
      req.end(body);
    });
  const ok = await post(sig);
  const bad = await post('wrong');
  console.log('signature ถูก ->', ok, '| signature ผิด ->', bad);
  assert.strictEqual(ok, 200);
  assert.strictEqual(bad, 401);
  const get = (p) => new Promise((resolve) => http.get({ port, path: p }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve([res.statusCode, b])); }));
  const [ps, pb] = await get('/privacy');
  const [ts, tb] = await get('/terms');
  assert.ok(ps === 200 && pb.includes('นโยบายความเป็นส่วนตัว'));
  assert.ok(ts === 200 && tb.includes('ข้อกำหนดการใช้งาน'));
  assert.strictEqual((await get('/style.css'))[0], 200);
  console.log('หน้า /privacy /terms ->', ps, ts);
  console.log('ผ่านการทดสอบทั้งหมด ✅');
  server.close();
});
