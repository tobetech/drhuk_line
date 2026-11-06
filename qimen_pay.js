// ชำระเงินสำหรับฤกษ์ยามเพิ่มเติม (นอกเหนือสิทธิ์ฟรีวันละ 1 ครั้ง) ผ่าน gateway/Ksher
// เก็บเฉพาะ: รหัสผู้ใช้ที่เข้ารหัสทางเดียว (HMAC), เครดิตที่ชำระแล้วยังไม่ใช้, ออเดอร์ที่รอชำระ, รหัสออเดอร์ที่ใช้แล้ว
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');

const PENDING_TTL_MS = 2 * 60 * 60 * 1000;   // ออเดอร์ที่ยังไม่จ่ายเก็บไว้ตรวจ 2 ชั่วโมง
const REUSE_MS = 10 * 60 * 1000;             // กดซื้อซ้ำภายใน 10 นาที ใช้ QR เดิม
const MAX_PENDING = 3;
const MAX_CONSUMED = 2000;

function payConfig() {
  return {
    enabled: process.env.QIMEN_PAY_ENABLED === 'true',
    price: Number(process.env.QIMEN_PRICE_THB) || 19,
    base: (process.env.QIMEN_GATEWAY_URL || 'https://qimen.tobe-tech.com').replace(/\/+$/, ''),
    licenseKey: process.env.QIMEN_LICENSE_KEY || '',
    machineId: process.env.QIMEN_MACHINE_ID || 'line-bot',
    timeoutMs: 20000,
  };
}

function createPayStore({ file, salt = 'siamsi' } = {}) {
  const hash = (u) => crypto.createHmac('sha256', salt).update(String(u)).digest('hex').slice(0, 32);
  let state = { users: {}, consumed: [] };
  if (file) {
    try {
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      state = { users: j.users || {}, consumed: j.consumed || [] };
    } catch (_) { /* เริ่มใหม่ */ }
  }
  function persist() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('บันทึกข้อมูลการชำระเงินไม่สำเร็จ:', err.message);
    }
  }
  const user = (u) => (state.users[hash(u)] ||= { credits: 0, pending: [] });
  function prune(rec, now) {
    rec.pending = rec.pending.filter((o) => now - o.created < PENDING_TTL_MS);
  }
  return {
    credits: (u) => (state.users[hash(u)] ? state.users[hash(u)].credits : 0),
    addCredit(u, n = 1) { user(u).credits += n; persist(); },
    useCredit(u) {
      const r = user(u);
      if (r.credits <= 0) return false;
      r.credits -= 1; persist(); return true;
    },
    getPending(u, now = Date.now()) {
      const r = state.users[hash(u)];
      if (!r) return [];
      prune(r, now);
      return r.pending.slice();
    },
    addPending(u, order) {
      const r = user(u);
      r.pending.push(order);
      r.pending = r.pending.slice(-MAX_PENDING);
      persist();
    },
    removePending(u, orderId) {
      const r = state.users[hash(u)];
      if (!r) return;
      r.pending = r.pending.filter((o) => o.id !== orderId);
      persist();
    },
    isConsumed: (id) => state.consumed.includes(id),
    markConsumed(id) {
      state.consumed.push(id);
      state.consumed = state.consumed.slice(-MAX_CONSUMED);
      persist();
    },
    // หา QR จากรหัสออเดอร์ (ใช้เสิร์ฟรูป /qr/<id>.png)
    findOrder(orderId) {
      for (const r of Object.values(state.users)) {
        const o = r.pending.find((x) => x.id === orderId);
        if (o) return o;
      }
      return null;
    },
  };
}

// qr_display จาก gateway อาจเป็น data URL, base64 ของรูป PNG, ลิงก์รูป หรือข้อความที่ต้องสร้างเป็น QR
function normalizeQr(qr) {
  const s = String(qr || '').trim();
  if (!s) return null;
  const dataUrl = /^data:image\/[a-z+]+;base64,(.+)$/is.exec(s);
  if (dataUrl) return { type: 'png', b64: dataUrl[1].replace(/\s+/g, '') };
  if (/^[A-Za-z0-9+/=\s]{200,}$/.test(s)) {
    const b64 = s.replace(/\s+/g, '');
    const head = Buffer.from(b64.slice(0, 16), 'base64');
    if (head.slice(0, 4).toString('hex') === '89504e47' || head.slice(0, 2).toString('hex') === 'ffd8') {
      return { type: 'png', b64 };
    }
  }
  if (/^https:\/\/\S+\.(png|jpe?g)(\?\S*)?$/i.test(s)) return { type: 'url', url: s };
  return { type: 'text', text: s };
}

async function qrPngBuffer(order) {
  if (!order || !order.qr) return null;
  if (order.qr.type === 'png') return Buffer.from(order.qr.b64, 'base64');
  if (order.qr.type === 'text') return QRCode.toBuffer(order.qr.text, { width: 640, margin: 2, errorCorrectionLevel: 'M' });
  return null;
}

async function gatewayJson(url, init, fetchFn = fetch) {
  const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(payConfig().timeoutMs) });
  let data = null;
  try { data = await res.json(); } catch (_) { /* ไม่ใช่ JSON */ }
  return { ok: res.ok, status: res.status, data: data || {} };
}

async function createOrder(fetchFn) {
  const c = payConfig();
  const r = await gatewayJson(`${c.base}/v1/qr-payment/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_key: c.licenseKey, machine_id: c.machineId }),
  }, fetchFn);
  if (!r.ok || r.data.error || !r.data.order_id) {
    throw new Error(`create ${r.status}: ${r.data.error || 'ตอบกลับไม่ถูกต้อง'}`);
  }
  if (Math.abs(Number(r.data.amount) - c.price) > 0.001) {
    throw new Error(`ราคาไม่ตรง: gateway=${r.data.amount} บอท=${c.price}`);
  }
  const qr = normalizeQr(r.data.qr_display);
  if (!qr) throw new Error('ไม่พบ QR ในคำตอบ');
  return { id: String(r.data.order_id), amount: c.price, qr };
}

// คืน 'paid' | 'waiting' | 'notfound' หรือโยน error ถ้าตรวจไม่ได้
async function orderStatus(orderId, fetchFn) {
  const c = payConfig();
  const q = new URLSearchParams({ license_key: c.licenseKey, machine_id: c.machineId });
  const r = await gatewayJson(`${c.base}/v1/qr-payment/status/${encodeURIComponent(orderId)}?${q}`, { method: 'GET' }, fetchFn);
  if (r.status === 404) return 'notfound';
  if (!r.ok || r.data.error) throw new Error(`status ${r.status}: ${r.data.error || 'ตอบกลับไม่ถูกต้อง'}`);
  return r.data.status === 'paid' ? 'paid' : 'waiting';
}

async function logSale(topicKey, fetchFn) {
  const c = payConfig();
  try {
    await gatewayJson(`${c.base}/v1/log-transaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ license_key: c.licenseKey, machine_id: c.machineId, method: 'qr', lang: 'th', topic: topicKey }),
    }, fetchFn);
  } catch (err) {
    console.error('บันทึกยอดขายไม่สำเร็จ:', err.message);
  }
}

let defaultStore = null;
function getDefaultPayStore() {
  if (!defaultStore) {
    const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
    defaultStore = createPayStore({ file: path.join(dir, 'qimen_pay.json'), salt: process.env.LINE_CHANNEL_SECRET || 'siamsi' });
  }
  return defaultStore;
}

module.exports = {
  payConfig, createPayStore, getDefaultPayStore, normalizeQr, qrPngBuffer,
  createOrder, orderStatus, logSale, REUSE_MS,
};
