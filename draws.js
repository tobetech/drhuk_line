// จำกัดการเสี่ยงวันละ 1 ครั้งต่อผู้ใช้
// เก็บเฉพาะ "รหัสผู้ใช้ที่ผ่านการเข้ารหัสทางเดียว (HMAC)" ของวันนี้เท่านั้น ข้ามวันแล้วล้างทิ้งอัตโนมัติ
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function makeHasher(salt) {
  return (userId) => crypto.createHmac('sha256', salt).update(String(userId)).digest('hex').slice(0, 32);
}

// ใช้จริง: เก็บลงไฟล์ รีสตาร์ตแล้วไม่หาย
function createFileLimiter({ file, salt }) {
  const hash = makeHasher(salt);
  let state = { date: '', users: new Set() };
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    state = { date: j.date || '', users: new Set(j.users || []) };
  } catch (_) { /* ไม่มีไฟล์ = เริ่มใหม่ */ }

  function persist() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ date: state.date, users: [...state.users] }), { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (err) {
      console.error('บันทึกไฟล์จำกัดสิทธิ์ไม่สำเร็จ (ยังจำกัดในหน่วยความจำอยู่):', err.message);
    }
  }

  return {
    hasDrawn(userId, date) {
      return state.date === date && state.users.has(hash(userId));
    },
    // คืน true ถ้าเป็นการเสี่ยงครั้งแรกของวันนี้ (และบันทึกไว้) คืน false ถ้าเสี่ยงไปแล้ว
    tryDraw(userId, date) {
      if (state.date !== date) state = { date, users: new Set() };
      const h = hash(userId);
      if (state.users.has(h)) return false;
      state.users.add(h);
      persist();
      return true;
    },
  };
}

// ใช้ทดสอบ / dev-chat: เก็บในหน่วยความจำ
function createMemoryLimiter() {
  let date = '';
  let users = new Set();
  return {
    hasDrawn(userId, d) { return date === d && users.has(userId); },
    tryDraw(userId, d) {
      if (date !== d) { date = d; users = new Set(); }
      if (users.has(userId)) return false;
      users.add(userId);
      return true;
    },
    reset() { users = new Set(); },
  };
}

module.exports = { createFileLimiter, createMemoryLimiter };
