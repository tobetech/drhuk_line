// หน้าเว็บดูฤกษ์ยามฉีเหมินแบบชำระเงิน (19 บาท/ครั้ง ผ่าน Ksher QR ของ gateway เดิม)
// ไม่มีบัญชีผู้ใช้/คุกกี้: ผู้ซื้อได้ "โทเค็นออเดอร์" สุ่มยาว เก็บในเบราว์เซอร์ ใช้เปิดผลซ้ำได้ 24 ชั่วโมง
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const pay = require('./qimen_pay');
const { TOPICS, fetchReading, shapeForWeb } = require('./qimen');

const TOPIC_KEYS = new Set(TOPICS.map((t) => t.key));
const KEEP_MS = 24 * 60 * 60 * 1000;      // เก็บผล/ออเดอร์ 24 ชั่วโมง
const CHECK_GAP_MS = 10 * 1000;           // Ksher แนะนำ ตรวจสถานะออเดอร์เดิมห่างกัน >= 10 วินาที
const GEN_GAP_MS = 8 * 1000;
const MAX_GEN_FAILS = 6;
const MAX_OPEN_ORDERS = 300;
const CREATE_LIMIT = 5;                   // ต่อ IP ต่อ 10 นาที
const CREATE_WINDOW_MS = 10 * 60 * 1000;
const GRACE_MS = 60 * 1000;               // รอเผื่อ webhook ช้าหลัง QR หมดอายุ

function createWebStore({ file } = {}) {
  let orders = {};
  if (file) {
    try { orders = JSON.parse(fs.readFileSync(file, 'utf8')).orders || {}; } catch (_) { /* เริ่มใหม่ */ }
  }
  function save() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ orders }), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('บันทึกออเดอร์เว็บไม่สำเร็จ:', err.message);
    }
  }
  function prune(now = Date.now()) {
    let changed = false;
    for (const [k, o] of Object.entries(orders)) {
      if (now - o.created > KEEP_MS) { delete orders[k]; changed = true; }
    }
    if (changed) save();
  }
  return {
    get: (tok) => orders[tok] || null,
    byGatewayId(gid) {
      for (const [tok, o] of Object.entries(orders)) if (o.gid === gid) return { tok, order: o };
      return null;
    },
    put(tok, o) { orders[tok] = o; save(); },
    save,
    prune,
    openCount: () => Object.values(orders).filter((o) => !o.paid && !o.result).length,
  };
}

let defaultStore = null;
function getDefaultWebStore() {
  if (!defaultStore) {
    const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
    defaultStore = createWebStore({ file: path.join(dir, 'qimen_web.json') });
  }
  return defaultStore;
}

function isWebEnabled() {
  return process.env.QIMEN_WEB_ENABLED === 'true' && Boolean(pay.payConfig().licenseKey);
}

const inFlight = new Set();

// ตรวจ/สรุปออเดอร์หนึ่งใบ: ตรวจกับ Ksher (ผ่าน gateway) -> เมื่อจ่ายแล้วสร้างผลฤกษ์ยามครั้งเดียว
// opts.force: มาจากสัญญาณ webhook จึงข้ามช่วงหน่วง 10 วินาที
async function settleWeb(store, tok, opts = {}) {
  const o = store.get(tok);
  if (!o) return 'unknown';
  if (o.result) return 'done';
  if (inFlight.has(tok)) return 'busy';
  inFlight.add(tok);
  try {
    const now = Date.now();
    if (!o.paid) {
      if (!opts.force && now - (o.lastCheck || 0) < CHECK_GAP_MS) return 'waiting';
      o.lastCheck = now;
      let st;
      try { st = await pay.orderStatus(o.gid, opts.fetchFn); } catch (err) {
        console.error('qimen web status error:', err.message);
        return 'waiting';
      }
      if (st !== 'paid') return 'waiting';
      o.paid = true; o.paidAt = now; store.save();
    }
    if (!opts.force && now - (o.lastGen || 0) < GEN_GAP_MS) return 'working';
    o.lastGen = now;
    const topic = TOPICS.find((t) => t.key === o.topic);
    let data;
    try {
      data = await fetchReading(o.topic, opts.fetchFn);
      if (!String(data.reading || '').trim()) throw new Error('ไม่มีคำแนะนำจาก AI');
    } catch (err) {
      o.genFails = (o.genFails || 0) + 1;
      store.save();
      console.error('qimen web reading error:', err.message);
      return o.genFails >= MAX_GEN_FAILS ? 'failed' : 'working';
    }
    o.result = shapeForWeb(data, topic);
    delete o.qr;
    store.save();
    pay.logSale(o.topic, opts.fetchFn).catch(() => {});
    return 'done';
  } finally {
    inFlight.delete(tok);
  }
}

function statusBody(o, s) {
  if (s === 'unknown' || !o) return { status: 'notfound' };
  if (o.result) return { status: 'done', result: o.result, ref: o.gid };
  if (o.paid) return { status: s === 'failed' || (o.genFails || 0) >= MAX_GEN_FAILS ? 'failed' : 'working', ref: o.gid };
  if (Date.now() > o.expires + GRACE_MS) return { status: 'expired' };
  return { status: 'waiting', expiresAt: o.expires };
}

function createWebRouter({ store = getDefaultWebStore(), fetchFn } = {}) {
  const r = express.Router();
  const hits = new Map();
  const limited = (ip) => {
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < CREATE_WINDOW_MS);
    if (arr.length >= CREATE_LIMIT) { hits.set(ip, arr); return true; }
    arr.push(now); hits.set(ip, arr);
    if (hits.size > 5000) hits.clear();
    return false;
  };
  const guard = (_req, res, next) => (isWebEnabled() ? next() : res.status(503).json({ error: 'บริการนี้ยังไม่เปิดให้ใช้งาน' }));
  r.use(guard);
  r.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  r.get('/config', (_req, res) => {
    res.json({ price: pay.payConfig().price, topics: TOPICS.map((t) => ({ key: t.key, label: t.label, emoji: t.emoji })) });
  });

  r.post('/order', express.json({ limit: '1kb' }), async (req, res) => {
    const topic = req.body && req.body.topic;
    if (!TOPIC_KEYS.has(topic)) return res.status(400).json({ error: 'เลือกหัวข้อไม่ถูกต้อง' });
    if (limited(req.ip)) return res.status(429).json({ error: 'ทำรายการถี่เกินไป กรุณารอสักครู่แล้วลองใหม่' });
    store.prune();
    if (store.openCount() >= MAX_OPEN_ORDERS) return res.status(503).json({ error: 'ระบบมีผู้ใช้งานจำนวนมาก กรุณาลองใหม่ภายหลัง' });
    let order;
    try {
      order = await pay.createOrder(fetchFn);
    } catch (err) {
      console.error('qimen web create error:', err.message);
      return res.status(502).json({ error: 'ระบบชำระเงินขัดข้องชั่วคราว ยังไม่มีการตัดเงิน กรุณาลองใหม่ภายหลัง' });
    }
    const tok = crypto.randomBytes(24).toString('hex');
    store.put(tok, { gid: order.id, topic, qr: order.qr, amount: order.amount, created: Date.now(), expires: order.expires, paid: false });
    res.json({ token: tok, amount: order.amount, expiresAt: order.expires });
  });

  r.get('/order/:tok', async (req, res) => {
    const tok = String(req.params.tok);
    if (!/^[0-9a-f]{48}$/.test(tok)) return res.status(404).json({ status: 'notfound' });
    const o = store.get(tok);
    if (!o) return res.status(404).json({ status: 'notfound' });
    const s = await settleWeb(store, tok, { fetchFn }).catch((err) => { console.error('qimen web settle error:', err.message); return 'waiting'; });
    res.json({ ...statusBody(o, s), topic: o.topic });
  });

  r.get('/qr/:file', async (req, res) => {
    const tok = String(req.params.file).replace(/\.png$/i, '');
    const o = /^[0-9a-f]{48}$/.test(tok) ? store.get(tok) : null;
    const png = o && !o.paid ? await pay.qrPngBuffer(o).catch(() => null) : null;
    if (!png) return res.sendStatus(404);
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' }).send(png);
  });
  return r;
}

// สัญญาณ webhook จาก gateway: คืน undefined ถ้าไม่ใช่ออเดอร์ของเว็บ
async function settleWebByGatewayId(gid, opts = {}) {
  const store = opts.store || getDefaultWebStore();
  const f = store.byGatewayId(gid);
  if (!f) return undefined;
  return settleWeb(store, f.tok, { force: true, fetchFn: opts.fetchFn });
}

module.exports = { createWebStore, getDefaultWebStore, createWebRouter, settleWeb, settleWebByGatewayId, isWebEnabled };
