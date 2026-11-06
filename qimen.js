// ดูฤกษ์ยามฉีเหมิน: เรียกเซิร์ฟเวอร์กลาง (gateway) ให้คำนวณผังและเขียนคำแนะนำ แล้วส่งกลับเป็น Flex card
// จำกัดวันละ 1 ครั้งต่อผู้ใช้ (แยกจากเซียมซี) และนับสิทธิ์เมื่อได้คำตอบสำเร็จเท่านั้น
const path = require('path');
const { createFileLimiter } = require('./draws');
const { bangkokDate } = require('./fortune');
const pay = require('./qimen_pay');

const TOPICS = [
  { key: 'overall', label: 'ภาพรวม', emoji: '🧭' },
  { key: 'love', label: 'ความรัก', emoji: '💞' },
  { key: 'career', label: 'การงาน', emoji: '💼' },
  { key: 'money', label: 'การเงิน', emoji: '💰' },
  { key: 'health', label: 'สุขภาพ', emoji: '🌿' },
  { key: 'family', label: 'ครอบครัว', emoji: '🏠' },
];
const TOPIC_BY_LABEL = Object.fromEntries(TOPICS.map((t) => [t.label, t]));

const MENU_TRIGGER = /ฤกษ์ยาม|ฉีเหมิน|ดูฤกษ์|ดูยาม/;
const TOPIC_PICK = /^ดูฤกษ์\s*(.+)$/;
const BUY_TEXT = 'ซื้อฤกษ์ยาม';
const CHECK_TEXT = 'ตรวจการชำระเงิน';

const QIMEN_LIMIT_TEXT = [
  '🙏 จำกัดการดูฤกษ์ยามวันละ 1 ครั้ง',
  'วันนี้คุณดูฤกษ์ยามไปแล้ว พรุ่งนี้มาดูใหม่ได้ตั้งแต่เที่ยงคืนค่ะ',
].join('\n');

const DOOR_TH = {
  休: 'ประตูพัก', 生: 'ประตูกำเนิด', 傷: 'ประตูบาดเจ็บ', 杜: 'ประตูปิดกั้น',
  景: 'ประตูทิวทัศน์', 死: 'ประตูตาย', 驚: 'ประตูตกใจ', 開: 'ประตูเปิด',
};
const DIR_SHORT = {
  N: 'เหนือ', NE: 'ตอ.เหนือ', E: 'ตะวันออก', SE: 'ตอ.ใต้',
  S: 'ใต้', SW: 'ตต.ใต้', W: 'ตะวันตก', NW: 'ตต.เหนือ', C: 'กลาง',
};
// ทิศใต้อยู่ด้านบนตามตำราฉีเหมิน
const GRID = [['巽', '離', '坤'], ['震', '中', '兌'], ['艮', '坎', '乾']];

function config() {
  return {
    base: (process.env.QIMEN_GATEWAY_URL || 'https://qimen.tobe-tech.com').replace(/\/+$/, ''),
    licenseKey: process.env.QIMEN_LICENSE_KEY || '',
    machineId: process.env.QIMEN_MACHINE_ID || 'line-bot',
    timeoutMs: Number(process.env.QIMEN_TIMEOUT_MS) || 45000,
  };
}

function isEnabled() {
  return Boolean(config().licenseKey);
}

// "2026-11-06 11:00" (เวลาปักกิ่ง) -> "HH:mm" เวลาไทย (ลบ 1 ชั่วโมง)
function beijingToThai(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(str || '');
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 60 * 60 * 1000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

async function fetchReading(topicKey, fetchFn = fetch) {
  const cfg = config();
  const res = await fetchFn(`${cfg.base}/v1/line-reading`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_key: cfg.licenseKey, machine_id: cfg.machineId, topic: topicKey }),
    signal: AbortSignal.timeout(cfg.timeoutMs),
  });
  let data = null;
  try { data = await res.json(); } catch (_) { /* ไม่ใช่ JSON */ }
  if (!res.ok || !data || data.error) {
    throw new Error(`gateway ${res.status}: ${data && data.error ? data.error : 'ตอบกลับไม่ถูกต้อง'}`);
  }
  return data;
}

function buildTopicMenuFlex() {
  const btn = (t) => ({
    type: 'button', style: 'secondary', height: 'sm', margin: 'sm', flex: 1,
    action: { type: 'message', label: `${t.emoji} ${t.label}`, text: `ดูฤกษ์ ${t.label}` },
  });
  const rows = [];
  for (let i = 0; i < TOPICS.length; i += 2) {
    rows.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: TOPICS.slice(i, i + 2).map(btn) });
  }
  return {
    type: 'flex',
    altText: 'ดูฤกษ์ยามฉีเหมิน เลือกหัวข้อที่อยากรู้',
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#2F3A5F', paddingAll: '14px',
        contents: [
          { type: 'text', text: '🧭 ฤกษ์ยามฉีเหมิน', weight: 'bold', size: 'lg', color: '#FFFFFF' },
          { type: 'text', text: '奇門遁甲 · ดูทิศและจังหวะตามเวลา', size: 'xs', color: '#D9DEEF', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [
          { type: 'text', text: 'เลือกเรื่องที่อยากรู้ 1 หัวข้อ ระบบจัดผังจากเวลาที่คุณกดเลือก', size: 'sm', wrap: true, color: '#444444' },
          ...rows,
          { type: 'text', text: 'ดูได้วันละ 1 ครั้ง · เพื่อความบันเทิงและเป็นแนวทางประกอบการตัดสินใจเท่านั้น', size: 'xxs', color: '#999999', wrap: true, margin: 'md' },
        ],
      },
    },
  };
}

function palaceCell(chart, name, bestName, avoidName) {
  const p = chart.palaces[name] || {};
  let bg = '#F5F0E4';
  if (name === bestName) bg = '#D8EFDD';
  else if (name === avoidName) bg = '#F6D9D6';
  const dirTh = DIR_SHORT[p.direction] || '';
  const inner = p.door
    ? [
        { type: 'text', text: dirTh, size: 'xxs', color: '#777777', align: 'center' },
        { type: 'text', text: `${p.door}門`, size: 'md', weight: 'bold', align: 'center', color: '#222222' },
        { type: 'text', text: `${p.star || ''}${p.god ? ' ' + p.god : ''}`, size: 'xxs', align: 'center', color: '#555555' },
      ]
    : [
        { type: 'text', text: 'กลาง', size: 'xxs', color: '#777777', align: 'center' },
        { type: 'text', text: '中', size: 'md', weight: 'bold', align: 'center', color: '#222222' },
      ];
  return { type: 'box', layout: 'vertical', flex: 1, backgroundColor: bg, cornerRadius: '6px', paddingAll: '6px', spacing: 'xs', contents: inner };
}

function dirLine(label, color, d) {
  if (!d) return null;
  const doorTh = DOOR_TH[d.door] ? `${DOOR_TH[d.door]} (${d.door})` : d.door || '';
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
      { type: 'text', text: label, size: 'sm', weight: 'bold', color, flex: 0 },
      { type: 'text', text: `${d.direction_th || d.direction} · ${doorTh}`, size: 'sm', wrap: true, flex: 1, color: '#333333' },
    ],
  };
}

function buildResultFlex(result, topic) {
  const chart = result.chart;
  const dirs = result.directions || {};
  const bestName = dirs.best && dirs.best.palace;
  const avoidName = dirs.avoid && dirs.avoid.palace;
  const from = beijingToThai(chart.time && chart.time.valid_from);
  const until = beijingToThai(chart.time && chart.time.valid_until);

  const gridRows = GRID.map((row) => ({
    type: 'box', layout: 'horizontal', spacing: 'xs', margin: 'xs',
    contents: row.map((n) => palaceCell(chart, n, bestName, avoidName)),
  }));

  const reading = (result.reading || '').trim().slice(0, 3000);
  const readingBlock = reading
    ? { type: 'text', text: reading, size: 'sm', wrap: true, color: '#333333' }
    : { type: 'text', text: 'ขออภัย ระบบเขียนคำแนะนำขัดข้องชั่วคราว แต่ผังและทิศด้านบนใช้ได้ตามปกติ (ยังไม่นับเป็นสิทธิ์ของวันนี้ ลองใหม่ภายหลังได้)', size: 'sm', wrap: true, color: '#B8322A' };

  const lines = [dirLine('✅ ทิศที่เอื้อ', '#2E7D32', dirs.best), dirLine('⚠️ ทิศที่ควรเลี่ยง', '#B8322A', dirs.avoid)].filter(Boolean);

  return {
    type: 'flex',
    altText: `ฤกษ์ยาม${topic.label}: ${dirs.best ? 'ทิศที่เอื้อ ' + (dirs.best.direction_th || '') : 'ผลฉีเหมิน'}`.slice(0, 400),
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#2F3A5F', paddingAll: '14px',
        contents: [
          { type: 'text', text: `🧭 ฤกษ์ยาม · ${topic.label}`, weight: 'bold', size: 'lg', color: '#FFFFFF' },
          { type: 'text', text: from && until ? `ผังนี้ใช้ได้ ${from}–${until} น. (เวลาไทย)` : 'ผังฉีเหมินตามเวลาปัจจุบัน', size: 'xs', color: '#D9DEEF', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '14px',
        contents: [
          { type: 'box', layout: 'vertical', contents: gridRows },
          { type: 'text', text: 'ผัง: ทิศใต้อยู่ด้านบน · เขียว = ทิศที่เอื้อ · แดง = ทิศควรเลี่ยง', size: 'xxs', color: '#999999', wrap: true },
          ...(lines.length ? [{ type: 'box', layout: 'vertical', spacing: 'xs', contents: lines }] : []),
          { type: 'separator' },
          { type: 'text', text: 'คำแนะนำ', weight: 'bold', size: 'sm', color: '#2F3A5F' },
          readingBlock,
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '10px',
        contents: [{ type: 'text', text: 'เพื่อความบันเทิงและเป็นแนวทางประกอบการตัดสินใจเท่านั้น', size: 'xxs', color: '#999999', wrap: true, align: 'center' }],
      },
    },
  };
}

let defaultLimiter = null;
function getDefaultLimiter() {
  if (!defaultLimiter) {
    const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
    defaultLimiter = createFileLimiter({
      file: path.join(dir, 'qimen_draws.json'),
      salt: process.env.LINE_CHANNEL_SECRET || 'siamsi',
    });
  }
  return defaultLimiter;
}


const inFlight = new Set();

const publicBase = () => (process.env.PUBLIC_BASE_URL || 'https://line.dr-huk.com').replace(/\/+$/, '');
const quick = (label, text) => ({ type: 'action', action: { type: 'message', label, text } });

function limitMessages(payOn, price) {
  const msg = { type: 'text', text: QIMEN_LIMIT_TEXT };
  if (payOn) {
    msg.text += `\nต้องการดูเพิ่มตอนนี้ ชำระ ${price} บาท ต่อ 1 ครั้งได้ที่ปุ่มด้านล่างค่ะ`;
    msg.quickReply = { items: [quick(`💳 ดูเพิ่ม ${price} บาท`, BUY_TEXT)] };
  }
  return [msg];
}

function thaiClock(ms) {
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(ms));
}

function buildPayFlex(order, price) {
  const imgUrl = order.qr.type === 'url' ? order.qr.url : `${publicBase()}/qr/${encodeURIComponent(order.id)}.png`;
  return {
    type: 'flex',
    altText: `ชำระเงิน ${price} บาท เพื่อดูฤกษ์ยามเพิ่ม 1 ครั้ง`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#2F3A5F', paddingAll: '14px',
        contents: [
          { type: 'text', text: `💳 ดูฤกษ์ยามเพิ่ม · ${price} บาท`, weight: 'bold', size: 'lg', color: '#FFFFFF' },
          { type: 'text', text: 'ชำระด้วย QR Code (พร้อมเพย์/แอปธนาคาร)', size: 'xs', color: '#D9DEEF', margin: 'xs' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '14px',
        contents: [
          { type: 'image', url: imgUrl, size: 'full', aspectMode: 'fit', aspectRatio: '1:1' },
          { type: 'text', text: `⏳ QR ใช้ได้ถึง ${thaiClock(order.expires || (order.created + pay.REUSE_MS))} น. (10 นาที)`, size: 'sm', weight: 'bold', color: '#B8322A', wrap: true },
          { type: 'text', text: `1. บันทึกรูป QR หรือสแกนจากอีกเครื่อง แล้วจ่าย ${price} บาท ผ่านแอปธนาคาร\n2. จ่ายเสร็จระบบแจ้งในแชทนี้อัตโนมัติ ได้สิทธิ์ดูฤกษ์ยาม 1 ครั้ง (ไม่หมดอายุตอนเที่ยงคืน)\n3. ถ้ายังไม่ได้รับแจ้งใน 1 นาที กดปุ่ม "ตรวจสถานะ" ด้านล่าง`, size: 'sm', wrap: true, color: '#444444' },
          { type: 'text', text: `รหัสอ้างอิง ${order.id}`, size: 'xxs', color: '#999999', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', paddingAll: '10px',
        contents: [{ type: 'button', style: 'secondary', height: 'sm', action: { type: 'message', label: '🔄 ตรวจสถานะ', text: CHECK_TEXT } }],
      },
    },
  };
}

const ERR_PAY = 'ขออภัย ระบบชำระเงินขัดข้องชั่วคราว ลองใหม่อีกครั้งภายหลังนะคะ (ยังไม่มีการตัดเงินจากคุณ) 🙏';

async function handleBuy(userId, opts) {
  const c = pay.payConfig();
  if (!c.enabled) return [{ type: 'text', text: 'บริการดูฤกษ์ยามเพิ่มเติมยังไม่เปิดให้ใช้งานค่ะ 🙏' }];
  if (!userId) return [{ type: 'text', text: 'การชำระเงินใช้ได้เฉพาะในแชทส่วนตัวกับบัญชีนี้ค่ะ 🙏' }];
  const store = opts.payStore || pay.getDefaultPayStore();
  const key = `pay:${userId}`;
  if (inFlight.has(key)) return [{ type: 'text', text: 'กำลังสร้างรายการชำระเงินอยู่ค่ะ รอสักครู่นะคะ 🙏' }];
  inFlight.add(key);
  try {
    const now = Date.now();
    const fresh = store.getPending(userId, now).filter((o) => now - o.created < pay.REUSE_MS).pop();
    if (fresh) return [buildPayFlex(fresh, c.price)];
    let order;
    try {
      order = await pay.createOrder(opts.fetchFn);
    } catch (err) {
      console.error('qimen pay create error:', err.message);
      return [{ type: 'text', text: ERR_PAY }];
    }
    order.created = Date.now();
    order.uid = userId;
    store.addPending(userId, order);
    return [buildPayFlex(order, c.price)];
  } finally {
    inFlight.delete(key);
  }
}

// ตรวจออเดอร์เดียว: คืน 'granted' | 'paid-used' | 'waiting' | 'notfound' หรือโยน error
// หลัง await ตรวจซ้ำว่ายังไม่ถูกใช้ แล้วให้เครดิตทันที (ไม่มี await คั่น) จึงไม่ให้ซ้ำแม้เรียกซ้อนกัน
async function grantIfPaid(store, userId, o, fetchFn) {
  const st = await pay.orderStatus(o.id, fetchFn);
  if (st !== 'paid') return st;
  let result = 'paid-used';
  if (!store.isConsumed(o.id)) {
    store.markConsumed(o.id);
    store.addCredit(userId, 1);
    result = 'granted';
  }
  store.removePending(userId, o.id);
  return result;
}

const PAID_MESSAGES = (n) => [
  { type: 'text', text: `✅ ได้รับการชำระเงินแล้วค่ะ ขอบคุณมาก คุณมีสิทธิ์ดูฤกษ์ยาม ${n} ครั้ง เลือกหัวข้อได้เลย` },
  buildTopicMenuFlex(),
];

// webhook: gateway แจ้งว่าออเดอร์นี้อาจจ่ายแล้ว ยืนยันกับ Ksher ผ่าน gateway อีกครั้ง แล้วแจ้งผู้ใช้ด้วย push
// opts: { payStore, fetchFn, push(uid, messages) }
async function settleOrder(orderId, opts = {}) {
  const store = opts.payStore || pay.getDefaultPayStore();
  const owner = store.findOwner(orderId);
  if (!owner) return 'unknown';
  const key = `pay:${owner.uid}`;
  if (inFlight.has(key)) return 'busy';
  inFlight.add(key);
  try {
    let r;
    try {
      r = await grantIfPaid(store, owner.uid, owner.order, opts.fetchFn);
    } catch (err) {
      console.error('qimen settle error:', err.message);
      return 'error';
    }
    if (r === 'granted' && opts.push) {
      try {
        await opts.push(owner.uid, PAID_MESSAGES(store.credits(owner.uid)));
      } catch (err) {
        console.error('qimen push error:', err.message);
      }
    }
    return r;
  } finally {
    inFlight.delete(key);
  }
}

async function handleCheck(userId, opts) {
  const c = pay.payConfig();
  if (!c.enabled) return [{ type: 'text', text: 'บริการดูฤกษ์ยามเพิ่มเติมยังไม่เปิดให้ใช้งานค่ะ 🙏' }];
  if (!userId) return [{ type: 'text', text: 'การชำระเงินใช้ได้เฉพาะในแชทส่วนตัวกับบัญชีนี้ค่ะ 🙏' }];
  const store = opts.payStore || pay.getDefaultPayStore();
  const buyReply = { items: [quick(`💳 ดูเพิ่ม ${c.price} บาท`, BUY_TEXT)] };
  const pending = store.getPending(userId);
  if (pending.length === 0) {
    const n = store.credits(userId);
    if (n > 0) return [{ type: 'text', text: `คุณมีสิทธิ์ดูฤกษ์ยามที่ชำระแล้วคงเหลือ ${n} ครั้ง เลือกหัวข้อได้เลยค่ะ` }, buildTopicMenuFlex()];
    return [{ type: 'text', text: 'ยังไม่มีรายการรอชำระเงินค่ะ ต้องการดูเพิ่มพิมพ์ "ซื้อฤกษ์ยาม" ได้เลย', quickReply: buyReply }];
  }
  const key = `pay:${userId}`;
  if (inFlight.has(key)) return [{ type: 'text', text: 'กำลังตรวจสอบอยู่ค่ะ รอสักครู่นะคะ 🙏' }];
  inFlight.add(key);
  try {
    let granted = 0; let failed = false; let notFound = 0; let waiting = 0;
    for (const o of pending) {
      let r;
      try {
        r = await grantIfPaid(store, userId, o, opts.fetchFn);
      } catch (err) {
        console.error('qimen pay status error:', err.message);
        failed = true; continue;
      }
      if (r === 'granted') granted += 1;
      else if (r === 'notfound') { notFound += 1; console.error('qimen pay: ไม่พบออเดอร์ที่ gateway', o.id); }
      else if (r === 'waiting') waiting += 1;
    }
    if (granted > 0) return PAID_MESSAGES(store.credits(userId));
    const again = { items: [quick('🔄 ตรวจอีกครั้ง', CHECK_TEXT)] };
    if (failed) return [{ type: 'text', text: 'ตรวจสอบสถานะไม่สำเร็จชั่วคราว กดตรวจอีกครั้งในอีกสักครู่นะคะ หากจ่ายแล้วเงินไม่หาย สิทธิ์ของคุณยังอยู่ค่ะ 🙏', quickReply: again }];
    if (notFound === pending.length) {
      return [{ type: 'text', text: `ไม่พบรายการนี้ในระบบ หากคุณชำระเงินแล้ว กรุณาส่งรหัสอ้างอิงนี้ให้แอดมินตรวจสอบค่ะ\n${pending.map((o) => o.id).join('\n')}` }];
    }
    const now = Date.now();
    const alive = pending.filter((o) => now < (o.expires || (o.created + pay.REUSE_MS)));
    if (waiting > 0 && alive.length === 0) {
      return [{ type: 'text', text: 'QR นี้หมดเวลาแล้วค่ะ (เกิน 10 นาที) หากยังไม่ได้จ่าย ขอ QR ใหม่ได้ที่ปุ่มด้านล่างนะคะ', quickReply: buyReply }];
    }
    return [{ type: 'text', text: 'ยังไม่พบการชำระเงินค่ะ หากเพิ่งจ่าย รอสักครู่แล้วกดตรวจอีกครั้งนะคะ', quickReply: again }];
  } finally {
    inFlight.delete(key);
  }
}

// คืน array ของ message หรือ null ถ้าข้อความนี้ไม่เกี่ยวกับฉีเหมิน
// opts: { limiter, payStore, fetchFn, now, onStart }
async function handleQimenText(text, userId, opts = {}) {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;

  if (t === BUY_TEXT) return handleBuy(userId, opts);
  if (t === CHECK_TEXT) return handleCheck(userId, opts);

  const picked = TOPIC_PICK.exec(t);
  const topic = picked ? TOPIC_BY_LABEL[picked[1].trim()] : null;
  if (!topic && !MENU_TRIGGER.test(t)) return null;

  if (!isEnabled()) {
    return [{ type: 'text', text: 'บริการดูฤกษ์ยามยังไม่เปิดให้ใช้งานในขณะนี้ค่ะ 🙏' }];
  }

  const c = pay.payConfig();
  const lim = opts.limiter || getDefaultLimiter();
  const store = opts.payStore || (c.enabled ? pay.getDefaultPayStore() : null);
  const today = bangkokDate(opts.now || new Date());
  const usedFree = Boolean(userId) && lim.hasDrawn(userId, today);
  const credits = c.enabled && userId && store ? store.credits(userId) : 0;

  if (!topic) {
    if (!usedFree) return [buildTopicMenuFlex()];
    if (credits > 0) return [{ type: 'text', text: `วันนี้ใช้สิทธิ์ฟรีไปแล้ว แต่คุณมีสิทธิ์ที่ชำระแล้วคงเหลือ ${credits} ครั้ง เลือกหัวข้อได้เลยค่ะ` }, buildTopicMenuFlex()];
    return limitMessages(c.enabled, c.price);
  }

  const usePaid = usedFree;
  if (usePaid && credits <= 0) return limitMessages(c.enabled, c.price);

  const key = userId || 'anonymous';
  if (inFlight.has(key)) return [{ type: 'text', text: 'กำลังจัดผังให้อยู่ค่ะ รอสักครู่นะคะ 🙏' }];

  inFlight.add(key);
  try {
    if (opts.onStart) opts.onStart();
    let result;
    try {
      result = await fetchReading(topic.key, opts.fetchFn);
    } catch (err) {
      console.error('qimen gateway error:', err.message);
      const keep = usePaid ? 'สิทธิ์ที่ชำระแล้วของคุณยังอยู่' : 'ยังไม่นับเป็นสิทธิ์ของวันนี้';
      return [{ type: 'text', text: `ขออภัย ระบบฉีเหมินขัดข้องชั่วคราว ลองใหม่อีกครั้งภายหลังนะคะ (${keep}) 🙏` }];
    }
    if (!result.chart || !result.chart.palaces) {
      const keep = usePaid ? 'สิทธิ์ที่ชำระแล้วของคุณยังอยู่' : 'ยังไม่นับเป็นสิทธิ์ของวันนี้';
      return [{ type: 'text', text: `ขออภัย ได้รับข้อมูลผังไม่ครบ ลองใหม่อีกครั้งนะคะ (${keep}) 🙏` }];
    }
    // ตัดสิทธิ์เฉพาะเมื่อได้ทั้งผังและคำแนะนำ
    const delivered = Boolean(result.reading && result.reading.trim());
    if (delivered) {
      if (usePaid) {
        if (store.useCredit(userId)) pay.logSale(topic.key, opts.fetchFn);
      } else if (userId) {
        lim.tryDraw(userId, today);
      }
    }
    return [buildResultFlex(result, topic)];
  } finally {
    inFlight.delete(key);
  }
}

module.exports = {
  handleQimenText, settleOrder, buildTopicMenuFlex, buildResultFlex, buildPayFlex, fetchReading, beijingToThai,
  TOPICS, QIMEN_LIMIT_TEXT, BUY_TEXT, CHECK_TEXT, isEnabled,
};
