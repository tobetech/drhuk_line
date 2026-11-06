#!/usr/bin/env python3
"""แพตช์ gateway_server.py (ฝั่งเซิร์ฟเวอร์ qimen) เพื่อ:
1) status ใช้ได้ทุก worker: ออเดอร์ qimen... ที่ไม่อยู่ในหน่วยความจำ ให้ถาม Ksher ตรงๆ
2) create รับ notify/expire_seconds: ตั้ง notify_url และปิดออเดอร์ที่ยังไม่จ่ายเมื่อหมดเวลา (order_close)
3) POST /v1/ksher/notify: รับ callback ของ Ksher แล้วส่งสัญญาณไปบอท LINE (เซ็น HMAC) ไม่เชื่อเนื้อหา callback
ใช้: python3 gateway-webhook-patch.py /opt/qimen-gateway/gateway_server.py"""
import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
assert "/v1/ksher/notify" not in s, "แพตช์นี้ถูกใช้ไปแล้ว"

# 1) status: ไม่ 404 ถ้ารูปแบบรหัสถูกต้อง
old = '''    if order_id not in _qr_orders:
        return jsonify({"error": "ไม่พบรายการนี้"}), 404
'''
new = '''    if order_id not in _qr_orders:
        # gunicorn หลาย worker ไม่ได้ใช้หน่วยความจำร่วมกัน: ออเดอร์รูปแบบ qimen<epoch><hex6> ให้ถาม Ksher ตรงๆ
        if not re.match(r"^qimen\\d{10}[0-9a-f]{6}$", order_id):
            return jsonify({"error": "ไม่พบรายการนี้"}), 404
        _qr_orders[order_id] = {"paid": False, "license_key": license_key}
'''
assert s.count(old) == 1
s = s.replace(old, new, 1)

# 2) create: notify_url + ตั้งเวลาปิด
assert s.count('"notify_url": "",') == 1
s = s.replace('"notify_url": "",', '"notify_url": _notify_url_for(data),', 1)
old = '''    _qr_orders[order_id] = {"paid": False, "license_key": license_key}

    return jsonify({"order_id": order_id, "qr_display": qr_display, "amount": price})'''
new = '''    _qr_orders[order_id] = {"paid": False, "license_key": license_key}
    try:
        ttl = int(data.get("expire_seconds") or 0)
    except (TypeError, ValueError):
        ttl = 0
    if 60 <= ttl <= 1800:
        _schedule_close(client, order_id, ttl)

    return jsonify({"order_id": order_id, "qr_display": qr_display, "amount": price})'''
assert s.count(old) == 1
s = s.replace(old, new, 1)

helpers = '''def _notify_url_for(data):
    """บอท LINE ขอ webhook (notify=true) ตู้เดิมไม่ส่ง จึงไม่กระทบ"""
    if data.get("notify") and os.environ.get("LINE_BOT_NOTIFY_URL"):
        return os.environ.get("GATEWAY_PUBLIC_URL", "https://qimen.tobe-tech.com").rstrip("/") + "/v1/ksher/notify"
    return ""


def _schedule_close(client, order_id, seconds):
    """หมดเวลาแล้วถ้ายังไม่จ่าย ปิดออเดอร์ที่ Ksher เพื่อให้ QR ใช้จ่ายไม่ได้อีก"""
    def run():
        try:
            if _qr_orders.get(order_id, {}).get("paid"):
                return
            res = _as_dict(client.order_query({"mch_order_no": order_id}))
            inner = res.get("data", res)
            if str(inner.get("result", "")).upper() == "SUCCESS":
                return
            print("Ksher order_close:", _as_dict(client.order_close({"mch_order_no": order_id})))
        except Exception:
            traceback.print_exc()
    t = threading.Timer(seconds, run)
    t.daemon = True
    t.start()


def _forward_to_bot(order_id):
    """ส่งสัญญาณ 'ออเดอร์นี้อาจจ่ายแล้ว' ไปบอท LINE บอทจะถามยืนยันกับ Ksher เองอีกครั้ง"""
    import hmac, hashlib, requests
    url = os.environ.get("LINE_BOT_NOTIFY_URL")
    secret = os.environ.get("LINE_BOT_NOTIFY_SECRET")
    if not url or not secret:
        return
    ts = str(int(time.time()))
    sig = hmac.new(secret.encode(), f"{ts}.{order_id}".encode(), hashlib.sha256).hexdigest()
    try:
        r = requests.post(url, json={"order_id": order_id, "ts": ts},
                          headers={"X-Notify-Signature": sig}, timeout=15)
        print("forward to bot:", order_id, r.status_code)
    except Exception as e:
        print("forward to bot failed:", order_id, e)


@app.route("/v1/ksher/notify", methods=["POST"])
def v1_ksher_notify():
    raw = request.get_data(as_text=True)[:4000]
    print("Ksher notify received, bytes:", len(raw))
    m = re.search(r"qimen\\d{10}[0-9a-f]{6}", raw)
    if m:
        threading.Thread(target=_forward_to_bot, args=(m.group(0),), daemon=True).start()
    # Ksher ต้องการคำตอบเป็น JSON {"result": "SUCCESS", "msg": "OK"} ไม่เช่นนั้นจะส่งซ้ำสูงสุด 12 ครั้ง
    ack = os.environ.get("KSHER_NOTIFY_ACK", '{"result": "SUCCESS", "msg": "OK"}')
    return app.response_class(ack, mimetype="application/json")


'''
marker = '@app.route("/v1/qr-payment/create", methods=["POST"])'
assert s.count(marker) == 1
s = s.replace(marker, helpers + marker, 1)
open(p, "w", encoding="utf-8").write(s)
print("patched")
