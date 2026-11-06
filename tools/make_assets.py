#!/usr/bin/env python3
"""สร้างภาพกระบอกเซียมซีเขย่า (APNG) และรูป Rich Menu
ใช้: python3 tools/make_assets.py   (ต้องมี Pillow และฟอนต์ Loma หรือแก้ FONT_BOLD)
ผลลัพธ์: public/assets/shake.png , richmenu/richmenu.jpg
"""
import math, os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT_BOLD = os.environ.get('FONT_BOLD', '/usr/share/fonts/opentype/tlwg/Loma-Bold.otf')
W, H, S = 480, 360, 3          # ขนาดภาพจริง และตัวคูณวาดละเอียด
PIVOT = (240, 330)
CREAM = (255, 243, 214)

def font(px):
    return ImageFont.truetype(FONT_BOLD, int(px))

def fit_font(text, px, max_w):
    """ลดขนาดฟอนต์ลงจนข้อความกว้างไม่เกิน max_w"""
    while px > 20 and font(px).getlength(text) > max_w:
        px -= 2
    return font(px)

def canister_layer(rattle=None):
    """วาดกระบอกเซียมซีตั้งตรง ขนาด (W*S, H*S) พื้นโปร่งใส"""
    rattle = rattle or [0] * 9
    im = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = lambda *v: [int(x * S) for x in v]
    RED, DRED, LRED = (184, 50, 42), (143, 35, 32), (222, 98, 80)
    GOLD, LGOLD, DARK = (227, 178, 60), (246, 215, 122), (58, 28, 20)

    # ตัวกระบอก
    d.rounded_rectangle(s(185, 135, 295, 322), radius=16 * S, fill=RED)
    d.rounded_rectangle(s(194, 152, 204, 300), radius=5 * S, fill=LRED)
    d.rounded_rectangle(s(274, 152, 288, 300), radius=6 * S, fill=DRED)
    # แถบทอง บน/ล่าง
    d.rounded_rectangle(s(180, 128, 300, 152), radius=9 * S, fill=GOLD)
    d.rounded_rectangle(s(180, 300, 300, 326), radius=9 * S, fill=GOLD)
    for x in range(196, 290, 16):
        d.ellipse(s(x - 2, 138, x + 2, 142), fill=LGOLD)
        d.ellipse(s(x - 2, 311, x + 2, 315), fill=LGOLD)
    # เหรียญกลาง + ข้อความ
    d.ellipse(s(206, 194, 274, 262), fill=GOLD)
    d.ellipse(s(212, 200, 268, 256), fill=(125, 25, 25))
    f = font(19 * S)
    d.text(s(240, 228), 'เซียมซี', font=f, fill=LGOLD, anchor='mm')

    # ปากกระบอก (วงรีสีเข้ม) แล้วไม้เซียมซีโผล่ขึ้นมา
    d.ellipse(s(190, 121, 290, 137), fill=DARK)
    lengths = [x - 35 for x in [105, 117, 99, 123, 109, 95, 119, 107, 101]]   # สั้นลงเพื่อให้ไม้ที่โผล่ไม่ชนขอบภาพ
    for i in range(9):
        xb = 204 + 9 * i
        a = math.radians((i - 4) * 3.4)
        L = lengths[i] + rattle[i]
        body = (235, 211, 163) if i % 2 == 0 else (221, 191, 134)
        pts = [(-3.6, 0), (3.6, 0), (3.6, -L), (-3.6, -L)]
        def rot(p):
            lx, ly = p
            return (xb + lx * math.cos(a) - ly * math.sin(a), 130 + lx * math.sin(a) + ly * math.cos(a))
        d.polygon([tuple(v * S for v in rot(p)) for p in pts], fill=body, outline=(176, 141, 85))
        tip = [(-3.6, -L), (3.6, -L), (3.6, -L + 15), (-3.6, -L + 15)]
        d.polygon([tuple(v * S for v in rot(p)) for p in tip], fill=(192, 57, 43))
    # ขอบหน้าของปากกระบอกบังโคนไม้
    d.pieslice(s(190, 121, 290, 137), 0, 180, fill=GOLD)
    d.arc(s(190, 121, 290, 137), 0, 180, fill=(176, 130, 40), width=S)
    return im

def sparkle(d, cx, cy, r, col):
    pts = []
    for k in range(8):
        ang = math.pi / 4 * k - math.pi / 2
        rr = r if k % 2 == 0 else r * 0.28
        pts.append((cx + rr * math.cos(ang), cy + rr * math.sin(ang)))
    d.polygon(pts, fill=col)

N_FRAMES = 24          # 0-12 เขย่าเต็มแรง, 13-20 แผ่วลง, 21-23 นิ่งและไม้โผล่
PLAYS = 2              # เล่น 2 รอบแล้วหยุดที่เฟรมสุดท้าย

def make_frame(i, n=N_FRAMES):
    ph = 2 * math.pi * i / 8                      # 8 เฟรมต่อการเขย่า 1 รอบ
    env = 1.0 if i <= 12 else max(0.0, 1.0 - (i - 12) / 8.0)   # แรงเขย่าค่อยๆ ลดลง
    pop = {19: 6, 20: 18, 21: 30, 22: 36, 23: 34}.get(i, 0)     # ไม้ใบที่ 4 โผล่ขึ้นมา
    rattle = [9 * env * math.sin(ph + k * 0.9) for k in range(9)]
    rattle[3] += pop
    layer = canister_layer(rattle)
    ang = 13 * env * math.sin(ph)
    dx, dy = 12 * env * math.sin(ph), -6 * env * abs(math.sin(ph))
    bg = Image.new('RGBA', (W * S, H * S), CREAM + (255,))
    d = ImageDraw.Draw(bg, 'RGBA')
    sh = 70 - 8 * env * abs(math.sin(ph))
    d.ellipse([int((240 + dx * 0.5 - sh) * S), int(334 * S), int((240 + dx * 0.5 + sh) * S), int(352 * S)], fill=(214, 190, 140, 150))
    boost = 1.0 + (0.8 if i >= 20 else 0)          # ประกายเด่นขึ้นตอนได้ใบ
    for k, (cx, cy) in enumerate([(78, 84), (414, 104), (392, 262), (66, 246), (330, 52)]):
        r = (5 + 6 * (0.5 + 0.5 * math.sin(ph + k * 1.7))) * boost
        sparkle(d, cx * S, cy * S, r * S, (242, 193, 78, 255))
    v = abs(math.cos(ph)) * env
    if v > 0.05:
        col = (205, 160, 80, int(40 + 190 * v))
        for side in (-1, 1):
            for j in range(3):
                x0 = 240 + side * (92 + j * 17)
                d.line([(int(x0 * S), int((178 + j * 6) * S)), (int((x0 + side * 6) * S), int(222 * S)), (int(x0 * S), int((266 - j * 6) * S))], fill=col, width=4 * S, joint='curve')
    rot = layer.rotate(ang, center=(PIVOT[0] * S, PIVOT[1] * S), resample=Image.BICUBIC, translate=(int(dx * S), int(dy * S)))
    bg.alpha_composite(rot)
    return bg.resize((W, H), Image.LANCZOS).convert('RGB')

def build_apng(path, n=N_FRAMES, delay=90, hold=1500):
    frames = [make_frame(i, n) for i in range(n)]
    pal = [f.quantize(colors=40, method=Image.MEDIANCUT, dither=Image.NONE) for f in frames]
    durations = [delay] * (n - 1) + [hold]         # เฟรมสุดท้ายค้างไว้
    pal[0].save(path, save_all=True, append_images=pal[1:], duration=durations, loop=PLAYS, format='PNG', optimize=True)
    return frames

def build_richmenu(path):
    RW, RH = 2500, 843
    im = Image.new('RGB', (RW, RH))
    px = im.load()
    for y in range(RH):                        # พื้นหลังแดงไล่เฉด ด้านซ้าย
        for x in range(1250):
            k = 0.5 * (y / RH) + 0.5 * (x / 1250)
            px[x, y] = (int(176 - 48 * k), int(40 - 14 * k), int(36 - 12 * k))
    d = ImageDraw.Draw(im)
    d.rectangle([1250, 0, RW, RH], fill=CREAM)       # ด้านขวาครีม
    GOLD, LGOLD, DREDT = (227, 178, 60), (246, 215, 122), (143, 35, 32)
    # ไอคอนกระบอกเซียมซี (ซ้าย)
    ic = canister_layer().crop((150 * S, 34 * S, 330 * S, 336 * S))
    th = 700
    ic = ic.resize((int(ic.width * th / ic.height), th), Image.LANCZOS)
    im.paste(ic, (90, (RH - th) // 2), ic)
    # ข้อความซ้าย
    d.text((520, 330), 'เสี่ยงเซียมซี', font=fit_font('เสี่ยงเซียมซี', 150, 640), fill=LGOLD, anchor='lm')
    d.text((526, 500), 'วันละ 1 ครั้ง  แตะเพื่อเริ่ม', font=fit_font('วันละ 1 ครั้ง  แตะเพื่อเริ่ม', 62, 640), fill=(255, 226, 190), anchor='lm')
    # ด้านขวา: วิธีใช้
    d.ellipse([1450, 190, 1710, 450], fill=DREDT)
    d.text((1580, 322), '?', font=font(190), fill=LGOLD, anchor='mm')
    d.text((1850, 300), 'วิธีใช้', font=fit_font('วิธีใช้', 150, 520), fill=DREDT, anchor='lm')
    d.text((1850, 470), 'ดูคำสั่งทั้งหมด', font=fit_font('ดูคำสั่งทั้งหมด', 58, 520), fill=(120, 80, 60), anchor='lm')
    # เส้นแบ่ง + กรอบทอง
    d.rectangle([1246, 0, 1254, RH], fill=GOLD)
    d.rectangle([0, RH - 14, RW, RH], fill=GOLD)
    d.rectangle([0, 0, RW, 10], fill=GOLD)
    im.save(path, 'JPEG', quality=92, optimize=True)

def build_richmenu3(path):
    """Rich Menu 3 ปุ่ม: เสี่ยงเซียมซี | ดูฤกษ์ยาม | วิธีใช้ (แต่ละปุ่มกว้าง ~833 px)"""
    RW, RH = 2500, 843
    X1, X2 = 833, 1666
    im = Image.new('RGB', (RW, RH))
    px = im.load()
    for y in range(RH):
        for x in range(RW):
            if x < X1:                                   # ซ้าย: แดงไล่เฉด
                k = 0.5 * (y / RH) + 0.5 * (x / X1)
                px[x, y] = (int(176 - 48 * k), int(40 - 14 * k), int(36 - 12 * k))
            elif x < X2:                                 # กลาง: น้ำเงินกรมท่าไล่เฉด
                k = 0.5 * (y / RH) + 0.5 * ((x - X1) / (X2 - X1))
                px[x, y] = (int(54 - 20 * k), int(66 - 22 * k), int(112 - 36 * k))
            else:
                px[x, y] = CREAM                         # ขวา: ครีม
    d = ImageDraw.Draw(im)
    GOLD, LGOLD, DREDT = (227, 178, 60), (246, 215, 122), (143, 35, 32)

    # ปุ่ม 1: กระบอกเซียมซี
    ic = canister_layer().crop((150 * S, 34 * S, 330 * S, 336 * S))
    th = 400
    ic = ic.resize((int(ic.width * th / ic.height), th), Image.LANCZOS)
    im.paste(ic, ((X1 - ic.width) // 2, 70), ic)
    d.text((X1 // 2, 560), 'เสี่ยงเซียมซี', font=fit_font('เสี่ยงเซียมซี', 110, 700), fill=LGOLD, anchor='mm')
    d.text((X1 // 2, 690), 'วันละ 1 ครั้ง', font=fit_font('วันละ 1 ครั้ง', 56, 700), fill=(255, 226, 190), anchor='mm')

    # ปุ่ม 2: ผังเก้าวัง (3x3) เน้นช่องหนึ่ง
    cx, size, gap = (X1 + X2) // 2, 112, 14
    gx0 = cx - (3 * size + 2 * gap) // 2
    gy0 = 90
    for r in range(3):
        for c in range(3):
            x0, y0 = gx0 + c * (size + gap), gy0 + r * (size + gap)
            on = (r, c) == (0, 2)
            d.rounded_rectangle([x0, y0, x0 + size, y0 + size], radius=14,
                                fill=GOLD if on else (92, 104, 156), outline=LGOLD if on else None, width=4)
            if (r, c) == (1, 1):
                m = x0 + size / 2, y0 + size / 2
                d.polygon([(m[0], m[1] - 30), (m[0] + 30, m[1]), (m[0], m[1] + 30), (m[0] - 30, m[1])], fill=LGOLD)
    d.text((cx, 560), 'ดูฤกษ์ยาม', font=fit_font('ดูฤกษ์ยาม', 110, 700), fill=LGOLD, anchor='mm')
    d.text((cx, 690), 'ดูทิศ ดูจังหวะตามเวลา', font=fit_font('ดูทิศ ดูจังหวะตามเวลา', 56, 700), fill=(222, 228, 245), anchor='mm')

    # ปุ่ม 3: วิธีใช้
    cx3 = (X2 + RW) // 2
    d.ellipse([cx3 - 130, 100, cx3 + 130, 360], fill=DREDT)
    d.text((cx3, 232), '?', font=font(190), fill=LGOLD, anchor='mm')
    d.text((cx3, 560), 'วิธีใช้', font=fit_font('วิธีใช้', 110, 700), fill=DREDT, anchor='mm')
    d.text((cx3, 690), 'ดูคำสั่งทั้งหมด', font=fit_font('ดูคำสั่งทั้งหมด', 56, 700), fill=(120, 80, 60), anchor='mm')

    # เส้นแบ่ง + กรอบทอง
    for x in (X1, X2):
        d.rectangle([x - 4, 0, x + 4, RH], fill=GOLD)
    d.rectangle([0, RH - 14, RW, RH], fill=GOLD)
    d.rectangle([0, 0, RW, 10], fill=GOLD)
    im.save(path, 'JPEG', quality=92, optimize=True)

if __name__ == '__main__':
    os.makedirs(os.path.join(ROOT, 'public', 'assets'), exist_ok=True)
    os.makedirs(os.path.join(ROOT, 'richmenu'), exist_ok=True)
    apng = os.path.join(ROOT, 'public', 'assets', 'shake.png')
    frames = build_apng(apng)
    print('APNG', os.path.getsize(apng) // 1024, 'KB', len(frames), 'frames')
    rm = os.path.join(ROOT, 'richmenu', 'richmenu.jpg')
    build_richmenu(rm)
    print('Rich menu', os.path.getsize(rm) // 1024, 'KB')
    rm3 = os.path.join(ROOT, 'richmenu', 'richmenu3.jpg')
    build_richmenu3(rm3)
    print('Rich menu 3 ปุ่ม', os.path.getsize(rm3) // 1024, 'KB')
    # แผ่นตรวจดูเฟรม (ไม่ได้ใช้งานจริง)
    sheet = Image.new('RGB', (W * 4, H * 2))
    for i, k in enumerate([0, 3, 9, 14, 18, 20, 22, 23]):
        sheet.paste(frames[k], ((i % 4) * W, (i // 4) * H))
    sheet.save('/tmp/shake_sheet.png')
