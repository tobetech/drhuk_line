const assert = require('assert');
const crypto = require('crypto');
const http = require('http');
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.QIMEN_LICENSE_KEY = 'TEST-KEY';
process.env.QIMEN_PAY_ENABLED = 'true';
process.env.QIMEN_PRICE_THB = '19';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'notify-'));

const { settleOrder, handleQimenText, buildPayFlex, CHECK_TEXT } = require('./qimen');
const { createPayStore, verifyNotify, createOrder, getDefaultPayStore } = require('./qimen_pay');

const SECRET = 'shared-secret';
const sign = (ts, id, secret = SECRET) => crypto.createHmac('sha256', secret).update(`${ts}.${id}`).digest('hex');
const OID = 'qimen1793944566abcdef';
const jres = (status, body) => ({ ok: status < 400, status, json: async () => body });
const origErr = console.error; console.error = () => {};

(async () => {
  // ลายเซ็นสัญญาณ
  const now = Date.now(); const ts = String(Math.floor(now / 1000));
  assert.ok(verifyNotify(SECRET, ts, OID, sign(ts, OID), now));
  assert.ok(!verifyNotify(SECRET, ts, OID, sign(ts, OID, 'other'), now), 'secret ผิด');
  assert.ok(!verifyNotify(SECRET, ts, 'qimen1793944566abcdee', sign(ts, OID), now), 'order ไม่ตรงกับลายเซ็น');
  assert.ok(!verifyNotify(SECRET, ts, OID, sign(ts, OID), now + 10 * 60 * 1000), 'สัญญาณเก่าเกิน 5 นาที');
  assert.ok(!verifyNotify(SECRET, ts, 'bad id', sign(ts, 'bad id'), now), 'รูปแบบรหัสผิด');
  assert.ok(!verifyNotify('', ts, OID, sign(ts, OID, ''), now), 'ไม่มี secret ต้องไม่ผ่าน');
  assert.ok(!verifyNotify(SECRET, ts, OID, 'zz', now));

  // createOrder ขอ webhook และอายุ QR
  let sent = null;
  const o1 = await createOrder(async (url, init) => { sent = JSON.parse(init.body); return jres(200, { order_id: OID, qr_display: 'PAYLOAD', amount: 19 }); });
  assert.strictEqual(sent.notify, true);
  assert.strictEqual(sent.expire_seconds, 600);
  assert.ok(o1.expires > Date.now() + 590000);

  // settleOrder: จ่ายแล้ว -> ให้สิทธิ์ 1 ครั้ง + push ครั้งเดียว
  const store = createPayStore({});
  store.addPending('Ureal123', { id: OID, amount: 19, created: Date.now(), expires: Date.now() + 600000, uid: 'Ureal123', qr: { type: 'text', text: 'x' } });
  const pushes = [];
  const push = async (to, messages) => pushes.push({ to, messages });
  const paidFetch = async () => jres(200, { status: 'paid' });
  assert.strictEqual(await settleOrder(OID, { payStore: store, fetchFn: paidFetch, push }), 'granted');
  assert.strictEqual(store.credits('Ureal123'), 1);
  assert.strictEqual(pushes.length, 1);
  assert.strictEqual(pushes[0].to, 'Ureal123');
  assert.ok(pushes[0].messages[0].text.includes('ได้รับการชำระเงิน') && pushes[0].messages[1].type === 'flex');
  // สัญญาณซ้ำ (Ksher ส่งซ้ำ): ไม่ให้สิทธิ์ซ้ำ ไม่ push ซ้ำ
  assert.strictEqual(await settleOrder(OID, { payStore: store, fetchFn: paidFetch, push }), 'unknown');
  assert.strictEqual(store.credits('Ureal123'), 1);
  assert.strictEqual(pushes.length, 1);
  // ผู้ใช้กดปุ่มตรวจหลังได้สิทธิ์ไปแล้ว: ไม่ได้เพิ่ม
  const after = await handleQimenText(CHECK_TEXT, 'Ureal123', { payStore: store, fetchFn: paidFetch });
  assert.ok(after[0].text.includes('คงเหลือ 1 ครั้ง'));
  assert.strictEqual(store.credits('Ureal123'), 1);

  // ยังไม่จ่ายจริง (สัญญาณปลอมหรือถามก่อนเวลา): ไม่ให้สิทธิ์ ไม่ push
  const OID2 = 'qimen1793944567abcdef';
  store.addPending('Uother', { id: OID2, amount: 19, created: Date.now(), expires: Date.now() + 600000, uid: 'Uother', qr: { type: 'text', text: 'x' } });
  assert.strictEqual(await settleOrder(OID2, { payStore: store, fetchFn: async () => jres(200, { status: 'waiting' }), push }), 'waiting');
  assert.strictEqual(store.credits('Uother'), 0);
  assert.strictEqual(pushes.length, 1);
  // ตรวจสถานะล้มเหลว: ไม่ให้สิทธิ์ ออเดอร์ยังอยู่ให้ลองใหม่
  assert.strictEqual(await settleOrder(OID2, { payStore: store, fetchFn: async () => jres(500, { error: 'x' }), push }), 'error');
  assert.strictEqual(store.getPending('Uother').length, 1);
  // push ล้มเหลว: สิทธิ์ยังอยู่ (ผู้ใช้กด/พิมพ์ตรวจได้)
  assert.strictEqual(await settleOrder(OID2, { payStore: store, fetchFn: paidFetch, push: async () => { throw new Error('quota'); } }), 'granted');
  assert.strictEqual(store.credits('Uother'), 1);
  // ออเดอร์ที่ไม่รู้จัก
  assert.strictEqual(await settleOrder('qimen1793944568ffffff', { payStore: store, fetchFn: paidFetch, push }), 'unknown');

  // การ์ด QR แสดงเวลาหมดอายุ และ QR หมดเวลาแล้วแจ้งให้ขอใหม่
  const card = JSON.stringify(buildPayFlex({ id: OID, qr: { type: 'text', text: 'x' }, created: Date.now(), expires: Date.now() + 600000 }, 19));
  assert.ok(card.includes('QR ใช้ได้ถึง') && card.includes('ตรวจสถานะ'));
  store.addPending('Uexp', { id: 'qimen1793944569aaaaaa', amount: 19, created: Date.now() - 700000, expires: Date.now() - 100000, uid: 'Uexp', qr: { type: 'text', text: 'x' } });
  const exp = await handleQimenText(CHECK_TEXT, 'Uexp', { payStore: store, fetchFn: async () => jres(200, { status: 'waiting' }) });
  assert.ok(exp[0].text.includes('หมดเวลา') && exp[0].quickReply);
  // หมดเวลาแต่เงินเข้าแล้ว ยังต้องได้สิทธิ์
  const late = await handleQimenText(CHECK_TEXT, 'Uexp', { payStore: store, fetchFn: paidFetch });
  assert.ok(late[0].text.includes('ได้รับการชำระเงิน'));
  assert.strictEqual(store.credits('Uexp'), 1);

  // เส้นทาง HTTP จริง /internal/payment-notify
  process.env.QIMEN_NOTIFY_SECRET = SECRET;
  const app = require('./index');
  app.set('qimenFetch', paidFetch);
  const hpushes = [];
  app.set('qimenPush', async (to, messages) => hpushes.push({ to, messages }));
  getDefaultPayStore().addPending('Uhttp', { id: OID, amount: 19, created: Date.now(), expires: Date.now() + 600000, uid: 'Uhttp', qr: { type: 'text', text: 'x' } });
  const server = app.listen(0);
  const port = server.address().port;
  const post = (body, headers = {}) => new Promise((resolve) => {
    const req = http.request({ port, path: '/internal/payment-notify', method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } },
      (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve([res.statusCode, b])); });
    req.end(body);
  });
  const t1 = String(Math.floor(Date.now() / 1000));
  const body = JSON.stringify({ order_id: OID, ts: t1 });
  assert.strictEqual((await post(body, { 'X-Notify-Signature': 'bad' }))[0], 401, 'ลายเซ็นผิดต้องถูกปฏิเสธ');
  assert.strictEqual((await post(body))[0], 401, 'ไม่มีลายเซ็นต้องถูกปฏิเสธ');
  assert.strictEqual((await post('not json'))[0], 400);
  const oldTs = String(Math.floor(Date.now() / 1000) - 3600);
  assert.strictEqual((await post(JSON.stringify({ order_id: OID, ts: oldTs }), { 'X-Notify-Signature': sign(oldTs, OID) }))[0], 401, 'สัญญาณเก่าถูกปฏิเสธ');
  assert.strictEqual(hpushes.length, 0, 'คำขอที่ถูกปฏิเสธต้องไม่ push');
  const ok = await post(body, { 'X-Notify-Signature': sign(t1, OID) });
  assert.strictEqual(ok[0], 200);
  assert.strictEqual(JSON.parse(ok[1]).result, 'granted');
  assert.strictEqual(hpushes.length, 1);
  assert.strictEqual(hpushes[0].to, 'Uhttp');
  assert.strictEqual(getDefaultPayStore().credits('Uhttp'), 1);
  const dup = await post(body, { 'X-Notify-Signature': sign(t1, OID) });
  assert.strictEqual(JSON.parse(dup[1]).result, 'unknown');
  assert.strictEqual(hpushes.length, 1, 'ส่งซ้ำต้องไม่ push ซ้ำ');
  delete process.env.QIMEN_NOTIFY_SECRET;
  assert.strictEqual((await post(body, { 'X-Notify-Signature': sign(t1, OID) }))[0], 503, 'ไม่ตั้ง secret ต้องปิดเส้นทาง');
  server.close();

  console.error = origErr;
  console.log('ผ่านการทดสอบ webhook ชำระเงิน ✅');
})().catch((e) => { console.error = origErr; console.error(e); process.exit(1); });
