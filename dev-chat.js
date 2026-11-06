// จำลองแชทในเทอร์มินัล ไม่ต้องใช้ LINE / token / อินเทอร์เน็ต: npm run chat
const readline = require('readline');
const { handleText, HELP_TEXT } = require('./fortune');
const { createMemoryLimiter } = require('./draws');
const limiter = createMemoryLimiter();

function show(m) {
  if (m.type === 'text') return console.log(`\n🤖 ${m.text}\n`);
  if (m.type === 'flex') {
    const c = m.contents;
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
rl.on('line', (line) => {
  if (/^(exit|quit)$/i.test(line.trim())) return rl.close();
  if (/^reset$/i.test(line.trim())) { limiter.reset(); console.log('\n(ล้างสิทธิ์การเสี่ยงของวันนี้แล้ว)\n'); return rl.prompt(); }
  const msgs = handleText(line, userId, new Date(), limiter);
  if (!msgs) console.log('\n(บอทไม่ตอบ — ปล่อยให้แอดมินตอบ)\n');
  else msgs.forEach(show);
  rl.prompt();
});
