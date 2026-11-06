#!/usr/bin/env bash
# ตั้งค่า Droplet (Ubuntu 22.04/24.04) ให้รันบอท LINE เซียมซี ที่ line.dr-huk.com
# ปลอดภัยกับเซิร์ฟเวอร์ที่มีเว็บเดิมอยู่: ไม่แตะ nginx config เดิม เพิ่มเฉพาะไฟล์ของโดเมนนี้
#
# วิธีใช้ (รันในโฟลเดอร์โปรเจกต์บน droplet):  sudo bash deploy/setup.sh
set -euo pipefail

DOMAIN="${DOMAIN:-line.dr-huk.com}"
APP_NAME="${APP_NAME:-drhuk-line}"
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_PORT="${APP_PORT:-3010}"            # พอร์ตภายในเครื่อง (nginx จะส่งต่อมาที่นี่)
CERT_EMAIL="${CERT_EMAIL:-}"            # อีเมลสำหรับ Let's Encrypt (แนะนำให้ใส่)

[ "$(id -u)" -eq 0 ] || { echo "ต้องรันด้วย sudo"; exit 1; }

if ss -ltn "( sport = :$APP_PORT )" | grep -q LISTEN; then
  echo "พอร์ต $APP_PORT ถูกใช้อยู่แล้ว ลองรัน: APP_PORT=3011 sudo -E bash deploy/setup.sh"; exit 1
fi

echo "==> 1/6 ติดตั้งแพ็กเกจพื้นฐาน"
apt-get update -y
apt-get install -y curl ca-certificates gnupg git

need_node=1
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 18 ]; then need_node=0; fi
if [ "$need_node" -eq 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
command -v nginx   >/dev/null 2>&1 || apt-get install -y nginx
command -v certbot >/dev/null 2>&1 || apt-get install -y certbot python3-certbot-nginx
command -v pm2     >/dev/null 2>&1 || npm install -g pm2

echo "==> 2/6 ติดตั้ง dependencies ของบอท ($APP_DIR)"
cd "$APP_DIR"
npm ci --omit=dev || npm install --omit=dev

echo "==> 3/6 ตั้งค่าไฟล์ .env"
if [ ! -f .env ]; then
  SECRET="${LINE_CHANNEL_SECRET:-}"; TOKEN="${LINE_CHANNEL_ACCESS_TOKEN:-}"
  [ -n "$SECRET" ] || read -rsp "LINE_CHANNEL_SECRET: " SECRET; echo
  [ -n "$TOKEN" ]  || read -rsp "LINE_CHANNEL_ACCESS_TOKEN: " TOKEN; echo
  umask 077
  printf 'LINE_CHANNEL_SECRET=%s\nLINE_CHANNEL_ACCESS_TOKEN=%s\nPORT=%s\n' "$SECRET" "$TOKEN" "$APP_PORT" > .env
else
  grep -q '^PORT=' .env && sed -i "s/^PORT=.*/PORT=$APP_PORT/" .env || echo "PORT=$APP_PORT" >> .env
  echo ".env มีอยู่แล้ว (ตั้ง PORT=$APP_PORT ให้)"
fi
chmod 600 .env

echo "==> 4/6 รันด้วย pm2 (ฟื้นเองเมื่อล่มและเมื่อรีบูตเครื่อง)"
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
pm2 start ecosystem.config.js --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "==> 5/6 ตั้งค่า nginx สำหรับ $DOMAIN"
CONF="/etc/nginx/sites-available/$DOMAIN"
cat > "$CONF" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 1m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
    }
}
NGINX
ln -sf "$CONF" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t
systemctl reload nginx

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null || true
fi

echo "==> 6/6 ขอใบรับรอง HTTPS (DNS ของ $DOMAIN ต้องชี้มาที่เครื่องนี้แล้ว)"
CERT_ARGS=(--nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect)
if [ -n "$CERT_EMAIL" ]; then CERT_ARGS+=(-m "$CERT_EMAIL"); else CERT_ARGS+=(--register-unsafely-without-email); fi
certbot "${CERT_ARGS[@]}" || {
  echo "ขอใบรับรองไม่สำเร็จ ตรวจ DNS แล้วรันซ้ำ: sudo certbot --nginx -d $DOMAIN"; exit 1; }

echo
echo "เสร็จแล้ว ✅"
echo "  ทดสอบ:   curl -I https://$DOMAIN/privacy"
echo "  Webhook: https://$DOMAIN/webhook"
echo "  ดู log:  pm2 logs $APP_NAME"
