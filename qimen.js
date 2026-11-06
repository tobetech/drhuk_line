// ดูฤกษ์ยามฉีเหมิน: เรียกเซิร์ฟเวอร์กลาง (gateway) ให้คำนวณผังและเขียนคำแนะนำ แล้วส่งกลับเป็น Flex card
// จำกัดวันละ 1 ครั้งต่อผู้ใช้ (แยกจากเซียมซี) และนับสิทธิ์เมื่อได้คำตอบสำเร็จเท่านั้น
const path = require('path');
const { createFileLimiter } = require('./draws');
const { bangkokDate } = require('./fortune');

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

// คืน array ของ message หรือ null ถ้าข้อความนี้ไม่เกี่ยวกับฉีเหมิน
// opts: { limiter, fetchFn, now, onStart }
async function handleQimenText(text, userId, opts = {}) {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;

  const pick = TOPIC_PICK.exec(t);
  const topic = pick ? TOPIC_BY_LABEL[pick[1].trim()] : null;
  if (!topic && !MENU_TRIGGER.test(t)) return null;

  if (!isEnabled()) {
    return [{ type: 'text', text: 'บริการดูฤกษ์ยามยังไม่เปิดให้ใช้งานในขณะนี้ค่ะ 🙏' }];
  }

  const lim = opts.limiter || getDefaultLimiter();
  const today = bangkokDate(opts.now || new Date());
  const limitMsg = [{ type: 'text', text: QIMEN_LIMIT_TEXT }];

  if (!topic) {
    if (userId && lim.hasDrawn(userId, today)) return limitMsg;
    return [buildTopicMenuFlex()];
  }

  const key = userId || 'anonymous';
  if (userId && lim.hasDrawn(userId, today)) return limitMsg;
  if (inFlight.has(key)) return [{ type: 'text', text: 'กำลังจัดผังให้อยู่ค่ะ รอสักครู่นะคะ 🙏' }];

  inFlight.add(key);
  try {
    if (opts.onStart) opts.onStart();
    let result;
    try {
      result = await fetchReading(topic.key, opts.fetchFn);
    } catch (err) {
      console.error('qimen gateway error:', err.message);
      return [{ type: 'text', text: 'ขออภัย ระบบฉีเหมินขัดข้องชั่วคราว ลองใหม่อีกครั้งภายหลังนะคะ (ยังไม่นับเป็นสิทธิ์ของวันนี้) 🙏' }];
    }
    if (!result.chart || !result.chart.palaces) {
      return [{ type: 'text', text: 'ขออภัย ได้รับข้อมูลผังไม่ครบ ลองใหม่อีกครั้งนะคะ (ยังไม่นับเป็นสิทธิ์ของวันนี้) 🙏' }];
    }
    // นับสิทธิ์เฉพาะเมื่อได้ทั้งผังและคำแนะนำ
    if (userId && result.reading && result.reading.trim()) lim.tryDraw(userId, today);
    return [buildResultFlex(result, topic)];
  } finally {
    inFlight.delete(key);
  }
}

module.exports = { handleQimenText, buildTopicMenuFlex, buildResultFlex, fetchReading, beijingToThai, TOPICS, QIMEN_LIMIT_TEXT, isEnabled };
