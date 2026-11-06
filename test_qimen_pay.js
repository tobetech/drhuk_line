const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.QIMEN_LICENSE_KEY = 'TEST-KEY';
process.env.QIMEN_PAY_ENABLED = 'true';
process.env.QIMEN_PRICE_THB = '19';

const { handleQimenText, BUY_TEXT, CHECK_TEXT } = require('./qimen');
const { createPayStore, normalizeQr, qrPngBuffer } = require('./qimen_pay');
const { createMemoryLimiter } = require('./draws');

const SAMPLE_READING = {
  ai_ok: true, reading: 'คำแนะนำทดสอบ',
  chart: { time: { valid_from: '2026-11-06 11:00', valid_until: '2026-11-06 13:00' },
    palaces: Object.fromEntries('巽離坤震中兌艮坎乾'.split('').map((n) => [n, n === '中' ? {} : { door: '開', star: '芮', god: '虎', direction: 'S' }])) },
  directions: { best: null, avoid: null },
};

// gateway จำลอง: ควบคุมราคา สถานะการจ่าย และความล้มเหลวได้
function makeGateway() {
  const g = { calls: [], paid: new Set(), n: 0, amount: 19, failReading: false, notFound: false, statusError: false, qr: 'PROMPTPAY-PAYLOAD-0002' };
  g.fetch = async (url, init = {}) => {
    g.calls.push(url);
    const j = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url.endsWith('/v1/qr-payment/create')) { g.n += 1; return j(200, { order_id: `qimen17000000${g.n}abcdef`, qr_display: g.qr, amount: g.amount }); }
    if (url.includes('/v1/qr-payment/status/')) {
      if (g.statusError) return j(500, { error: 'ksher down' });
      if (g.notFound) return j(404, { error: 'ไม่พบรายการนี้' });
      const id = decodeURIComponent(url.split('/status/')[1].split('?')[0]);
      return j(200, { status: g.paid.has(id) ? 'paid' : 'waiting' });
    }
    if (url.endsWith('/v1/line-reading')) return g.failReading ? j(500, { error: 'ai down' }) : j(200, SAMPLE_READING);
    if (url.endsWith('/v1/log-transaction')) return j(200, { ok: true });
    throw new Error('unexpected ' + url);
  };
  return g;
}
const text = (r) => r.map((m) => m.text || '').join('\n');
const origErr = console.error; console.error = () => {};

(async () => {
  const now = new Date('2026-11-06T03:00:00Z');
  const lim = createMemoryLimiter();
  const store = createPayStore({});
  const g = makeGateway();
  const o = (extra = {}) => ({ limiter: lim, payStore: store, now, fetchFn: g.fetch, ...extra });

  // สิทธิ์ฟรีครั้งแรก
  assert.strictEqual((await handleQimenText('ดูฤกษ์ การเงิน', 'U1', o()))[0].type, 'flex');
  // ครั้งที่สอง ถูกจำกัด และมีปุ่มซื้อ 19 บาท
  const lm = await handleQimenText('ดูฤกษ์ ความรัก', 'U1', o());
  assert.ok(lm[0].text.includes('19 บาท'));
  assert.strictEqual(lm[0].quickReply.items[0].action.text, BUY_TEXT);

  // ซื้อ: ได้การ์ด QR ที่มีปุ่ม "ฉันชำระแล้ว" และรูปชี้มาที่บอท
  const buy = await handleQimenText(BUY_TEXT, 'U1', o());
  assert.strictEqual(buy.length, 1);
  const bj = JSON.stringify(buy[0]);
  assert.ok(bj.includes('/qr/qimen170000001abcdef.png') && bj.includes(CHECK_TEXT) && bj.includes('19 บาท'));
  // กดซื้อซ้ำ ใช้ QR เดิม ไม่สร้างออเดอร์ใหม่
  await handleQimenText(BUY_TEXT, 'U1', o());
  assert.strictEqual(g.n, 1, 'ซื้อซ้ำต้องใช้ออเดอร์เดิม');
  // รูป QR สร้างจากข้อความได้ และเป็น PNG
  const png = await qrPngBuffer(store.findOrder('qimen170000001abcdef'));
  assert.strictEqual(png.slice(1, 4).toString(), 'PNG');

  // ยังไม่จ่าย: รอ ไม่ได้สิทธิ์ ใช้หัวข้อไม่ได้
  const w = await handleQimenText(CHECK_TEXT, 'U1', o());
  assert.ok(w[0].text.includes('ยังไม่พบการชำระเงิน') && w[0].quickReply);
  assert.strictEqual(store.credits('U1'), 0);
  assert.ok((await handleQimenText('ดูฤกษ์ การงาน', 'U1', o()))[0].text.includes('จำกัด'));

  // จ่ายแล้ว: ได้ 1 สิทธิ์ ต่อให้กดตรวจซ้อนกันหลายครั้ง
  g.paid.add('qimen170000001abcdef');
  const [c1, c2] = await Promise.all([handleQimenText(CHECK_TEXT, 'U1', o()), handleQimenText(CHECK_TEXT, 'U1', o())]);
  assert.strictEqual(store.credits('U1'), 1, 'กดตรวจซ้อนต้องได้สิทธิ์เดียว');
  assert.ok(text(c1).includes('ได้รับการชำระเงิน') || text(c2).includes('ได้รับการชำระเงิน'));
  await handleQimenText(CHECK_TEXT, 'U1', o());
  assert.strictEqual(store.credits('U1'), 1, 'ตรวจซ้ำไม่ได้สิทธิ์เพิ่ม');
  // ออเดอร์เดิมถูกยัดกลับเป็น pending (จำลองซ้ำ): ต้องไม่ให้สิทธิ์ซ้ำ
  store.addPending('U1', { id: 'qimen170000001abcdef', amount: 19, created: Date.now(), qr: { type: 'text', text: 'x' } });
  await handleQimenText(CHECK_TEXT, 'U1', o());
  assert.strictEqual(store.credits('U1'), 1, 'ออเดอร์เดิมห้ามนับซ้ำ');
  assert.strictEqual(store.getPending('U1').length, 0);

  // ใช้สิทธิ์ที่ซื้อ: ได้ผล ตัดสิทธิ์ แล้วถูกจำกัดอีก
  const calls0 = g.calls.length;
  const paidRead = await handleQimenText('ดูฤกษ์ การงาน', 'U1', o());
  assert.strictEqual(paidRead[0].type, 'flex');
  assert.strictEqual(store.credits('U1'), 0);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(g.calls.slice(calls0).some((u) => u.endsWith('/v1/log-transaction')), 'ต้องบันทึกยอดขาย');
  assert.ok((await handleQimenText('ดูฤกษ์ การงาน', 'U1', o()))[0].text.includes('จำกัด'));

  // ใช้สิทธิ์ที่ซื้อ แต่ gateway/AI ล้มเหลว: สิทธิ์ต้องไม่หาย
  store.addCredit('U2', 1);
  lim.tryDraw('U2', '2026-11-06');
  g.failReading = true;
  const f = await handleQimenText('ดูฤกษ์ สุขภาพ', 'U2', o());
  assert.ok(f[0].text.includes('ขัดข้อง') && f[0].text.includes('สิทธิ์ที่ชำระแล้ว'));
  assert.strictEqual(store.credits('U2'), 1);
  g.failReading = false;
  // เมนูหัวข้อ: คนที่ใช้ฟรีแล้วแต่มีสิทธิ์ซื้อ ต้องเห็นเมนู
  assert.strictEqual((await handleQimenText('ดูฤกษ์ยาม', 'U2', o()))[1].type, 'flex');

  // ราคา gateway ไม่ตรง: ไม่สร้างรายการ ไม่หลุดไปให้ผู้ใช้จ่ายผิดราคา
  g.amount = 1;
  const bad = await handleQimenText(BUY_TEXT, 'U3', o());
  assert.ok(bad[0].text.includes('ขัดข้อง'));
  assert.strictEqual(store.getPending('U3').length, 0);
  g.amount = 19;

  // gateway หาออเดอร์ไม่เจอ (เช่นรีสตาร์ต): แจ้งรหัสอ้างอิงให้แอดมินตรวจ
  await handleQimenText(BUY_TEXT, 'U4', o());
  g.notFound = true;
  const nf = await handleQimenText(CHECK_TEXT, 'U4', o());
  assert.ok(nf[0].text.includes('รหัสอ้างอิง') && /qimen\d+/.test(nf[0].text));
  assert.strictEqual(store.credits('U4'), 0);
  g.notFound = false;
  // ตรวจสถานะล้มเหลวชั่วคราว: ไม่ตัดสินว่าไม่จ่าย
  g.statusError = true;
  assert.ok((await handleQimenText(CHECK_TEXT, 'U4', o()))[0].text.includes('ไม่สำเร็จชั่วคราว'));
  g.statusError = false;

  // ไม่มี userId (กลุ่ม): ซื้อไม่ได้
  assert.ok((await handleQimenText(BUY_TEXT, undefined, o()))[0].text.includes('แชทส่วนตัว'));

  // ปิดการชำระเงิน: ไม่มีปุ่มซื้อ และซื้อไม่ได้
  process.env.QIMEN_PAY_ENABLED = 'false';
  const lim2 = createMemoryLimiter(); lim2.tryDraw('U9', '2026-11-06');
  const off = await handleQimenText('ดูฤกษ์ การเงิน', 'U9', { limiter: lim2, payStore: store, now, fetchFn: g.fetch });
  assert.ok(!off[0].quickReply && !off[0].text.includes('บาท'));
  assert.ok((await handleQimenText(BUY_TEXT, 'U9', o()))[0].text.includes('ยังไม่เปิด'));
  process.env.QIMEN_PAY_ENABLED = 'true';

  // รูปแบบ QR จาก gateway
  assert.strictEqual(normalizeQr('data:image/png;base64,iVBORw0KGgo=').type, 'png');
  assert.strictEqual(normalizeQr('https://x.example/qr.png').type, 'url');
  assert.strictEqual(normalizeQr('00020101021230...').type, 'text');
  const realPng = (await require('qrcode').toBuffer('hello')).toString('base64');
  assert.strictEqual(normalizeQr(realPng).type, 'png');
  assert.strictEqual(normalizeQr(''), null);

  // เก็บลงไฟล์: คงอยู่หลังรีสตาร์ต และไม่มี User ID ตรงๆ
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pay-'));
  const file = path.join(tmp, 'pay.json');
  const A = createPayStore({ file, salt: 's' });
  A.addCredit('Uabc999', 2); A.markConsumed('ord1');
  const B = createPayStore({ file, salt: 's' });
  assert.strictEqual(B.credits('Uabc999'), 2);
  assert.ok(B.isConsumed('ord1'));
  assert.ok(!fs.readFileSync(file, 'utf8').includes('Uabc999'));

  console.error = origErr;
  console.log('ผ่านการทดสอบการชำระเงิน ✅');
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
