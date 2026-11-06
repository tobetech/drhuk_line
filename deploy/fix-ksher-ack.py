import sys
p = sys.argv[1]
s = open(p, encoding="utf-8").read()
JSON = '{"result": "SUCCESS", "msg": "OK"}'
a = '''        threading.Thread(target=_forward_to_bot, args=(m.group(0),), daemon=True).start()
    return "SUCCESS"
'''
b_old = 'ack = os.environ.get("KSHER_NOTIFY_ACK", "SUCCESS")'
new_a = '''        threading.Thread(target=_forward_to_bot, args=(m.group(0),), daemon=True).start()
    ack = os.environ.get("KSHER_NOTIFY_ACK", '{"result": "SUCCESS", "msg": "OK"}')
    return app.response_class(ack, mimetype="application/json")
'''
if a in s:
    s = s.replace(a, new_a, 1); print("fixed (แบบที่ 1)")
elif b_old in s:
    s = s.replace(b_old, 'ack = os.environ.get("KSHER_NOTIFY_ACK", \'' + JSON + '\')', 1); print("fixed (แบบที่ 2)")
else:
    sys.exit("ไม่พบจุดที่ต้องแก้ ส่งโค้ดฟังก์ชัน v1_ksher_notify มาให้ดู")
open(p, "w", encoding="utf-8").write(s)
