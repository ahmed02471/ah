#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed-citizens.py — إدراج عشرة آلاف (10,000) مواطن حقيقي في النظام
ينشئ لكل مواطن: حساب مستخدم (users, role=CITIZEN) + طلب تسجيل (citizen_registrations)
يطابق منطق التطبيق الفعلي في src/controllers/citizenController.js بالضبط:
  - username = الرقم الوطني
  - الرقم الوطني: 12 رقم بالضبط (^\d{12}$)
  - status يبدأ pending ثم completed بعد المراجعة (REG_CHIEF)
  - review_number: رقم مكون من 6 أرقام فريد
  - password_hash: bcrypt (متوافق 100% مع bcryptjs المستخدمة في التطبيق)

تشغيل:
  pip install bcrypt --break-system-packages   # إذا لم تكن مثبتة
  python3 scripts/seed-citizens.py
"""
import sqlite3
import random
import string
import datetime
import os
import sys

try:
    import bcrypt
except ImportError:
    print("الحزمة bcrypt غير مثبتة. شغّل: pip install bcrypt --break-system-packages")
    sys.exit(1)

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "database", "traffic.db")
TOTAL = 10000
DEFAULT_PASSWORD = "Citizen@2026"
BATCH_LOG_EVERY = 1000

# ── أسماء ليبية واقعية (موسّعة لتقليل التكرار) ───────────────────────────
MALE_FIRST = [
    "أحمد","محمد","علي","عمر","خالد","سالم","مصطفى","إبراهيم","يوسف","عبدالله",
    "حسن","حسين","الطاهر","الصادق","عبدالرحمن","عبدالسلام","عبدالناصر","عبدالكريم",
    "فرج","رمضان","نوري","عادل","طارق","وليد","ياسين","معتز","أسامة","زياد",
    "بشير","صلاح","فيصل","ماجد","أنس","حمزة","سعيد","جمعة","الهادي","المهدي",
    "نصر","رضا","كمال","ناصر","عزالدين","صالح","جلال","منصور","فتحي","لطفي",
]
FEMALE_FIRST = [
    "فاطمة","عائشة","مريم","سارة","نور","هند","رقية","زينب","خديجة","آمنة",
    "سلمى","هدى","سناء","ابتسام","وفاء","أمل","ليلى","سلوى","نجاة","حنان",
    "إيمان","رحمة","سمية","نادية","فوزية","صباح","انتصار","عبير","رانيا","دلال",
    "أسماء","منى","لمياء","شيرين","رجاء","نهلة","غادة","سهام","فضيلة","حياة",
]
LAST_NAMES = [
    "الشريف","القذافي","الفيتوري","المبروك","العربي","البوسيفي","الهاشمي","العجيلي",
    "الدرسي","الورفلي","المغربي","السنوسي","الزوي","المنفي","الرياني","التارقي",
    "الفرجاني","المسماري","القطعاني","الجهني","الزنتاني","المجبري","الساعدي","البرعصي",
    "الطرابلسي","المصراتي","البنغازي","السبهاوي","الكيلاني","الشحومي","الورشفاني","الحاسي",
]
CITIES = ["سبها","مرزق","تراغن","أم الأرانب","براك الشاطئ","القطرون","غات","ودان","سبها — حي الصمود","سبها — حي المنشية"]
EMAIL_DOMAINS = ["gmail.com","yahoo.com","hotmail.com"]


def rand_full_name(gender):
    first = random.choice(MALE_FIRST if gender == "male" else FEMALE_FIRST)
    father = random.choice(MALE_FIRST)
    family = random.choice(LAST_NAMES)
    return f"{first} {father} {family}", first, family


def gen_national_id(gender, used):
    prefix = "1" if gender == "male" else "2"
    while True:
        nid = prefix + "".join(random.choice(string.digits) for _ in range(11))
        if nid not in used:
            used.add(nid)
            return nid


def gen_phone():
    return "0" + str(random.randint(91, 96)) + "".join(random.choice(string.digits) for _ in range(7))


def gen_email(first, family, seq):
    domain = random.choice(EMAIL_DOMAINS)
    base = f"{first}.{family}".replace(" ", "")
    # ترقيم لتقليل التكرار
    return f"{base}{seq}@{domain}"


def random_date_between(start, end):
    delta = end - start
    rand_seconds = random.randint(0, int(delta.total_seconds()))
    return start + datetime.timedelta(seconds=rand_seconds)


def fmt(dt):
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def main():
    if not os.path.exists(DB_PATH):
        print(f"تعذر العثور على قاعدة البيانات: {DB_PATH}")
        sys.exit(1)

    # نسخة احتياطية قبل أي تعديل
    backup_path = DB_PATH + ".pre_seed_citizens.bak"
    if not os.path.exists(backup_path):
        import shutil
        shutil.copy2(DB_PATH, backup_path)
        print(f"✅ نسخة احتياطية: {backup_path}")

    db = sqlite3.connect(DB_PATH)
    db.execute("PRAGMA journal_mode=WAL")
    cur = db.cursor()

    # تحميل القيم الموجودة لتجنب التكرار
    used_national_ids = set(r[0] for r in cur.execute("SELECT national_id FROM users"))
    used_review_numbers = set(r[0] for r in cur.execute("SELECT review_number FROM citizen_registrations"))
    reg_chiefs = [r[0] for r in cur.execute("SELECT id FROM users WHERE role='REG_CHIEF'")]
    if not reg_chiefs:
        reg_chiefs = [2]

    # كلمة سر افتراضية واحدة مُجَهَّزة مسبقاً (bcrypt) لكل المواطنين — يجب تغييرها عند أول دخول
    password_hash = bcrypt.hashpw(DEFAULT_PASSWORD.encode("utf-8"), bcrypt.gensalt(rounds=10)).decode("utf-8")

    start_date = datetime.datetime(2025, 1, 1)
    end_date = datetime.datetime(2026, 6, 17)

    print(f"⏳ جارٍ إنشاء {TOTAL} مواطن...")
    t0 = datetime.datetime.now()

    user_ids_inserted = 0
    for i in range(1, TOTAL + 1):
        gender = "male" if random.random() < 0.55 else "female"
        full_name, first, family = rand_full_name(gender)
        national_id = gen_national_id(gender, used_national_ids)
        phone = gen_phone()
        email = gen_email(first, family, 1000 + i)
        created_at = random_date_between(start_date, end_date)

        # users
        cur.execute(
            """INSERT INTO users
               (national_id, username, full_name, role, password_hash, phone, gender,
                is_active, must_change_password, created_at)
               VALUES (?,?,?,'CITIZEN',?,?,?,1,1,?)""",
            (national_id, national_id, full_name, password_hash, phone, gender, fmt(created_at)),
        )
        user_id = cur.lastrowid
        user_ids_inserted += 1

        # review_number فريد (6 أرقام)
        while True:
            review_number = str(random.randint(100000, 999999))
            if review_number not in used_review_numbers:
                used_review_numbers.add(review_number)
                break

        # حالة الطلب: أغلبها مكتملة (تمت المراجعة) وبعضها قيد الانتظار
        is_completed = random.random() < 0.85
        if is_completed:
            reviewed_by = random.choice(reg_chiefs)
            reviewed_at = fmt(created_at + datetime.timedelta(hours=random.randint(1, 72)))
            status = "completed"
        else:
            reviewed_by = None
            reviewed_at = None
            status = "pending"

        cur.execute(
            """INSERT INTO citizen_registrations
               (review_number, user_id, full_name, national_id, phone, email,
                status, reviewed_by, reviewed_at, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (review_number, user_id, full_name, national_id, phone, email,
             status, reviewed_by, reviewed_at, fmt(created_at)),
        )

        if i % BATCH_LOG_EVERY == 0:
            db.commit()
            elapsed = (datetime.datetime.now() - t0).total_seconds()
            print(f"  ✅ {i}/{TOTAL}  ({elapsed:.1f}s)")

    db.commit()

    total_users = cur.execute("SELECT COUNT(*) FROM users WHERE role='CITIZEN'").fetchone()[0]
    total_regs = cur.execute("SELECT COUNT(*) FROM citizen_registrations").fetchone()[0]
    total_completed = cur.execute("SELECT COUNT(*) FROM citizen_registrations WHERE status='completed'").fetchone()[0]
    total_pending = cur.execute("SELECT COUNT(*) FROM citizen_registrations WHERE status='pending'").fetchone()[0]

    elapsed = (datetime.datetime.now() - t0).total_seconds()
    print(f"\n✅ اكتمل في {elapsed:.1f} ثانية!")
    print(f"   👤 إجمالي مستخدمي CITIZEN في users: {total_users}")
    print(f"   📋 إجمالي طلبات citizen_registrations: {total_regs}")
    print(f"      • مكتملة: {total_completed}")
    print(f"      • قيد الانتظار: {total_pending}")
    print(f"\n🔑 كلمة السر الافتراضية لجميع المواطنين الجدد: {DEFAULT_PASSWORD}")
    print("   (يجب تغييرها عند أول تسجيل دخول — must_change_password=1)")

    db.close()


if __name__ == "__main__":
    main()
