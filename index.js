require('dotenv').config();
const path = require('path');
const express = require('express');
const line = require('@line/bot-sdk');
const { handleText, HELP_TEXT } = require('./fortune');
const { handleQimenText, settleOrder } = require('./qimen');
const { getDefaultPayStore, qrPngBuffer, verifyNotify } = require('./qimen_pay');

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
app.use('/assets', express.static(path.join(pub, 'assets'), { maxAge: '7d' }));
app.get('/style.css', (_req, res) => res.sendFile(path.join(pub, 'style.css')));

// สัญญาณจาก gateway ว่าออเดอร์อาจจ่ายแล้ว (เซ็น HMAC) ไม่เชื่อเนื้อหา แต่ยืนยันกับ Ksher ผ่าน gateway อีกครั้งก่อนให้สิทธิ์
app.post('/internal/payment-notify', express.raw({ type: '*/*', limit: '4kb' }), async (req, res) => {
  const secret = process.env.QIMEN_NOTIFY_SECRET;
  if (!secret) return res.sendStatus(503);
  let body = {};
  try { body = JSON.parse(req.body.toString('utf8')); } catch (_) { return res.sendStatus(400); }
  if (!verifyNotify(secret, body.ts, body.order_id, req.get('X-Notify-Signature'))) return res.sendStatus(401);
  const result = await settleOrder(body.order_id, {
    payStore: getDefaultPayStore(),
    fetchFn: app.get('qimenFetch'),
    push: app.get('qimenPush') || ((to, messages) => client.pushMessage({ to, messages })),
  });
  res.json({ ok: true, result });
});

// รูป QR สำหรับชำระเงิน (รหัสออเดอร์เดาไม่ได้ และมีอายุแค่ช่วงรอชำระ)
app.get('/qr/:file', async (req, res) => {
  const id = String(req.params.file).replace(/\.png$/i, '');
  const order = /^[A-Za-z0-9_-]{8,64}$/.test(id) ? getDefaultPayStore().findOrder(id) : null;
  const png = order ? await qrPngBuffer(order).catch(() => null) : null;
  if (!png) return res.sendStatus(404);
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=600' }).send(png);
});

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

  const userId = event.source?.userId;

  // ดูฤกษ์ยามฉีเหมิน (เรียกเซิร์ฟเวอร์กลาง ใช้เวลาหลายวินาที) ตอบด้วย reply token เดิมเมื่อได้ผล
  const qimen = await handleQimenText(event.message.text, userId, {
    onStart: () => {
      if (userId && event.source?.type === 'user') {
        client.showLoadingAnimation({ chatId: userId, loadingSeconds: 30 }).catch(() => {});
      }
    },
  });
  if (qimen) return client.replyMessage({ replyToken: event.replyToken, messages: qimen });

  const messages = handleText(event.message.text, userId);
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
