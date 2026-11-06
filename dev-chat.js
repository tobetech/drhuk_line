// จำลองแชทในเทอร์มินัล ไม่ต้องใช้ LINE / token / อินเทอร์เน็ต: npm run chat
const readline = require('readline');
const { handleText, HELP_TEXT } = require('./fortune');
const { createMemoryLimiter } = require('./draws');
const { handleQimenText } = require('./qimen');
process.env.QIMEN_LICENSE_KEY = process.env.QIMEN_LICENSE_KEY || 'dev';
const qLimiter = createMemoryLimiter();
// ถ้าไม่ได้ตั้ง QIMEN_REAL=1 จะใช้ผลจำลอง ไม่เรียก gateway จริง
const mockFetch = async () => ({ ok: true, status: 200, json: async () => ({ reading: '(คำแนะนำจำลองจาก AI)', directions: { best: { direction: 'NW', direction_th: 'ทิศตะวันตกเฉียงเหนือ', door: '杜', palace: '乾' }, avoid: { direction: 'W', direction_th: 'ทิศตะวันตก', door: '傷', palace: '兌' } }, chart: { time: { valid_from: '2026-11-06 11:00', valid_until: '2026-11-06 13:00' }, palaces: Object.fromEntries('巽離坤震兌艮坎乾'.split('').map((n) => [n, { door: '開', star: '芮', god: '虎', direction: 'S' }]).concat([['中', {}]])) } }) });
const limiter = createMemoryLimiter();

function show(m) {
  if (m.type === 'text') return console.log(`\n🤖 ${m.text}\n`);
  if (m.type === 'flex') {
    const c = m.contents;
    if (c.header && c.header.contents[0].text.includes('ฤกษ์')) return console.log('\n🤖 [การ์ดฤกษ์ยาม] ' + m.altText + '\n');
    if (!c.header) return console.log(`\n🤖 [ภาพเคลื่อนไหวกระบอกเซียมซีเขย่า] ${m.altText}\n   [ปุ่ม] 🎋 เปิดใบทำนาย  (พิมพ์ "เปิดใบทำนาย" เพื่อกดปุ่ม)\n`);
    const t = (b) => b.contents.filter((x) => x.type === 'text').map((x) => x.text);
    console.log('\n🤖 [การ์ด Flex]');
    console.log('  ' + t(c.header).join(' | '));
    c.body.contents.forEach((x) => {
      if (x.type === 'text' && x.size !== 'xxs') console.log('  ' + x.text.replace(/\n/g, '\n  '));
      if (x.type === 'box') console.log('  ' + t(x).join(': '));
    });
    console.log('');
  }
}

const userId = process.argv[2] || 'U_local_test';
console.log(`จำลองผู้ใช้ ${userId} (พิมพ์ reset เพื่อล้างสิทธิ์วันนี้, exit เพื่อออก)\n`);
show({ type: 'text', text: HELP_TEXT });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'คุณ> ' });
rl.prompt();
rl.on('line', async (line) => {
  if (/^(exit|quit)$/i.test(line.trim())) return rl.close();
  if (/^reset$/i.test(line.trim())) { limiter.reset(); qLimiter.reset(); console.log('\n(ล้างสิทธิ์การเสี่ยงของวันนี้แล้ว)\n'); return rl.prompt(); }
  const q = await handleQimenText(line, userId, { limiter: qLimiter, fetchFn: process.env.QIMEN_REAL ? undefined : mockFetch });
  const msgs = q || handleText(line, userId, new Date(), limiter);
  if (!msgs) console.log('\n(บอทไม่ตอบ — ปล่อยให้แอดมินตอบ)\n');
  else msgs.forEach(show);
  rl.prompt();
});
