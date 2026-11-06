const path = require('path');
const { FORTUNES, LEVELS } = require('./fortunes');
const { createFileLimiter } = require('./draws');

// ที่อยู่สาธารณะของบอท ใช้ประกอบ URL รูปแอนิเมชัน (LINE ต้องดึงรูปผ่าน HTTPS)
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || 'https://line.dr-huk.com').replace(/\/+$/, '');

const REVEAL_TEXT = 'เปิดใบทำนาย';

const DISCLAIMER = 'คำทำนายเพื่อความบันเทิงและเป็นกำลังใจ โปรดใช้วิจารณญาณในการตัดสินใจเรื่องสำคัญ';

// วันที่ตามเวลาไทย (YYYY-MM-DD)
function bangkokDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(now);
}

// FNV-1a hash
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ผู้ใช้คนเดิมในวันเดียวกันได้ใบเดิม (กันการเขย่าซ้ำจนกว่าจะได้ใบที่ชอบ)
function pickDaily(userId, now = new Date()) {
  const idx = hash(`${userId}|${bangkokDate(now)}`) % FORTUNES.length;
  return FORTUNES[idx];
}

function pickRandom() {
  return FORTUNES[Math.floor(Math.random() * FORTUNES.length)];
}

function getByNumber(n) {
  return FORTUNES[n - 1] || null;
}

function row(label, text) {
  return {
    type: 'box',
    layout: 'vertical',
    margin: 'md',
    spacing: 'xs',
    contents: [
      { type: 'text', text: label, size: 'sm', weight: 'bold', color: '#8B5A2B' },
      { type: 'text', text, size: 'sm', wrap: true, color: '#333333' },
    ],
  };
}

function buildFlex(f) {
  const lv = LEVELS[f.level];
  return {
    type: 'flex',
    altText: `เซียมซีใบที่ ${f.no}: ${f.title} (${lv.label})`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: lv.color,
        paddingAll: 'lg',
        contents: [
          { type: 'text', text: `เซียมซีใบที่ ${f.no}`, color: '#FFFFFF', size: 'sm', align: 'center' },
          { type: 'text', text: f.title, color: '#FFFFFF', size: 'xl', weight: 'bold', align: 'center', wrap: true, margin: 'sm' },
          { type: 'text', text: `${lv.emoji} ดวง${lv.label}`, color: '#FFFFFF', size: 'md', align: 'center', margin: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFF8E7',
        paddingAll: 'lg',
        contents: [
          { type: 'text', text: f.poem, wrap: true, size: 'sm', align: 'center', color: '#5A3E1B', style: 'italic' },
          { type: 'separator', margin: 'lg' },
          row('💼 การงาน', f.work),
          row('💰 การเงิน', f.money),
          row('❤️ ความรัก', f.love),
          row('🌱 สุขภาพ', f.health),
          { type: 'separator', margin: 'lg' },
          { type: 'text', text: DISCLAIMER, size: 'xxs', color: '#999999', wrap: true, margin: 'md' },
        ],
      },
    },
  };
}

// การ์ดตอน "กำลังเขย่า" มีภาพกระบอกเซียมซีขยับได้ (APNG ต้องไม่เกิน 300 KB ตามข้อกำหนดของ LINE)
function buildShakeFlex() {
  return {
    type: 'flex',
    altText: '🙏 ตั้งจิตอธิษฐาน... กำลังเขย่ากระบอกเซียมซี 🎋',
    contents: {
      type: 'bubble',
      size: 'kilo',
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '0px',
        backgroundColor: '#FFF3D6',
        contents: [
          {
            type: 'image',
            url: `${PUBLIC_BASE_URL}/assets/shake.png`,
            size: 'full',
            aspectRatio: '4:3',
            aspectMode: 'cover',
            animated: true,
          },
          {
            type: 'box',
            layout: 'vertical',
            paddingAll: 'md',
            spacing: 'xs',
            contents: [
              { type: 'text', text: '🙏 ตั้งจิตอธิษฐาน...', align: 'center', weight: 'bold', color: '#8F2320' },
              { type: 'text', text: 'กำลังเขย่ากระบอกเซียมซี 🎋', align: 'center', size: 'sm', color: '#5A3E1B' },
            ],
          },
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#FFF3D6',
        paddingTop: '0px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#B8322A',
            height: 'sm',
            action: { type: 'message', label: '🎋 เปิดใบทำนาย', text: REVEAL_TEXT },
          },
        ],
      },
    },
  };
}

const HELP_TEXT = [
  '🙏 ยินดีต้อนรับสู่เซียมซีออนไลน์ (60 ใบ)',
  '',
  'พิมพ์คำสั่งได้เลย:',
  '• "เสี่ยงเซียมซี" – รับคำทำนายประจำวัน',
  '• "วิธีใช้" – ดูข้อความนี้อีกครั้ง',
  '',
  'จำกัดการเสี่ยงวันละ 1 ครั้ง (รีเซ็ตเที่ยงคืนเวลาไทย)',
  'ตั้งจิตอธิษฐานก่อนเสี่ยงทุกครั้งนะคะ 🪷',
].join('\n');

const LIMIT_TEXT = [
  '🙏 จำกัดการเสี่ยงวันละ 1 ครั้ง',
  'วันนี้คุณเสี่ยงเซียมซีไปแล้ว พรุ่งนี้มาเสี่ยงใหม่ได้ตั้งแต่เที่ยงคืนค่ะ',
  'ดูใบของวันนี้ซ้ำได้ที่ปุ่มด้านล่าง',
].join('\n');

const LIMIT_QUICK_REPLY = {
  items: [{ type: 'action', action: { type: 'message', label: '🎋 เปิดใบวันนี้อีกครั้ง', text: REVEAL_TEXT } }],
};

const QUICK_REPLY = {
  items: [
    { type: 'action', action: { type: 'message', label: '🎋 เสี่ยงเซียมซี', text: 'เสี่ยงเซียมซี' } },
    { type: 'action', action: { type: 'message', label: '❓ วิธีใช้', text: 'วิธีใช้' } },
  ],
};

function withQuickReply(msg) {
  return { ...msg, quickReply: QUICK_REPLY };
}

let defaultLimiter = null;
function getDefaultLimiter() {
  if (!defaultLimiter) {
    const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
    defaultLimiter = createFileLimiter({
      file: path.join(dir, 'draws.json'),
      salt: process.env.LINE_CHANNEL_SECRET || 'siamsi',
    });
  }
  return defaultLimiter;
}

// รับข้อความ คืน array ของ message ที่จะตอบกลับ (หรือ null ถ้าไม่ต้องตอบ)
function handleText(text, userId, now = new Date(), limiter) {
  const t = (text || '').trim().replace(/\s+/g, ' ');
  if (!t) return null;

  // ดูใบตามเลข ปิดไว้เพราะเลี่ยงข้อจำกัดวันละ 1 ครั้งได้ (เปิดด้วย ALLOW_LOOKUP=true)
  if (process.env.ALLOW_LOOKUP === 'true') {
    const num = t.match(/^(?:ใบที่|ใบ|เบอร์)?\s*(\d{1,3})$/);
    if (num) {
      const f = getByNumber(Number(num[1]));
      if (!f) return [withQuickReply({ type: 'text', text: 'มีเซียมซีให้เลือกเฉพาะใบที่ 1 ถึง 60 ค่ะ 🙏' })];
      return [buildFlex(f)];
    }
  }

  // เปิดดูใบที่ได้ (กดจากปุ่มในการ์ดเขย่า) ใช้ได้เฉพาะคนที่เสี่ยงวันนี้แล้ว และได้ใบเดิมเสมอ
  if (t === REVEAL_TEXT) {
    const lim = limiter || getDefaultLimiter();
    if (userId && !lim.hasDrawn(userId, bangkokDate(now))) {
      return [withQuickReply({ type: 'text', text: 'วันนี้ยังไม่ได้เสี่ยงเซียมซีเลยค่ะ พิมพ์ "เสี่ยงเซียมซี" เพื่อเริ่มได้เลย 🙏' })];
    }
    return [buildFlex(pickDaily(userId || 'anonymous', now))];
  }

  if (/เสี่ยง|เซียมซี|ดูดวง|ทำนาย|เขย่า/.test(t)) {
    if (userId) {
      const lim = limiter || getDefaultLimiter();
      if (!lim.tryDraw(userId, bangkokDate(now))) {
        return [{ type: 'text', text: LIMIT_TEXT, quickReply: LIMIT_QUICK_REPLY }];
      }
    }
    // ส่งการ์ดเขย่าก่อน แล้วให้ผู้ใช้กดปุ่มเปิดใบ จะได้ไม่พลาดการดูภาพเขย่า
    return [buildShakeFlex()];
  }

  if (/^(วิธีใช้|เมนูเซียมซี|help)$/i.test(t)) {
    return [withQuickReply({ type: 'text', text: HELP_TEXT })];
  }

  return null; // ข้อความอื่น ปล่อยให้แอดมินตอบเอง
}

module.exports = { handleText, buildFlex, buildShakeFlex, pickDaily, pickRandom, getByNumber, bangkokDate, HELP_TEXT, LIMIT_TEXT, REVEAL_TEXT };
