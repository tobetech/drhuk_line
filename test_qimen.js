const assert = require('assert');
process.env.LINE_CHANNEL_SECRET = 'test-secret';
process.env.QIMEN_LICENSE_KEY = 'TEST-KEY';

const { handleQimenText, beijingToThai, buildResultFlex, TOPICS } = require('./qimen');
const { createMemoryLimiter } = require('./draws');

// ตัวอย่างผลจริงจาก gateway (/v1/line-reading) ย่อเฉพาะที่บอทใช้
const P = (name, palace, direction, door, star, god) => ({ name, palace, direction, door, star, god, sky_stem: 'x', earth_stem: 'y' });
const SAMPLE = {
  ai_ok: true,
  reading: 'วันนี้ช่วงนี้เหมาะกับการวางแผนการเงินอย่างรอบคอบ หลีกเลี่ยงการตัดสินใจรีบร้อน',
  chart: {
    time: { beijing: '2026-11-06 12:36', valid_from: '2026-11-06 11:00', valid_until: '2026-11-06 13:00' },
    palaces: {
      巽: P('巽', 4, 'SE', '開', '芮', '虎'), 離: P('離', 9, 'S', '休', '柱', '合'), 坤: P('坤', 2, 'SW', '生', '心', '陰'),
      震: P('震', 3, 'E', '驚', '英', '玄'), 中: { name: '中', palace: 5, direction: 'C', door: null, star: null, god: null },
      兌: P('兌', 7, 'W', '傷', '蓬', '蛇'), 艮: P('艮', 8, 'NE', '死', '輔', '地'), 坎: P('坎', 1, 'N', '景', '沖', '天'),
      乾: P('乾', 6, 'NW', '杜', '任', '符'),
    },
  },
  directions: {
    best: { direction: 'NW', direction_th: 'ทิศตะวันตกเฉียงเหนือ', door: '杜', palace: '乾', score: 3 },
    avoid: { direction: 'W', direction_th: 'ทิศตะวันตก', door: '傷', palace: '兌', score: -3 },
  },
};
const okFetch = (calls) => async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return { ok: true, status: 200, json: async () => SAMPLE };
};

(async () => {
  const lim = createMemoryLimiter();
  const now = new Date('2026-11-06T03:00:00Z');

  // เวลาปักกิ่ง -> ไทย ลบ 1 ชั่วโมง ข้ามวันได้
  assert.strictEqual(beijingToThai('2026-11-06 11:00'), '10:00');
  assert.strictEqual(beijingToThai('2026-11-07 00:30'), '23:30');

  // ข้อความที่ไม่เกี่ยว ไม่ตอบ และไม่เรียก gateway
  const calls = [];
  assert.strictEqual(await handleQimenText('เสี่ยงเซียมซี', 'U1', { limiter: lim, now, fetchFn: okFetch(calls) }), null);
  assert.strictEqual(await handleQimenText('สวัสดีครับ', 'U1', { limiter: lim, now, fetchFn: okFetch(calls) }), null);
  assert.strictEqual(calls.length, 0);

  // เมนูหัวข้อ: 6 ปุ่ม ข้อความตรงกับที่ parser รับ
  const menu = await handleQimenText('ดูฤกษ์ยาม', 'U1', { limiter: lim, now, fetchFn: okFetch(calls) });
  assert.strictEqual(menu.length, 1);
  const buttons = JSON.stringify(menu[0]).match(/"text":"ดูฤกษ์ [^"]+"/g);
  assert.strictEqual(buttons.length, 6);
  assert.strictEqual(calls.length, 0, 'แค่เปิดเมนูต้องไม่เรียก gateway');

  // เลือกหัวข้อ: เรียก gateway ด้วย license/machine/topic ที่ถูก ได้การ์ดผล
  const res = await handleQimenText('ดูฤกษ์ การเงิน', 'U1', { limiter: lim, now, fetchFn: okFetch(calls) });
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/v1/line-reading'));
  assert.deepStrictEqual(calls[0].body, { license_key: 'TEST-KEY', machine_id: 'line-bot', topic: 'money' });
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].type, 'flex');
  const j = JSON.stringify(res[0]);
  assert.ok(j.includes('10:00–12:00'), 'ต้องแสดงช่วงเวลาไทย');
  assert.ok(j.includes('ทิศตะวันตกเฉียงเหนือ') && j.includes('ทิศตะวันตก'));
  assert.ok(j.includes(SAMPLE.reading));
  assert.ok(res[0].altText.length <= 400);
  // ช่องผัง 9 ช่อง เรียงทิศใต้อยู่บน: แถวแรกต้องเป็น SE, S, SW
  const body = res[0].contents.body.contents[0].contents;
  assert.strictEqual(body.length, 3);
  assert.ok(JSON.stringify(body[0]).includes('ตอ.ใต้') && JSON.stringify(body[0]).includes('ตต.ใต้'));
  assert.ok(JSON.stringify(body[2]).includes('ตอ.เหนือ'));
  assert.ok(j.includes('#D8EFDD') && j.includes('#F6D9D6'), 'ต้องไฮไลต์ทิศเอื้อ/เลี่ยง');

  // ครั้งที่สองวันเดียวกัน ถูกจำกัด และไม่เรียก gateway ซ้ำ
  const again = await handleQimenText('ดูฤกษ์ ความรัก', 'U1', { limiter: lim, now, fetchFn: okFetch(calls) });
  assert.ok(again[0].text.includes('จำกัดการดูฤกษ์ยามวันละ 1 ครั้ง'));
  assert.strictEqual(calls.length, 1);
  const again2 = await handleQimenText('ดูฤกษ์ยาม', 'U1', { limiter: lim, now, fetchFn: okFetch(calls) });
  assert.ok(again2[0].text.includes('จำกัด'));
  // คนอื่นยังดูได้ ข้ามวันดูได้ใหม่
  assert.strictEqual((await handleQimenText('ดูฤกษ์ ภาพรวม', 'U2', { limiter: lim, now, fetchFn: okFetch(calls) }))[0].type, 'flex');
  const day2 = new Date('2026-11-07T03:00:00Z');
  assert.strictEqual((await handleQimenText('ดูฤกษ์ ภาพรวม', 'U1', { limiter: lim, now: day2, fetchFn: okFetch(calls) }))[0].type, 'flex');

  // gateway ล้มเหลว: ตอบข้อความขออภัย และไม่นับสิทธิ์ (ลองใหม่ได้)
  const lim2 = createMemoryLimiter();
  const failFetch = async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) });
  const origErr = console.error; console.error = () => {};
  const fail = await handleQimenText('ดูฤกษ์ การงาน', 'U3', { limiter: lim2, now, fetchFn: failFetch });
  const thrown = await handleQimenText('ดูฤกษ์ การงาน', 'U3', { limiter: lim2, now, fetchFn: async () => { throw new Error('timeout'); } });
  console.error = origErr;
  assert.ok(fail[0].text.includes('ขัดข้อง') && thrown[0].text.includes('ขัดข้อง'));
  assert.strictEqual(lim2.hasDrawn('U3', '2026-11-06'), false, 'ล้มเหลวต้องไม่นับสิทธิ์');
  assert.strictEqual((await handleQimenText('ดูฤกษ์ การงาน', 'U3', { limiter: lim2, now, fetchFn: okFetch([]) }))[0].type, 'flex');

  // AI ไม่ตอบ (reading ว่าง): ยังแสดงผังและทิศ แต่ไม่นับสิทธิ์
  const lim3 = createMemoryLimiter();
  const noAi = async () => ({ ok: true, status: 200, json: async () => ({ ...SAMPLE, reading: '', ai_ok: false }) });
  const r3 = await handleQimenText('ดูฤกษ์ สุขภาพ', 'U4', { limiter: lim3, now, fetchFn: noAi });
  assert.ok(JSON.stringify(r3[0]).includes('ขัดข้องชั่วคราว'));
  assert.strictEqual(lim3.hasDrawn('U4', '2026-11-06'), false);

  // กดซ้ำระหว่างรอ: ไม่ยิง gateway ซ้ำ
  const lim4 = createMemoryLimiter();
  let n = 0;
  const slow = async () => { n++; await new Promise((r) => setTimeout(r, 30)); return { ok: true, status: 200, json: async () => SAMPLE }; };
  const [a, b] = await Promise.all([
    handleQimenText('ดูฤกษ์ การเงิน', 'U5', { limiter: lim4, now, fetchFn: slow }),
    handleQimenText('ดูฤกษ์ การเงิน', 'U5', { limiter: lim4, now, fetchFn: slow }),
  ]);
  assert.strictEqual(n, 1);
  assert.ok([a, b].some((x) => x[0].type === 'text' && x[0].text.includes('กำลังจัดผัง')));

  // ไม่ตั้ง license: ปิดฟีเจอร์
  delete process.env.QIMEN_LICENSE_KEY;
  assert.ok((await handleQimenText('ดูฤกษ์ยาม', 'U1', { limiter: createMemoryLimiter(), now, fetchFn: okFetch([]) }))[0].text.includes('ยังไม่เปิด'));

  // ทุกหัวข้อสร้างการ์ดได้
  for (const t of TOPICS) JSON.parse(JSON.stringify(buildResultFlex(SAMPLE, t)));
  console.log('ผ่านการทดสอบฉีเหมิน ✅');
})().catch((e) => { console.error(e); process.exit(1); });
