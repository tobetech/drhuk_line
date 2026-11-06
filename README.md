# บอทเสี่ยงเซียมซี 60 ใบ สำหรับ LINE OA

บอทตอบกลับด้วย Flex Message สวยงาม แสดงเลขใบ ชื่อใบ ระดับดวง กลอน และคำทำนาย 4 ด้าน (การงาน การเงิน ความรัก สุขภาพ)

## คำสั่งที่ผู้ใช้พิมพ์ได้
| ข้อความ | ผลลัพธ์ |
|---|---|
| เสี่ยงเซียมซี / ดูดวง / เขย่า | เสี่ยงเซียมซี **วันละ 1 ครั้งต่อคน** (รีเซ็ตเที่ยงคืนเวลาไทย) ครั้งที่ 2 ขึ้นข้อความ "จำกัดการเสี่ยงวันละ 1 ครั้ง" |
| วิธีใช้ | แสดงวิธีใช้ (ส่งอัตโนมัติเมื่อมีคนเพิ่มเพื่อนด้วย) |

ข้อความอื่นๆ บอทจะไม่ตอบ เพื่อให้แอดมินคุยกับลูกค้าเองได้ตามปกติ

การจำกัดสิทธิ์เก็บในไฟล์ `data/draws.json` (เฉพาะรหัสผู้ใช้ที่ hash แล้วของวันนี้ ข้ามวันล้างเอง) เปลี่ยนที่เก็บได้ด้วย `DATA_DIR`
ตัวเลือก `ALLOW_LOOKUP=true` เปิดการดูใบตามเลข (`ใบที่ 12`) ซึ่งจะเลี่ยงข้อจำกัดได้ จึงปิดไว้เป็นค่าเริ่มต้น

## ติดตั้ง
```bash
npm install
cp .env.example .env     # ใส่ค่า Channel secret และ Channel access token
npm start                # รันที่พอร์ต 3000
npm test                 # ทดสอบ
```

## ตั้งค่าใน LINE
1. LINE Developers Console → สร้าง Provider และ Messaging API channel (หรือเปิด Messaging API ใน LINE OA Manager)
2. แท็บ Messaging API: ออก **Channel access token (long-lived)** และคัดลอก **Channel secret** จากแท็บ Basic settings ไปใส่ใน `.env`
3. ตั้ง **Webhook URL** เป็น `https://โดเมนของคุณ/webhook` แล้วเปิด **Use webhook** กด Verify
4. ใน LINE OA Manager → ตั้งค่าการตอบกลับ: **ปิดข้อความตอบกลับอัตโนมัติ** และ **เปิด Webhook**
   (ข้อความต้อนรับของ LINE ปิดได้ เพราะบอทส่งวิธีใช้ให้เอง)
5. (แนะนำ) สร้าง Rich Menu ปุ่ม "เสี่ยงเซียมซี" เป็นแอ็กชันแบบ *ข้อความ* ส่งคำว่า `เสี่ยงเซียมซี`

## นำขึ้นออนไลน์
LINE ต้องการ HTTPS สาธารณะ ใช้ได้ทั้ง Render, Railway, Fly.io, Google Cloud Run หรือ VPS + nginx
ทดสอบในเครื่องด้วย `ngrok http 3000` แล้วนำ URL มาใส่เป็น Webhook

## แก้ไขคำทำนาย
แก้ที่ `fortunes.js` (อาร์เรย์เดียว ใบละหนึ่งบรรทัด) ระบบจะเช็คว่าต้องมี 60 ใบพอดี
ตัวเลขระดับ: 1 ดีเยี่ยม, 2 ดี, 3 กลางๆ, 4 ควรระวัง

## ภาพเคลื่อนไหวตอน "กำลังเขย่า" และ Rich Menu
- ตอนเสี่ยง บอทส่งการ์ดภาพกระบอกเซียมซีเขย่า (APNG `public/assets/shake.png`, ต้องไม่เกิน 300 KB ตามข้อกำหนดของ LINE) เล่น 2 รอบแล้วหยุด พร้อมปุ่ม "เปิดใบทำนาย" ผู้ใช้กดปุ่มแล้วจึงขึ้นการ์ดคำทำนาย (แยก 2 จังหวะเพื่อไม่ให้การ์ดทำนายบังภาพเขย่า และไม่นับโควตา push เพราะเป็นการตอบกลับ) กดเปิดซ้ำได้ใบเดิมของวันนี้
- ภาพจะขยับเฉพาะผู้ใช้ที่เปิด "เล่นไฟล์ GIF อัตโนมัติ" ใน LINE (ตั้งค่า → แชท) ถ้าปิดไว้จะเห็นเป็นภาพนิ่ง
- URL ภาพใช้ `PUBLIC_BASE_URL` (ค่าเริ่มต้น `https://line.dr-huk.com`) ตั้งใหม่ใน `.env` ถ้าเปลี่ยนโดเมน
- สร้างภาพใหม่ด้วย `python3 tools/make_assets.py` (ต้องมี Pillow และฟอนต์ไทย) ได้ทั้ง `shake.png` และ `richmenu/richmenu.jpg` (2500×843)

## หน้านโยบายและข้อกำหนด
บอทเสิร์ฟหน้า `/privacy` และ `/terms` ให้อัตโนมัติ (ไฟล์ใน `public/`) เมื่อชี้โดเมน dr-huk.com มาที่เซิร์ฟเวอร์นี้
จะได้ `https://dr-huk.com/privacy` และ `https://dr-huk.com/terms`
**ก่อนใช้จริง** ให้ค้นหาและแก้ข้อความใน `[ ]` ทั้งหมด (ชื่อผู้ให้บริการ อีเมล วันที่ ผู้ให้บริการโฮสติ้ง)
นำ URL ไปใส่ที่ LINE Developers Console แท็บ Basic settings (Privacy policy URL / Terms of use URL)
และใน OA Manager หน้าโปรไฟล์ได้

## หมายเหตุ
เนื้อหาคำทำนายทั้ง 60 ใบเขียนขึ้นใหม่เพื่อโปรเจกต์นี้ ไม่ได้คัดลอกจากใบเซียมซีของวัดใด หากต้องการใช้ตำรับของวัดที่ถือลิขสิทธิ์หรือมีผู้ดูแล ควรขออนุญาตก่อน

## Deploy บน Vercel (ทางเลือกแทน ngrok / Render)
```bash
npm i -g vercel
vercel login
vercel                 # ครั้งแรก ตอบคำถามตามค่าเริ่มต้น
vercel env add LINE_CHANNEL_SECRET
vercel env add LINE_CHANNEL_ACCESS_TOKEN
vercel --prod
```
จะได้ URL เช่น `https://siamsi-bot.vercel.app` → ตั้ง Webhook เป็น `https://siamsi-bot.vercel.app/webhook`
ใช้โดเมนตัวเองได้ที่ Vercel → Project → Settings → Domains (เช่น `bot.dr-huk.com`)

## Deploy บน DigitalOcean Droplet (nginx + pm2 + Let's Encrypt)
1. DNS: สร้าง **A record** ชื่อ `line` ชี้ไปที่ IP ของ droplet (ไม่แตะ record เดิมของ `@` / `www`)
2. บน droplet: `git clone https://github.com/tobetech/drhuk_line.git /opt/drhuk_line && cd /opt/drhuk_line`
   (repo private ต้องใช้ deploy key หรือ token — หรืออัปโหลดด้วย `rsync -av --exclude node_modules ./ root@IP:/opt/drhuk_line/`)
3. `sudo CERT_EMAIL=you@example.com bash deploy/setup.sh` (สคริปต์จะถามรหัส LINE ถ้ายังไม่มี .env)
4. ตั้ง Webhook ใน LINE เป็น `https://line.dr-huk.com/webhook`
5. อัปเดตครั้งต่อไป: `bash deploy/update.sh`

ตัวแปรที่ปรับได้: `DOMAIN`, `APP_PORT` (ค่าเริ่มต้น 3010), `CERT_EMAIL`
