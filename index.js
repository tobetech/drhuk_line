require('dotenv').config();
const path = require('path');
const express = require('express');
const line = require('@line/bot-sdk');
const { handleText, HELP_TEXT } = require('./fortune');

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
  channelSecret: process.env.LINE_CHANNEL_SECRET || '',
};

if (!config.channelSecret) {
  console.error('ไม่พบ LINE_CHANNEL_SECRET ใน environment (.env)');
  process.exit(1);
}

const client = new line.messagingApi.MessagingApiClient({
  channelAccessToken: config.channelAccessToken,
});

const app = express();

app.get('/', (_req, res) => res.send('Siamsi LINE bot is running'));

// หน้านโยบายและข้อกำหนด: dr-huk.com/privacy และ dr-huk.com/terms
const pub = path.join(__dirname, 'public');
app.get('/privacy', (_req, res) => res.sendFile(path.join(pub, 'privacy.html')));
app.get('/terms', (_req, res) => res.sendFile(path.join(pub, 'terms.html')));
app.get('/style.css', (_req, res) => res.sendFile(path.join(pub, 'style.css')));

// middleware ตรวจ X-Line-Signature ให้อัตโนมัติ (ห้ามใส่ express.json() ก่อน route นี้)
app.post('/webhook', line.middleware({ channelSecret: config.channelSecret }), async (req, res) => {
  // รอให้ตอบกลับ LINE เสร็จก่อนค่อยส่ง 200 (จำเป็นบน serverless เช่น Vercel ที่ฟังก์ชันหยุดทันทีหลังตอบ)
  const results = await Promise.allSettled((req.body.events || []).map(handleEvent));
  for (const r of results) {
    if (r.status === 'rejected') {
      const err = r.reason;
      console.error('handleEvent error:', err?.originalError?.response?.data || err?.message || err);
    }
  }
  res.sendStatus(200);
});

async function handleEvent(event) {
  if (event.type === 'follow') {
    return client.replyMessage({
      replyToken: event.replyToken,
      messages: [{ type: 'text', text: HELP_TEXT }],
    });
  }
  if (event.type !== 'message' || event.message.type !== 'text') return;

  const messages = handleText(event.message.text, event.source?.userId);
  if (!messages) return;
  return client.replyMessage({ replyToken: event.replyToken, messages });
}

// ข้อผิดพลาดจาก middleware (เช่น signature ไม่ถูกต้อง)
app.use((err, _req, res, next) => {
  if (err instanceof line.SignatureValidationFailed) return res.status(401).send('invalid signature');
  if (err instanceof line.JSONParseError) return res.status(400).send('bad request');
  next(err);
});

const port = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(port, () => console.log(`Listening on :${port}`));
}

module.exports = app;
