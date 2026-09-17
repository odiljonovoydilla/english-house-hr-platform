"""
DATABASE — English House Mini App
===================================
SQLite — kichik markaz uchun yetarli, alohida server kerak emas.
Railway'da fayl saqlanishi uchun Volume ulash kerak (quyida DB_PATH orqali).
"""

import os
import secrets
import sqlite3
import hashlib
import hmac
import threading
from datetime import datetime, timezone, timedelta

# Server (Railway) UTC vaqtida ishlaydi, lekin kompaniya Toshkentda joylashgan (UTC+5,
# yozgi/qishki vaqtga o'tish yo'q). Barcha vaqt yozuvlari (created_at, seen_at va h.k.)
# shu vaqt zonasida saqlanishi kerak — aks holda "yaratilgan vaqt" real vaqtdan 5 soat orqada
# ko'rinadi. Doimiy UTC+5 siljish ishlatiladi (tizim/tzdata sozlamalariga bog'liq emas).
TASHKENT_TZ = timezone(timedelta(hours=5))


def tashkent_now() -> datetime:
    return datetime.now(TASHKENT_TZ)


def tashkent_today_str() -> str:
    return tashkent_now().strftime("%Y-%m-%d")

from payroll_engine import (
    DEFAULT_GRADE_RATES, DEFAULT_KPI_POOL_PERCENT, DEFAULT_AVANS_PERCENT, DEFAULT_MIN_KPI_PERCENT
)

DB_PATH = os.getenv("DB_PATH", "english_house.db")
db_dir = os.path.dirname(DB_PATH)
if db_dir:
    os.makedirs(db_dir, exist_ok=True)

class _ThreadLocalConnection:
    """
    Har bir thread uchun ALOHIDA SQLite ulanishi.

    Nega kerak: FastAPI sinxron endpoint'larni threadpool'da bajaradi, ya'ni bir vaqtning
    o'zida bir nechta so'rov turli thread'larda ishlaydi. Bitta sqlite3.Connection'ni
    thread'lar orasida ulashish "sqlite3.InterfaceError: bad parameter or other API misuse"
    xatosiga (500) olib keladi. Har bir thread o'z ulanishini olsa, bu muammo yo'qoladi.

    WAL rejimi o'qish va yozishni parallel bajarishga imkon beradi; busy_timeout esa
    bir vaqtda yozish urinishlarida darhol xato bermay, navbat kutishini ta'minlaydi.
    """

    def __init__(self, path: str):
        self._path = path
        self._local = threading.local()

    @property
    def _c(self) -> sqlite3.Connection:
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = sqlite3.connect(self._path, check_same_thread=False, timeout=30)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA busy_timeout=30000")
            self._local.conn = conn
        return conn

    def execute(self, *args, **kwargs):
        return self._c.execute(*args, **kwargs)

    def executemany(self, *args, **kwargs):
        return self._c.executemany(*args, **kwargs)

    def cursor(self):
        return self._c.cursor()

    def commit(self):
        return self._c.commit()

    def rollback(self):
        return self._c.rollback()


_conn = _ThreadLocalConnection(DB_PATH)


def now_iso():
    return tashkent_now().strftime("%Y-%m-%d %H:%M:%S")


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return f"{salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False
    try:
        salt, hex_digest = stored.split("$", 1)
    except ValueError:
        return False
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return hmac.compare_digest(digest.hex(), hex_digest)


def _add_column_if_missing(table: str, column: str, coltype: str):
    """Xavfsiz migratsiya: agar ustun mavjud bo'lmasa, qo'shadi (eski bazalar buzilmasligi uchun)."""
    cols = [r["name"] for r in _conn.execute(f"PRAGMA table_info({table})").fetchall()]
    if column not in cols:
        _conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}")
        _conn.commit()


def init_db():
    cur = _conn.cursor()

    cur.execute("""
    CREATE TABLE IF NOT EXISTS employees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT UNIQUE NOT NULL,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Teacher',   -- CEO / Director / EduManager / Teacher / Administrator / SalesManager / SubjectTeacher
        grade TEXT,                              -- T0..T5, faqat Teacher uchun
        workload_rate REAL NOT NULL DEFAULT 1.0,
        fixed_salary REAL,                       -- oylik maosh, faqat Teacher/SubjectTeacher bo'lmagan rollar uchun
        subject TEXT,                             -- fan nomi (masalan "Matematika"), faqat SubjectTeacher uchun
        revenue_percent REAL,                     -- tushumdan olinadigan ulush foizi, faqat SubjectTeacher uchun
        telegram_username TEXT,                  -- endi ishlatilmaydi, faqat tarix uchun saqlanadi
        telegram_id INTEGER UNIQUE,               -- bir martalik havola orqali avtomatik to'ldiriladi
        link_token TEXT UNIQUE,                   -- hali bog'lanmagan xodim uchun bir martalik token
        phone TEXT,                               -- +998XXXXXXXXX formatida
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT
    )
    """)

    # Eski bazalarda yo'q bo'lishi mumkin bo'lgan ustunlar (xavfsiz migratsiya)
    _add_column_if_missing("employees", "subject", "TEXT")
    _add_column_if_missing("employees", "revenue_percent", "REAL")
    _add_column_if_missing("employees", "link_token", "TEXT")
    _add_column_if_missing("employees", "phone", "TEXT")
    _add_column_if_missing("employees", "fixed_salary", "REAL")
    _add_column_if_missing("employees", "password_hash", "TEXT")
    # Login — tizimga kirish nomi. teacher_id dan ALOHIDA saqlanadi, chunki teacher_id
    # barcha jadvallarda (scorecard, bonus, topshiriq va h.k.) bog'lovchi kalit sifatida
    # ishlatiladi va o'zgarmasligi kerak; login esa xodim xohlagancha almashtirishi mumkin.
    _add_column_if_missing("employees", "login", "TEXT")
    cur.execute("UPDATE employees SET login=teacher_id WHERE login IS NULL OR login=''")
    cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_login ON employees(LOWER(login))")

    cur.execute("""
    CREATE TABLE IF NOT EXISTS scorecards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        month TEXT NOT NULL,           -- 'YYYY-MM'
        retention REAL,
        progress REAL,
        attendance REAL,
        homework REAL,
        observation REAL,
        feedback REAL,
        lms REAL,
        updated_at TEXT,
        updated_by TEXT,
        UNIQUE(teacher_id, month)
    )
    """)

    # Teacher bo'lmagan rollar (Direktor, Edu Manager, Administrator, Sotuv menejeri) uchun
    # soddalashtirilgan oylik samaradorlik foizi (7 mezonli scorecard o'rniga bitta umumiy baho)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS staff_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        month TEXT NOT NULL,
        performance_percent REAL,
        updated_at TEXT,
        updated_by TEXT,
        UNIQUE(teacher_id, month)
    )
    """)

    # Ta'lim menejeri (EduManager) uchun 6 mezonli KPI scorecard
    cur.execute("""
    CREATE TABLE IF NOT EXISTS edu_manager_scorecards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        month TEXT NOT NULL,
        retention REAL,
        teacher_performance REAL,
        student_results REAL,
        attendance REAL,
        homework REAL,
        occupancy REAL,
        report_approved INTEGER NOT NULL DEFAULT 0,
        data_honest INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT,
        updated_by TEXT,
        UNIQUE(teacher_id, month)
    )
    """)

    # Sotuv menejeri — kunlik ish faoliyati (tasdiqlash workflow'i bilan)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS sales_manager_daily_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        date TEXT NOT NULL,
        repeat_calls_archive INTEGER,
        reinvite_count INTEGER,
        new_admissions INTEGER,
        trial_booked INTEGER,
        trial_attended INTEGER,
        activated_count INTEGER,
        new_sales INTEGER,
        waiting_contact_count INTEGER,
        status TEXT NOT NULL DEFAULT 'draft',
        submitted_at TEXT,
        reviewed_at TEXT,
        reviewed_by TEXT,
        rejection_note TEXT,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(teacher_id, date)
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS bonuses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        month TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        note TEXT,
        created_at TEXT,
        created_by TEXT
    )
    """)

    cur.execute("""
    CREATE TABLE IF NOT EXISTS grade_rates (
        grade TEXT PRIMARY KEY,
        rate REAL NOT NULL
    )
    """)
    for grade, rate in DEFAULT_GRADE_RATES.items():
        cur.execute("INSERT OR IGNORE INTO grade_rates (grade, rate) VALUES (?, ?)", (grade, rate))

    cur.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
    )
    """)
    cur.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('kpi_pool_percent', ?)",
        (str(DEFAULT_KPI_POOL_PERCENT),),
    )
    cur.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('avans_percent', ?)",
        (str(DEFAULT_AVANS_PERCENT),),
    )
    cur.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES ('min_kpi_percent', ?)",
        (str(DEFAULT_MIN_KPI_PERCENT),),
    )

    # Avans (oldindan to'lov) tarixi — har oy uchun bitta yozuv
    cur.execute("""
    CREATE TABLE IF NOT EXISTS advances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        month TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        is_manual INTEGER NOT NULL DEFAULT 0,
        given_at TEXT,
        given_by TEXT,
        UNIQUE(teacher_id, month)
    )
    """)
    _add_column_if_missing("advances", "is_manual", "INTEGER")

    # Yakuniy hisob-kitob (Rashchyot) to'lovi — Avans kabi, lekin oy oxiridagi yakuniy summa uchun
    cur.execute("""
    CREATE TABLE IF NOT EXISTS settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        month TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        is_manual INTEGER NOT NULL DEFAULT 0,
        given_at TEXT,
        given_by TEXT,
        UNIQUE(teacher_id, month)
    )
    """)
    _add_column_if_missing("settlements", "is_manual", "INTEGER")

    # Xodimning Grade/Stavka TARIXI — o'zgarishlar retroaktiv ravishda o'tgan oylarni
    # o'zgartirib yubormasligi uchun, har bir SANA uchun qaysi grade/stavka amal qilgani
    # saqlanadi (kun darajasida — oy ichida bir nechta o'zgarish bo'lishi mumkin, masalan
    # guruh qo'shilishi/ayirilishi)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS employee_grade_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        effective_date TEXT NOT NULL,
        grade TEXT,
        workload_rate REAL,
        group_count REAL,
        change_note TEXT,
        created_at TEXT,
        created_by TEXT,
        UNIQUE(teacher_id, effective_date)
    )
    """)

    # MUHIM MIGRATSIYA: jadval ilgari "effective_month" (oy darajasida, UNIQUE(teacher_id,
    # effective_month)) sxemasida bo'lgan bo'lishi mumkin — bu holda oy ichida bir nechta
    # o'zgarish saqlab bo'lmas edi. Xavfsiz tarzda kun darajasiga o'tkazamiz, barcha eski
    # ma'lumotni saqlab qolgan holda (oyning 1-kuni sifatida).
    _egh_cols = [c[1] for c in cur.execute("PRAGMA table_info(employee_grade_history)").fetchall()]
    if "effective_date" not in _egh_cols and "effective_month" in _egh_cols:
        old_rows = cur.execute(
            "SELECT teacher_id, effective_month, grade, workload_rate, created_at, created_by "
            "FROM employee_grade_history"
        ).fetchall()
        cur.execute("DROP TABLE employee_grade_history")
        cur.execute("""
        CREATE TABLE employee_grade_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id TEXT NOT NULL,
            effective_date TEXT NOT NULL,
            grade TEXT,
            workload_rate REAL,
            group_count REAL,
            change_note TEXT,
            created_at TEXT,
            created_by TEXT,
            UNIQUE(teacher_id, effective_date)
        )
        """)
        for r in old_rows:
            eff_date = r[1] + "-01"
            cur.execute("""
                INSERT OR IGNORE INTO employee_grade_history
                    (teacher_id, effective_date, grade, workload_rate, created_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (r[0], eff_date, r[2], r[3], r[4], r[5]))
    else:
        # Jadval allaqachon yangi sxemada, lekin ehtimol yangi ustunlar yo'q bo'lishi mumkin
        _add_column_if_missing("employee_grade_history", "group_count", "REAL")
        _add_column_if_missing("employee_grade_history", "change_note", "TEXT")

    # Har oylik tushum (o'qituvchi bo'yicha, qo'lda kiritiladi)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS revenues (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        month TEXT NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        created_at TEXT,
        created_by TEXT,
        UNIQUE(teacher_id, month)
    )
    """)

    # Kunlik kompaniya ko'rsatkichlari (talabalar harakati, tushum/xarajat, topshiriqlar)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS company_metrics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE NOT NULL,
        start_active INTEGER,
        new_admissions INTEGER,
        sales_count INTEGER,
        trial_count INTEGER,
        frozen_count INTEGER,
        left_count INTEGER,
        risky_count INTEGER,
        attendance_percent REAL,
        repeat_sales_calls INTEGER,
        admin_contacted_clients INTEGER,
        risky_contacted_count INTEGER,
        click_revenue REAL,
        card_revenue REAL,
        cash_revenue REAL,
        click_expense REAL,
        card_expense REAL,
        cash_expense REAL,
        admin_task TEXT,
        sales_task TEXT,
        edu_manager_task TEXT,
        end_active INTEGER,
        created_at TEXT,
        created_by TEXT,
        updated_at TEXT,
        updated_by TEXT
    )
    """)

    # Sotuv menejerining kunlik ish vazifalari — tasdiqlash workflow'i bilan
    cur.execute("""
    CREATE TABLE IF NOT EXISTS sales_manager_daily_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        date TEXT NOT NULL,
        repeat_calls_archive INTEGER,
        reinvite_count INTEGER,
        new_admissions INTEGER,
        trial_booked INTEGER,
        trial_attended INTEGER,
        activated_count INTEGER,
        new_sales INTEGER,
        waiting_contact_count INTEGER,
        status TEXT NOT NULL DEFAULT 'draft',
        submitted_at TEXT,
        reviewed_at TEXT,
        reviewed_by TEXT,
        rejection_note TEXT,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(teacher_id, date)
    )
    """)

    # Administratorning kunlik ish vazifalari — tasdiqlash workflow'i bilan (Sotuv menejeri kabi)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS administrator_daily_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        date TEXT NOT NULL,
        admin_contacted_clients INTEGER,
        risky_contacted_count INTEGER,
        risky_count INTEGER,
        frozen_count INTEGER,
        frozen_reason TEXT,
        left_count INTEGER,
        left_reason TEXT,
        complaints_count INTEGER,
        attendance_percent REAL,
        status TEXT NOT NULL DEFAULT 'draft',
        submitted_at TEXT,
        reviewed_at TEXT,
        reviewed_by TEXT,
        rejection_note TEXT,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(teacher_id, date)
    )
    """)

    # Eski bazalarda yo'q bo'lishi mumkin bo'lgan ustunlar (xavfsiz migratsiya)
    _add_column_if_missing("administrator_daily_logs", "left_reason", "TEXT")
    _add_column_if_missing("administrator_daily_logs", "frozen_reason", "TEXT")
    _add_column_if_missing("administrator_daily_logs", "complaints_count", "INTEGER")

    # Ta'lim menejerining kunlik ish vazifalari — tasdiqlash workflow'i bilan
    cur.execute("""
    CREATE TABLE IF NOT EXISTS edu_manager_daily_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        date TEXT NOT NULL,
        start_active INTEGER,
        end_active INTEGER,
        attendance_percent REAL,
        risky_count INTEGER,
        status TEXT NOT NULL DEFAULT 'draft',
        submitted_at TEXT,
        reviewed_at TEXT,
        reviewed_by TEXT,
        rejection_note TEXT,
        created_at TEXT,
        updated_at TEXT,
        UNIQUE(teacher_id, date)
    )
    """)

    # Eski bazalarda yo'q bo'lishi mumkin bo'lgan ustunlar (xavfsiz migratsiya) —
    # davomat va xavfli o'quvchilar soni Administrator'dan Edu Manager'ga ko'chirildi
    _add_column_if_missing("edu_manager_daily_logs", "attendance_percent", "REAL")
    _add_column_if_missing("edu_manager_daily_logs", "risky_count", "INTEGER")

    # Sinov rejimi (Test Mode) — CEO/admin o'z sessiyasi bilan boshqa xodim sifatida
    # ko'rish uchun vaqtincha "kim sifatida ko'rinish" ni kuzatib boradi.
    cur.execute("""
    CREATE TABLE IF NOT EXISTS test_mode_sessions (
        real_teacher_id TEXT PRIMARY KEY,
        impersonating_teacher_id TEXT,
        created_at TEXT
    )
    """)

    # Topshiriqlar — xodimlar orasidagi buyruq/xabar tizimi (istalgan xodimdan
    # istalgan xodimga yoki butun rolga, 3 bosqichli holat bilan)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_teacher_id TEXT NOT NULL,
        to_teacher_id TEXT,
        to_role TEXT,
        text TEXT NOT NULL,
        urgent INTEGER NOT NULL DEFAULT 0,
        deadline TEXT,
        category TEXT,
        daily_number INTEGER,
        student_name TEXT,
        student_group TEXT,
        student_phone TEXT,
        student_problem_status TEXT,
        status TEXT NOT NULL DEFAULT 'new',
        seen_at TEXT,
        seen_by TEXT,
        in_progress_at TEXT,
        in_progress_by TEXT,
        done_at TEXT,
        done_by TEXT,
        created_at TEXT
    )
    """)
    _add_column_if_missing("tasks", "in_progress_at", "TEXT")
    _add_column_if_missing("tasks", "in_progress_by", "TEXT")

    # MIGRATSIYA: eski 'seen' statusi endi 'in_progress' deb ataladi (xodim "Jarayonda"
    # tugmasini bosishi bilan aniq belgilanadi, avtomatik emas)
    cur.execute("UPDATE tasks SET status='in_progress', in_progress_at=seen_at, in_progress_by=seen_by WHERE status='seen'")

    # Topshiriq kategoriyalari — moslashuvchan (Sozlamalarda qo'shish/o'chirish mumkin)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS task_categories (
        key TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        icon TEXT,
        created_at TEXT
    )
    """)
    _seed_default_task_categories()

    # O'quvchi bilan bog'liq topshiriqlar uchun "muammo statusi" ro'yxati — moslashuvchan
    cur.execute("""
    CREATE TABLE IF NOT EXISTS task_problem_statuses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL UNIQUE,
        created_at TEXT
    )
    """)
    _seed_default_task_problem_statuses()

    # Rol bo'yicha, muddati o'tgan topshiriq uchun jarima summasi
    cur.execute("""
    CREATE TABLE IF NOT EXISTS task_role_penalties (
        role TEXT PRIMARY KEY,
        penalty_amount REAL NOT NULL DEFAULT 0,
        updated_at TEXT
    )
    """)

    # Topshiriq izohlari (yozishmalar) — yuboruvchi va qabul qiluvchi orasidagi muloqot
    cur.execute("""
    CREATE TABLE IF NOT EXISTS task_comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id INTEGER NOT NULL,
        from_teacher_id TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT
    )
    """)

    # Qaysi xodim qaysi izohni o'qigani — qo'ng'iroqchadagi bildirishnomalar uchun
    cur.execute("""
    CREATE TABLE IF NOT EXISTS task_comment_reads (
        teacher_id TEXT NOT NULL,
        comment_id INTEGER NOT NULL,
        read_at TEXT,
        PRIMARY KEY (teacher_id, comment_id)
    )
    """)

    # AI (Claude) tomonidan generatsiya qilingan xulosalarni keshlash — har safar qayta
    # so'rov yubormaslik uchun (xarajatni tejash)
    cur.execute("""
    CREATE TABLE IF NOT EXISTS ai_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary_type TEXT NOT NULL,
        ref_key TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        generated_at TEXT,
        generated_by TEXT,
        UNIQUE(summary_type, ref_key)
    )
    """)

    # O'qituvchining shaxsiy o'quvchilar bazasi ("Mening o'quvchilarim")
    cur.execute("""
    CREATE TABLE IF NOT EXISTS students (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id TEXT NOT NULL,
        full_name TEXT NOT NULL,
        age INTEGER,
        gender TEXT,
        parent_name TEXT,
        phone TEXT,
        phone2 TEXT,
        siblings_count INTEGER,
        district TEXT,
        mahalla TEXT,
        school_number TEXT,
        class_grade TEXT,
        course TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT,
        updated_at TEXT
    )
    """)

    # Eski bazalarda yo'q bo'lishi mumkin bo'lgan ustunlar (xavfsiz migratsiya)
    _add_column_if_missing("tasks", "deadline", "TEXT")
    _add_column_if_missing("tasks", "category", "TEXT")
    _add_column_if_missing("tasks", "daily_number", "INTEGER")
    _add_column_if_missing("tasks", "student_name", "TEXT")
    _add_column_if_missing("tasks", "student_group", "TEXT")
    _add_column_if_missing("tasks", "student_phone", "TEXT")
    _add_column_if_missing("tasks", "student_problem_status", "TEXT")


    _add_column_if_missing("company_metrics", "repeat_sales_calls", "INTEGER")
    _add_column_if_missing("company_metrics", "admin_contacted_clients", "INTEGER")
    _add_column_if_missing("company_metrics", "risky_contacted_count", "INTEGER")
    _add_column_if_missing("company_metrics", "complaints_count", "INTEGER")

    _conn.commit()

    # Bootstrap: birinchi CEO'ni environment orqali qo'shish (agar hali yo'q bo'lsa).
    # Login/parol asosidagi platforma uchun: ADMIN_TEACHER_ID + ADMIN_PASSWORD orqali.
    admin_teacher_id = os.getenv("ADMIN_TEACHER_ID")
    admin_password = os.getenv("ADMIN_PASSWORD")
    admin_name = os.getenv("ADMIN_FULL_NAME", "Direktor")
    if admin_teacher_id and admin_password:
        existing = cur.execute(
            "SELECT id FROM employees WHERE teacher_id=?", (admin_teacher_id,)
        ).fetchone()
        if not existing:
            cur.execute("""
                INSERT INTO employees (teacher_id, full_name, role, password_hash, login, active, created_at)
                VALUES (?, ?, 'CEO', ?, ?, 1, ?)
            """, (admin_teacher_id, admin_name, hash_password(admin_password), admin_teacher_id, now_iso()))
            _conn.commit()


# ---------- EMPLOYEES ----------

def get_employee_by_telegram_id(telegram_id: int):
    return _conn.execute(
        "SELECT * FROM employees WHERE telegram_id=?", (telegram_id,)
    ).fetchone()


def get_employee_by_link_token(token: str):
    return _conn.execute(
        "SELECT * FROM employees WHERE link_token=?", (token,)
    ).fetchone()


def link_via_token(token: str, telegram_id: int):
    """
    Bir martalik havola orqali xodimni telegram_id bilan bog'laydi.
    Muvaffaqiyatli bo'lsa teacher_id qaytaradi, aks holda None.
    Token ishlatilgach darhol bekor qilinadi (bir martalik).
    """
    emp = get_employee_by_link_token(token)
    if not emp:
        return None
    _conn.execute(
        "UPDATE employees SET telegram_id=?, link_token=NULL WHERE teacher_id=?",
        (telegram_id, emp["teacher_id"]),
    )
    _conn.commit()
    return emp["teacher_id"]


def generate_link_token(teacher_id: str) -> str:
    """
    Yangi bir martalik token yaratadi. Agar xodim avval bog'langan bo'lsa,
    uning eski bog'lanishi (telegram_id) bekor qilinadi — qayta bog'lanish talab qilinadi.
    """
    token = secrets.token_urlsafe(16)
    _conn.execute(
        "UPDATE employees SET link_token=?, telegram_id=NULL WHERE teacher_id=?",
        (token, teacher_id),
    )
    _conn.commit()
    return token


def get_employee(teacher_id: str):
    return _conn.execute(
        "SELECT * FROM employees WHERE teacher_id=?", (teacher_id,)
    ).fetchone()


def get_employee_by_login(login: str):
    """Login bo'yicha qidiradi — katta/kichik harf farq qilmaydi."""
    return _conn.execute(
        "SELECT * FROM employees WHERE LOWER(login)=LOWER(?)", ((login or "").strip(),)
    ).fetchone()


def is_login_taken(login: str, except_teacher_id: str = None) -> bool:
    row = _conn.execute(
        "SELECT teacher_id FROM employees WHERE LOWER(login)=LOWER(?)", ((login or "").strip(),)
    ).fetchone()
    if not row:
        return False
    return row["teacher_id"] != except_teacher_id


def set_login(teacher_id: str, login: str):
    _conn.execute("UPDATE employees SET login=? WHERE teacher_id=?", ((login or "").strip(), teacher_id))
    _conn.commit()


def list_employees(role: str = None):
    if role:
        return _conn.execute(
            "SELECT * FROM employees WHERE role=? AND active=1 ORDER BY full_name", (role,)
        ).fetchall()
    return _conn.execute(
        "SELECT * FROM employees WHERE active=1 ORDER BY full_name"
    ).fetchall()


def add_employee(teacher_id, full_name, role, grade, workload_rate, phone=None, fixed_salary=None,
                  subject=None, revenue_percent=None, password_hash=None, login=None):
    now = now_iso()
    _conn.execute("""
        INSERT INTO employees (teacher_id, full_name, role, grade, workload_rate, phone, fixed_salary,
                                subject, revenue_percent, password_hash, login, active, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    """, (teacher_id, full_name, role, grade, workload_rate, phone, fixed_salary,
          subject, revenue_percent, password_hash, (login or teacher_id), now))
    _conn.commit()

    # Grade/Stavka tarixini shu kundan boshlab yozib qo'yamiz (Teacher uchun muhim)
    if role == "Teacher":
        add_grade_history(teacher_id, now[:10], grade, workload_rate, created_by="Tizim (yaratilganda)")


def update_employee(teacher_id, full_name=None, grade=None, workload_rate=None, active=None, fixed_salary=None,
                     subject=None, revenue_percent=None, effective_date=None, updated_by=None):
    """
    MUHIM: agar grade yoki workload_rate o'zgartirilsa, bu FAQAT employees jadvalidagi
    "joriy" qiymatni yangilaydi. O'tgan davr hisob-kitobi buzilmasligi uchun, o'zgarish
    employee_grade_history jadvaliga alohida (ko'rsatilgan effective_date'dan boshlab
    kuchga kiradigan) yozuv sifatida ham qo'shiladi — bu kun darajasida ishlaydi.
    """
    fields, values = [], []
    if full_name is not None:
        fields.append("full_name=?"); values.append(full_name)
    if grade is not None:
        fields.append("grade=?"); values.append(grade)
    if workload_rate is not None:
        fields.append("workload_rate=?"); values.append(workload_rate)
    if active is not None:
        fields.append("active=?"); values.append(1 if active else 0)
    if fixed_salary is not None:
        fields.append("fixed_salary=?"); values.append(fixed_salary)
    if subject is not None:
        fields.append("subject=?"); values.append(subject)
    if revenue_percent is not None:
        fields.append("revenue_percent=?"); values.append(revenue_percent)

    if fields:
        values.append(teacher_id)
        _conn.execute(f"UPDATE employees SET {', '.join(fields)} WHERE teacher_id=?", values)
        _conn.commit()

    if grade is not None or workload_rate is not None:
        current = get_employee(teacher_id)
        if current and current["role"] == "Teacher":
            eff_date = effective_date or now_iso()[:10]
            final_grade = grade if grade is not None else current["grade"]
            final_workload = workload_rate if workload_rate is not None else current["workload_rate"]
            add_grade_history(teacher_id, eff_date, final_grade, final_workload, created_by=updated_by)


def set_password(teacher_id, password_hash):
    _conn.execute("UPDATE employees SET password_hash=? WHERE teacher_id=?", (password_hash, teacher_id))
    _conn.commit()


def add_grade_history(teacher_id: str, effective_date: str, grade: str, workload_rate: float,
                       group_count: float = None, change_note: str = None, created_by: str = None):
    """effective_date format: 'YYYY-MM-DD'."""
    _conn.execute("""
        INSERT INTO employee_grade_history
            (teacher_id, effective_date, grade, workload_rate, group_count, change_note, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(teacher_id, effective_date) DO UPDATE SET
            grade=excluded.grade, workload_rate=excluded.workload_rate,
            group_count=excluded.group_count, change_note=excluded.change_note,
            created_by=excluded.created_by
    """, (teacher_id, effective_date, grade, workload_rate, group_count, change_note, now_iso(), created_by))
    _conn.commit()


def get_current_stavka_info(teacher_id: str):
    """Xodimning ENG SO'NGGI (joriy) stavka yozuvini qaytaradi — 'Joriy holat' ko'rsatish uchun."""
    return _conn.execute("""
        SELECT * FROM employee_grade_history WHERE teacher_id=? ORDER BY effective_date DESC LIMIT 1
    """, (teacher_id,)).fetchone()


def get_stavka_baseline_before_date(teacher_id: str, before_date: str):
    """
    'before_date'dan OLDINGI eng so'nggi yozuvni qaytaradi — bu, masalan, o'sha sanaga
    "guruh qo'shish/ayirish" kiritilganda TO'G'RI boshlang'ich guruh sonini aniqlash uchun
    ishlatiladi. get_current_stavka_info'dan farqi: bu funksiya har doim ENG SO'NGGI
    yozuvni emas, balki KO'RSATILGAN SANAGA nisbatan to'g'ri (xronologik) yozuvni topadi —
    aks holda kelajakda allaqachon boshqa (masalan keyingi oy uchun) kiritilgan yozuv
    xato ravishda "joriy holat" sifatida ishlatilib, hisob-kitobni buzib qo'yishi mumkin.
    """
    return _conn.execute("""
        SELECT * FROM employee_grade_history WHERE teacher_id=? AND effective_date < ?
        ORDER BY effective_date DESC LIMIT 1
    """, (teacher_id, before_date)).fetchone()


def get_grade_at_month(teacher_id: str, month: str):
    """
    Shu OY OXIRI uchun amal qilgan grade/workload_rate'ni tarixdan topadi (oddiy, proratsiyasiz
    qidiruv — asosan GRADE uchun ishlatiladi, chunki u kamdan-kam o'zgaradi). Agar tarix
    topilmasa, None qaytaradi — chaqiruvchi shu holda employees jadvalidagi joriy qiymatga
    qaytishi kerak (orqaga moslik uchun).
    """
    month_end = _last_day_of_month_str(month)
    return _conn.execute("""
        SELECT grade, workload_rate FROM employee_grade_history
        WHERE teacher_id=? AND effective_date <= ?
        ORDER BY effective_date DESC LIMIT 1
    """, (teacher_id, month_end)).fetchone()


def _last_day_of_month_str(month: str) -> str:
    import calendar
    year, mon = map(int, month.split("-"))
    last_day = calendar.monthrange(year, mon)[1]
    return f"{month}-{last_day:02d}"


def get_stavka_periods_in_month(teacher_id: str, month: str):
    """
    Oy ichidagi barcha "stavka davrlarini" qaytaradi: [(start_date, end_date, grade, workload_rate), ...]
    Bu — oy ichida guruh qo'shilgan/ayirilgan bo'lsa, Fix'ni kunlarga mutanosib (prorata)
    hisoblash uchun ishlatiladi. Agar tarixda hech qanday yozuv topilmasa, bo'sh ro'yxat
    qaytariladi — chaqiruvchi employees jadvalidagi joriy qiymatga qaytishi kerak.
    """
    import calendar
    year, mon = map(int, month.split("-"))
    days_in_month = calendar.monthrange(year, mon)[1]
    month_start = f"{month}-01"
    month_end = f"{month}-{days_in_month:02d}"

    baseline = _conn.execute("""
        SELECT grade, workload_rate FROM employee_grade_history
        WHERE teacher_id=? AND effective_date < ?
        ORDER BY effective_date DESC LIMIT 1
    """, (teacher_id, month_start)).fetchone()

    changes = _conn.execute("""
        SELECT effective_date, grade, workload_rate FROM employee_grade_history
        WHERE teacher_id=? AND effective_date >= ? AND effective_date <= ?
        ORDER BY effective_date ASC
    """, (teacher_id, month_start, month_end)).fetchall()

    if not baseline and not changes:
        return []

    periods = []
    cursor_date = month_start
    cursor_grade = baseline["grade"] if baseline else (changes[0]["grade"] if changes else None)
    cursor_workload = baseline["workload_rate"] if baseline else None

    from datetime import date, timedelta

    for ch in changes:
        ch_date = ch["effective_date"]
        if ch_date > cursor_date and cursor_workload is not None:
            prev_day = (date.fromisoformat(ch_date) - timedelta(days=1)).isoformat()
            periods.append((cursor_date, prev_day, cursor_grade, cursor_workload))
            cursor_date = ch_date
        elif ch_date > cursor_date:
            cursor_date = ch_date
        cursor_grade = ch["grade"]
        cursor_workload = ch["workload_rate"]

    periods.append((cursor_date, month_end, cursor_grade, cursor_workload))
    return periods


def list_grade_history(teacher_id: str):
    return _conn.execute(
        "SELECT * FROM employee_grade_history WHERE teacher_id=? ORDER BY effective_date DESC", (teacher_id,)
    ).fetchall()


def delete_grade_history_entry(entry_id: int):
    _conn.execute("DELETE FROM employee_grade_history WHERE id=?", (entry_id,))
    _conn.commit()


def count_active_employees() -> int:
    row = _conn.execute("SELECT COUNT(*) AS c FROM employees WHERE active=1").fetchone()
    return row["c"] if row else 0


def count_active_employees_by_grade(grade: str) -> int:
    row = _conn.execute(
        "SELECT COUNT(*) AS c FROM employees WHERE active=1 AND grade=?", (grade,)
    ).fetchone()
    return row["c"] if row else 0


# ---------- SCORECARDS ----------

def upsert_scorecard(teacher_id, month, retention, progress, attendance,
                      homework, observation, feedback, lms, updated_by):
    _conn.execute("""
        INSERT INTO scorecards (teacher_id, month, retention, progress, attendance,
                                 homework, observation, feedback, lms, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(teacher_id, month) DO UPDATE SET
            retention=excluded.retention,
            progress=excluded.progress,
            attendance=excluded.attendance,
            homework=excluded.homework,
            observation=excluded.observation,
            feedback=excluded.feedback,
            lms=excluded.lms,
            updated_at=excluded.updated_at,
            updated_by=excluded.updated_by
    """, (teacher_id, month, retention, progress, attendance, homework,
          observation, feedback, lms, now_iso(), updated_by))
    _conn.commit()


def get_scorecard(teacher_id, month):
    return _conn.execute(
        "SELECT * FROM scorecards WHERE teacher_id=? AND month=?", (teacher_id, month)
    ).fetchone()


def delete_scorecard(teacher_id, month):
    _conn.execute(
        "DELETE FROM scorecards WHERE teacher_id=? AND month=?", (teacher_id, month)
    )
    _conn.commit()


def list_scorecards_by_teacher(teacher_id, limit=24):
    return _conn.execute(
        "SELECT * FROM scorecards WHERE teacher_id=? ORDER BY month DESC LIMIT ?", (teacher_id, limit)
    ).fetchall()


# ---------- STAFF PERFORMANCE (Teacher bo'lmagan rollar uchun) ----------

def get_staff_performance(teacher_id, month):
    return _conn.execute(
        "SELECT * FROM staff_performance WHERE teacher_id=? AND month=?", (teacher_id, month)
    ).fetchone()


def upsert_staff_performance(teacher_id, month, performance_percent, updated_by):
    _conn.execute("""
        INSERT INTO staff_performance (teacher_id, month, performance_percent, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(teacher_id, month) DO UPDATE SET
            performance_percent=excluded.performance_percent,
            updated_at=excluded.updated_at,
            updated_by=excluded.updated_by
    """, (teacher_id, month, performance_percent, now_iso(), updated_by))
    _conn.commit()


# ---------- EDU MANAGER SCORECARD (6 mezonli KPI) ----------

def get_edu_manager_scorecard(teacher_id, month):
    return _conn.execute(
        "SELECT * FROM edu_manager_scorecards WHERE teacher_id=? AND month=?", (teacher_id, month)
    ).fetchone()


def upsert_edu_manager_scorecard(teacher_id, month, retention, teacher_performance, student_results,
                                  attendance, homework, occupancy, report_approved, data_honest, updated_by):
    _conn.execute("""
        INSERT INTO edu_manager_scorecards
            (teacher_id, month, retention, teacher_performance, student_results,
             attendance, homework, occupancy, report_approved, data_honest, updated_at, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(teacher_id, month) DO UPDATE SET
            retention=excluded.retention,
            teacher_performance=excluded.teacher_performance,
            student_results=excluded.student_results,
            attendance=excluded.attendance,
            homework=excluded.homework,
            occupancy=excluded.occupancy,
            report_approved=excluded.report_approved,
            data_honest=excluded.data_honest,
            updated_at=excluded.updated_at,
            updated_by=excluded.updated_by
    """, (teacher_id, month, retention, teacher_performance, student_results,
          attendance, homework, occupancy, 1 if report_approved else 0, 1 if data_honest else 0,
          now_iso(), updated_by))
    _conn.commit()


def delete_edu_manager_scorecard(teacher_id, month):
    _conn.execute(
        "DELETE FROM edu_manager_scorecards WHERE teacher_id=? AND month=?", (teacher_id, month)
    )
    _conn.commit()


def list_edu_manager_scorecards_by_manager(teacher_id, limit=24):
    return _conn.execute(
        "SELECT * FROM edu_manager_scorecards WHERE teacher_id=? ORDER BY month DESC LIMIT ?",
        (teacher_id, limit),
    ).fetchall()


# ---------- SALES MANAGER DAILY LOGS ----------

_SM_DAILY_FIELDS = [
    "repeat_calls_archive", "reinvite_count", "new_admissions", "trial_booked",
    "trial_attended", "activated_count", "new_sales", "waiting_contact_count",
]


def get_sales_manager_daily(teacher_id, date_str):
    return _conn.execute(
        "SELECT * FROM sales_manager_daily_logs WHERE teacher_id=? AND date=?", (teacher_id, date_str)
    ).fetchone()


def upsert_sales_manager_daily(teacher_id, date_str, data: dict):
    """Qoralama sifatida saqlaydi (yoki 'rejected' holatidan qayta tahrirlanganda ham shu funksiya ishlatiladi)."""
    existing = get_sales_manager_daily(teacher_id, date_str)
    now = now_iso()
    values = [data.get(f) for f in _SM_DAILY_FIELDS]

    if existing:
        set_clause = ", ".join(f"{f}=?" for f in _SM_DAILY_FIELDS)
        _conn.execute(
            f"UPDATE sales_manager_daily_logs SET {set_clause}, status='draft', "
            f"reviewed_at=NULL, reviewed_by=NULL, rejection_note=NULL, updated_at=? "
            f"WHERE teacher_id=? AND date=?",
            (*values, now, teacher_id, date_str),
        )
    else:
        cols = ["teacher_id", "date"] + _SM_DAILY_FIELDS + ["status", "created_at", "updated_at"]
        placeholders = ",".join(["?"] * len(cols))
        vals = [teacher_id, date_str] + values + ["draft", now, now]
        _conn.execute(f"INSERT INTO sales_manager_daily_logs ({','.join(cols)}) VALUES ({placeholders})", vals)

    _conn.commit()


def submit_sales_manager_daily(teacher_id, date_str):
    _conn.execute(
        "UPDATE sales_manager_daily_logs SET status='pending', submitted_at=? WHERE teacher_id=? AND date=?",
        (now_iso(), teacher_id, date_str),
    )
    _conn.commit()


def review_sales_manager_daily(teacher_id, date_str, approved: bool, reviewed_by: str, note: str = None):
    status = "approved" if approved else "rejected"
    _conn.execute(
        "UPDATE sales_manager_daily_logs SET status=?, reviewed_at=?, reviewed_by=?, rejection_note=? "
        "WHERE teacher_id=? AND date=?",
        (status, now_iso(), reviewed_by, note, teacher_id, date_str),
    )
    _conn.commit()


def list_pending_sales_manager_daily():
    return _conn.execute(
        "SELECT * FROM sales_manager_daily_logs WHERE status='pending' ORDER BY date DESC"
    ).fetchall()


def list_sales_manager_daily_in_month(teacher_id, month):
    return _conn.execute(
        "SELECT * FROM sales_manager_daily_logs WHERE teacher_id=? AND date LIKE ? ORDER BY date ASC",
        (teacher_id, month + "%"),
    ).fetchall()


def list_approved_sales_manager_daily_before(teacher_id, month, date_str):
    return _conn.execute(
        "SELECT * FROM sales_manager_daily_logs WHERE teacher_id=? AND date LIKE ? AND date < ? "
        "AND status='approved' ORDER BY date ASC",
        (teacher_id, month + "%", date_str),
    ).fetchall()


# ---------- BONUSES ----------

def add_bonus(teacher_id, month, amount, note, created_by):
    _conn.execute("""
        INSERT INTO bonuses (teacher_id, month, amount, note, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (teacher_id, month, amount, note, now_iso(), created_by))
    _conn.commit()


def get_total_bonus(teacher_id, month):
    row = _conn.execute(
        "SELECT COALESCE(SUM(amount),0) AS total FROM bonuses WHERE teacher_id=? AND month=?",
        (teacher_id, month),
    ).fetchone()
    return row["total"] if row else 0


def list_bonuses(teacher_id, month):
    return _conn.execute(
        "SELECT * FROM bonuses WHERE teacher_id=? AND month=? ORDER BY created_at DESC",
        (teacher_id, month),
    ).fetchall()


# ---------- GRADE RATES / SETTINGS ----------

def get_grade_rates():
    rows = _conn.execute("SELECT grade, rate FROM grade_rates").fetchall()
    return {r["grade"]: r["rate"] for r in rows}


def set_grade_rate(grade, rate):
    _conn.execute(
        "INSERT INTO grade_rates (grade, rate) VALUES (?, ?) "
        "ON CONFLICT(grade) DO UPDATE SET rate=excluded.rate",
        (grade, rate),
    )
    _conn.commit()


def get_kpi_pool_percent():
    row = _conn.execute("SELECT value FROM settings WHERE key='kpi_pool_percent'").fetchone()
    return float(row["value"]) if row else DEFAULT_KPI_POOL_PERCENT


def set_kpi_pool_percent(value):
    _conn.execute(
        "INSERT INTO settings (key, value) VALUES ('kpi_pool_percent', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(value),),
    )
    _conn.commit()


def get_avans_percent():
    row = _conn.execute("SELECT value FROM settings WHERE key='avans_percent'").fetchone()
    return float(row["value"]) if row else DEFAULT_AVANS_PERCENT


def set_avans_percent(value):
    _conn.execute(
        "INSERT INTO settings (key, value) VALUES ('avans_percent', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(value),),
    )
    _conn.commit()


def get_min_kpi_percent():
    row = _conn.execute("SELECT value FROM settings WHERE key='min_kpi_percent'").fetchone()
    return float(row["value"]) if row else DEFAULT_MIN_KPI_PERCENT


def set_min_kpi_percent(value):
    _conn.execute(
        "INSERT INTO settings (key, value) VALUES ('min_kpi_percent', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(value),),
    )
    _conn.commit()


DEFAULT_GROUPS_PER_STAVKA = 6  # 1 stavka = necha guruh (Sozlamalarda o'zgartiriladi)


def get_groups_per_stavka():
    row = _conn.execute("SELECT value FROM settings WHERE key='groups_per_stavka'").fetchone()
    return float(row["value"]) if row else DEFAULT_GROUPS_PER_STAVKA


def set_groups_per_stavka(value):
    _conn.execute(
        "INSERT INTO settings (key, value) VALUES ('groups_per_stavka', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(value),),
    )
    _conn.commit()


CRITERION_KEYS = ["retention", "progress", "attendance", "homework", "observation", "feedback", "lms"]


def get_criterion_gates():
    """Har bir mezon uchun Gate chegarasini (xom % yoki 0-100 ekvivalenti) qaytaradi. Standart: 0 (ochirilgan)."""
    gates = {}
    for key in CRITERION_KEYS:
        row = _conn.execute(f"SELECT value FROM settings WHERE key='gate_{key}_percent'").fetchone()
        gates[key] = float(row["value"]) if row else 0.0
    return gates


def set_criterion_gate(criterion_key: str, value: float):
    if criterion_key not in CRITERION_KEYS:
        raise ValueError(f"Notogri mezon kaliti: {criterion_key}")
    _conn.execute(
        f"INSERT INTO settings (key, value) VALUES ('gate_{criterion_key}_percent', ?) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        (str(value),),
    )
    _conn.commit()


# ---------- ADVANCES (AVANS) ----------

def add_or_update_advance(teacher_id, month, amount, given_by, is_manual=False):
    _conn.execute("""
        INSERT INTO advances (teacher_id, month, amount, is_manual, given_at, given_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(teacher_id, month) DO UPDATE SET
            amount=excluded.amount,
            is_manual=excluded.is_manual,
            given_at=excluded.given_at,
            given_by=excluded.given_by
    """, (teacher_id, month, amount, 1 if is_manual else 0, now_iso(), given_by))
    _conn.commit()


def get_advance(teacher_id, month):
    return _conn.execute(
        "SELECT * FROM advances WHERE teacher_id=? AND month=?", (teacher_id, month)
    ).fetchone()


def list_advances(month):
    return _conn.execute(
        "SELECT * FROM advances WHERE month=?", (month,)
    ).fetchall()


# ---------- SETTLEMENTS (Rashchyot to'lovi) ----------

def add_or_update_settlement(teacher_id, month, amount, given_by, is_manual=False):
    _conn.execute("""
        INSERT INTO settlements (teacher_id, month, amount, is_manual, given_at, given_by)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(teacher_id, month) DO UPDATE SET
            amount=excluded.amount,
            is_manual=excluded.is_manual,
            given_at=excluded.given_at,
            given_by=excluded.given_by
    """, (teacher_id, month, amount, 1 if is_manual else 0, now_iso(), given_by))
    _conn.commit()


def get_settlement(teacher_id, month):
    return _conn.execute(
        "SELECT * FROM settlements WHERE teacher_id=? AND month=?", (teacher_id, month)
    ).fetchone()


def list_settlements(month):
    return _conn.execute(
        "SELECT * FROM settlements WHERE month=?", (month,)
    ).fetchall()


# ---------- REVENUES (OYLIK TUSHUM) ----------

def upsert_revenue(teacher_id, month, amount, created_by):
    _conn.execute("""
        INSERT INTO revenues (teacher_id, month, amount, created_at, created_by)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(teacher_id, month) DO UPDATE SET
            amount=excluded.amount,
            created_at=excluded.created_at,
            created_by=excluded.created_by
    """, (teacher_id, month, amount, now_iso(), created_by))
    _conn.commit()


def get_revenue(teacher_id, month):
    return _conn.execute(
        "SELECT * FROM revenues WHERE teacher_id=? AND month=?", (teacher_id, month)
    ).fetchone()


def list_revenues(month):
    return _conn.execute(
        "SELECT * FROM revenues WHERE month=?", (month,)
    ).fetchall()


# ---------- COMPANY METRICS (kunlik kompaniya ko'rsatkichlari) ----------

_COMPANY_METRIC_FIELDS = [
    "start_active", "new_admissions", "sales_count", "trial_count", "frozen_count",
    "left_count", "risky_count", "attendance_percent", "repeat_sales_calls",
    "admin_contacted_clients", "risky_contacted_count", "click_revenue", "card_revenue",
    "cash_revenue", "click_expense", "card_expense", "cash_expense",
    "admin_task", "sales_task", "edu_manager_task", "end_active",
]


def get_company_metric(date: str):
    return _conn.execute(
        "SELECT * FROM company_metrics WHERE date=?", (date,)
    ).fetchone()


def upsert_company_metric(date: str, data: dict, username: str):
    values = [data.get(f) for f in _COMPANY_METRIC_FIELDS]
    existing = get_company_metric(date)
    now = now_iso()

    if existing:
        set_clause = ", ".join(f"{f}=?" for f in _COMPANY_METRIC_FIELDS)
        _conn.execute(
            f"UPDATE company_metrics SET {set_clause}, updated_at=?, updated_by=? WHERE date=?",
            (*values, now, username, date),
        )
    else:
        cols = ["date"] + _COMPANY_METRIC_FIELDS + ["created_at", "created_by", "updated_at", "updated_by"]
        placeholders = ",".join(["?"] * len(cols))
        vals = [date] + values + [now, username, now, username]
        _conn.execute(f"INSERT INTO company_metrics ({','.join(cols)}) VALUES ({placeholders})", vals)

    _conn.commit()


def list_company_metrics(limit: int = 14):
    return _conn.execute(
        "SELECT * FROM company_metrics ORDER BY date DESC LIMIT ?", (limit,)
    ).fetchall()


def list_company_metrics_range(start_date: str, end_date: str):
    return _conn.execute(
        "SELECT * FROM company_metrics WHERE date BETWEEN ? AND ? ORDER BY date ASC",
        (start_date, end_date),
    ).fetchall()


def list_company_metrics_for_month(month: str):
    """month format: 'YYYY-MM' — shu oyga tegishli barcha kunlik yozuvlarni qaytaradi."""
    return _conn.execute(
        "SELECT * FROM company_metrics WHERE date LIKE ? ORDER BY date ASC",
        (f"{month}-%",),
    ).fetchall()


# ---------- SALES MANAGER DAILY LOGS (kunlik ish vazifalari + tasdiqlash) ----------

_SM_DAILY_FIELDS = [
    "repeat_calls_archive", "reinvite_count", "new_admissions", "trial_booked",
    "trial_attended", "activated_count", "new_sales", "waiting_contact_count",
]


def get_sales_manager_daily(teacher_id: str, date: str):
    return _conn.execute(
        "SELECT * FROM sales_manager_daily_logs WHERE teacher_id=? AND date=?", (teacher_id, date)
    ).fetchone()


def upsert_sales_manager_daily(teacher_id: str, date: str, data: dict, status: str = "draft"):
    """
    Kunlik yozuvni yaratadi yoki yangilaydi. Faqat 'draft' yoki 'rejected' holatdagi
    yozuvlar tahrirlanishi kerak — bu tekshiruv chaqiruvchi tomonda (server.py) amalga oshiriladi.
    """
    existing = get_sales_manager_daily(teacher_id, date)
    now = now_iso()
    values = [data.get(f) for f in _SM_DAILY_FIELDS]

    if existing:
        set_clause = ", ".join(f"{f}=?" for f in _SM_DAILY_FIELDS)
        _conn.execute(
            f"UPDATE sales_manager_daily_logs SET {set_clause}, status=?, updated_at=?, "
            f"rejection_note=NULL WHERE teacher_id=? AND date=?",
            (*values, status, now, teacher_id, date),
        )
    else:
        cols = ["teacher_id", "date"] + _SM_DAILY_FIELDS + ["status", "created_at", "updated_at"]
        placeholders = ",".join(["?"] * len(cols))
        vals = [teacher_id, date] + values + [status, now, now]
        _conn.execute(f"INSERT INTO sales_manager_daily_logs ({','.join(cols)}) VALUES ({placeholders})", vals)
    _conn.commit()


def submit_sales_manager_daily(teacher_id: str, date: str):
    _conn.execute(
        "UPDATE sales_manager_daily_logs SET status='pending', submitted_at=?, updated_at=? "
        "WHERE teacher_id=? AND date=?",
        (now_iso(), now_iso(), teacher_id, date),
    )
    _conn.commit()


def review_sales_manager_daily(teacher_id: str, date: str, approved: bool, reviewed_by: str, note: str = None):
    status = "approved" if approved else "rejected"
    _conn.execute(
        "UPDATE sales_manager_daily_logs SET status=?, reviewed_at=?, reviewed_by=?, rejection_note=? "
        "WHERE teacher_id=? AND date=?",
        (status, now_iso(), reviewed_by, note, teacher_id, date),
    )
    _conn.commit()


def list_pending_sales_manager_daily():
    return _conn.execute(
        "SELECT * FROM sales_manager_daily_logs WHERE status='pending' ORDER BY date ASC"
    ).fetchall()


def list_sales_manager_daily_in_month(teacher_id: str, month: str):
    return _conn.execute(
        "SELECT * FROM sales_manager_daily_logs WHERE teacher_id=? AND date LIKE ? ORDER BY date ASC",
        (teacher_id, f"{month}-%"),
    ).fetchall()


def list_approved_sales_manager_daily_before(teacher_id: str, month: str, date: str):
    """Shu oy ichida, berilgan sanadan OLDINGI, faqat TASDIQLANGAN kunlik yozuvlar."""
    return _conn.execute(
        "SELECT * FROM sales_manager_daily_logs WHERE teacher_id=? AND date LIKE ? "
        "AND date < ? AND status='approved' ORDER BY date ASC",
        (teacher_id, f"{month}-%", date),
    ).fetchall()


# ---------- SINOV REJIMI (Test Mode) — bitta Telegram akkaunt bilan turli rollarni sinash ----------

def get_impersonation(real_teacher_id: str):
    """
    Agar bu sessiya hozir sinov rejimida (kimdir sifatida) ko'rilayotgan bo'lsa,
    o'sha nishon xodimning teacher_id'sini qaytaradi. Aks holda None.
    """
    row = _conn.execute(
        "SELECT impersonating_teacher_id FROM test_mode_sessions WHERE real_teacher_id=?", (real_teacher_id,)
    ).fetchone()
    return row["impersonating_teacher_id"] if row else None


def set_impersonation(real_teacher_id: str, target_teacher_id: str):
    """Haqiqiy (CEO) sessiya qaysi xodim sifatida ko'rilayotganini belgilaydi/yangilaydi."""
    _conn.execute("""
        INSERT INTO test_mode_sessions (real_teacher_id, impersonating_teacher_id, created_at)
        VALUES (?, ?, ?)
        ON CONFLICT(real_teacher_id) DO UPDATE SET impersonating_teacher_id=excluded.impersonating_teacher_id
    """, (real_teacher_id, target_teacher_id, now_iso()))
    _conn.commit()


def clear_impersonation(real_teacher_id: str):
    """Sinov rejimidan chiqadi — haqiqiy hisobga (hech narsa o'zgarmagan holda) qaytadi."""
    _conn.execute("DELETE FROM test_mode_sessions WHERE real_teacher_id=?", (real_teacher_id,))
    _conn.commit()


def force_link_telegram(teacher_id: str, telegram_id: int):
    """To'g'ridan-to'g'ri bog'lash (chetlab o'tish holatlari uchun) — hech kimdan tozalamasdan."""
    _conn.execute(
        "UPDATE employees SET telegram_id=?, link_token=NULL WHERE teacher_id=?",
        (telegram_id, teacher_id),
    )
    _conn.commit()


# ---------- SALES MANAGER: shu sana uchun tasdiqlangan yozuvlar (Kompaniya sinxronizatsiyasi uchun) ----------

def list_approved_sales_manager_daily_for_date(date: str):
    return _conn.execute(
        "SELECT * FROM sales_manager_daily_logs WHERE date=? AND status='approved'", (date,)
    ).fetchall()


# ---------- ADMINISTRATOR DAILY LOGS (kunlik ish vazifalari + tasdiqlash) ----------

_ADMIN_DAILY_FIELDS = [
    "admin_contacted_clients", "risky_contacted_count",
    "frozen_count", "frozen_reason", "left_count", "left_reason",
    "complaints_count",
]


def get_administrator_daily(teacher_id: str, date: str):
    return _conn.execute(
        "SELECT * FROM administrator_daily_logs WHERE teacher_id=? AND date=?", (teacher_id, date)
    ).fetchone()


def upsert_administrator_daily(teacher_id: str, date: str, data: dict, status: str = "draft"):
    existing = get_administrator_daily(teacher_id, date)
    now = now_iso()
    values = [data.get(f) for f in _ADMIN_DAILY_FIELDS]

    if existing:
        set_clause = ", ".join(f"{f}=?" for f in _ADMIN_DAILY_FIELDS)
        _conn.execute(
            f"UPDATE administrator_daily_logs SET {set_clause}, status=?, updated_at=?, "
            f"rejection_note=NULL WHERE teacher_id=? AND date=?",
            (*values, status, now, teacher_id, date),
        )
    else:
        cols = ["teacher_id", "date"] + _ADMIN_DAILY_FIELDS + ["status", "created_at", "updated_at"]
        placeholders = ",".join(["?"] * len(cols))
        vals = [teacher_id, date] + values + [status, now, now]
        _conn.execute(f"INSERT INTO administrator_daily_logs ({','.join(cols)}) VALUES ({placeholders})", vals)
    _conn.commit()


def submit_administrator_daily(teacher_id: str, date: str):
    _conn.execute(
        "UPDATE administrator_daily_logs SET status='pending', submitted_at=?, updated_at=? "
        "WHERE teacher_id=? AND date=?",
        (now_iso(), now_iso(), teacher_id, date),
    )
    _conn.commit()


def review_administrator_daily(teacher_id: str, date: str, approved: bool, reviewed_by: str, note: str = None):
    status = "approved" if approved else "rejected"
    _conn.execute(
        "UPDATE administrator_daily_logs SET status=?, reviewed_at=?, reviewed_by=?, rejection_note=? "
        "WHERE teacher_id=? AND date=?",
        (status, now_iso(), reviewed_by, note, teacher_id, date),
    )
    _conn.commit()


def list_pending_administrator_daily():
    return _conn.execute(
        "SELECT * FROM administrator_daily_logs WHERE status='pending' ORDER BY date ASC"
    ).fetchall()


def list_administrator_daily_in_month(teacher_id: str, month: str):
    return _conn.execute(
        "SELECT * FROM administrator_daily_logs WHERE teacher_id=? AND date LIKE ? ORDER BY date ASC",
        (teacher_id, f"{month}-%"),
    ).fetchall()


def list_approved_administrator_daily_for_date(date: str):
    return _conn.execute(
        "SELECT * FROM administrator_daily_logs WHERE date=? AND status='approved'", (date,)
    ).fetchall()


# ---------- EDU MANAGER DAILY LOGS (kunlik ish vazifalari + tasdiqlash) ----------

_EDU_DAILY_FIELDS = ["start_active", "end_active", "attendance_percent", "risky_count"]


def get_edu_manager_daily(teacher_id: str, date: str):
    return _conn.execute(
        "SELECT * FROM edu_manager_daily_logs WHERE teacher_id=? AND date=?", (teacher_id, date)
    ).fetchone()


def upsert_edu_manager_daily(teacher_id: str, date: str, data: dict, status: str = "draft"):
    existing = get_edu_manager_daily(teacher_id, date)
    now = now_iso()
    values = [data.get(f) for f in _EDU_DAILY_FIELDS]

    if existing:
        set_clause = ", ".join(f"{f}=?" for f in _EDU_DAILY_FIELDS)
        _conn.execute(
            f"UPDATE edu_manager_daily_logs SET {set_clause}, status=?, updated_at=?, "
            f"rejection_note=NULL WHERE teacher_id=? AND date=?",
            (*values, status, now, teacher_id, date),
        )
    else:
        cols = ["teacher_id", "date"] + _EDU_DAILY_FIELDS + ["status", "created_at", "updated_at"]
        placeholders = ",".join(["?"] * len(cols))
        vals = [teacher_id, date] + values + [status, now, now]
        _conn.execute(f"INSERT INTO edu_manager_daily_logs ({','.join(cols)}) VALUES ({placeholders})", vals)
    _conn.commit()


def submit_edu_manager_daily(teacher_id: str, date: str):
    _conn.execute(
        "UPDATE edu_manager_daily_logs SET status='pending', submitted_at=?, updated_at=? "
        "WHERE teacher_id=? AND date=?",
        (now_iso(), now_iso(), teacher_id, date),
    )
    _conn.commit()


def review_edu_manager_daily(teacher_id: str, date: str, approved: bool, reviewed_by: str, note: str = None):
    status = "approved" if approved else "rejected"
    _conn.execute(
        "UPDATE edu_manager_daily_logs SET status=?, reviewed_at=?, reviewed_by=?, rejection_note=? "
        "WHERE teacher_id=? AND date=?",
        (status, now_iso(), reviewed_by, note, teacher_id, date),
    )
    _conn.commit()


def list_pending_edu_manager_daily():
    return _conn.execute(
        "SELECT * FROM edu_manager_daily_logs WHERE status='pending' ORDER BY date ASC"
    ).fetchall()


def list_edu_manager_daily_in_month(teacher_id: str, month: str):
    return _conn.execute(
        "SELECT * FROM edu_manager_daily_logs WHERE teacher_id=? AND date LIKE ? ORDER BY date ASC",
        (teacher_id, f"{month}-%"),
    ).fetchall()


def list_approved_edu_manager_daily_for_date(date: str):
    return _conn.execute(
        "SELECT * FROM edu_manager_daily_logs WHERE date=? AND status='approved'", (date,)
    ).fetchall()


# ---------- COMPANY METRICS: qisman (partial) yangilash — rol asosidagi kunlik ----------
# yozuvlar tasdiqlanganda avtomatik sinxronizatsiya uchun ishlatiladi

def update_company_metric_partial(date: str, partial: dict, updated_by: str):
    """
    company_metrics jadvalidagi FAQAT ko'rsatilgan maydonlarni yangilaydi — qolgan
    maydonlar (masalan Direktor qo'lda kiritgan tushum/xarajat/topshiriqlar) tegilmaydi.
    """
    if not partial:
        return
    existing = get_company_metric(date)
    now = now_iso()

    if existing:
        set_parts = [f"{k}=?" for k in partial.keys()]
        values = list(partial.values()) + [now, updated_by, date]
        _conn.execute(
            f"UPDATE company_metrics SET {', '.join(set_parts)}, updated_at=?, updated_by=? WHERE date=?",
            values,
        )
    else:
        cols = ["date"] + list(partial.keys()) + ["created_at", "created_by", "updated_at", "updated_by"]
        placeholders = ",".join(["?"] * len(cols))
        vals = [date] + list(partial.values()) + [now, updated_by, now, updated_by]
        _conn.execute(f"INSERT INTO company_metrics ({','.join(cols)}) VALUES ({placeholders})", vals)
    _conn.commit()


# ---------- TOPSHIRIQLAR (Tasks) — xodimlar orasidagi buyruq/xabar tizimi ----------

DEFAULT_TASK_CATEGORIES = [
    ("student", "O'quvchi bilan bog'liq", "🎓"),
    ("financial", "Moliyaviy", "💰"),
    ("internal", "Ichki", "🏢"),
    ("other", "Boshqa", "📌"),
]

DEFAULT_TASK_PROBLEM_STATUSES = [
    "Muzlatildi", "Chiqib ketdi", "Darsga kelmadi", "Davomat qilinmadi",
    "Baholanmadi", "Qarzdor", "Yangi talaba qo'shildi", "Imtixon olinmadi", "Natijasi past",
]


def _seed_default_task_categories():
    existing = _conn.execute("SELECT COUNT(*) AS c FROM task_categories").fetchone()["c"]
    if existing == 0:
        now = now_iso()
        for key, label, icon in DEFAULT_TASK_CATEGORIES:
            _conn.execute(
                "INSERT INTO task_categories (key, label, icon, created_at) VALUES (?, ?, ?, ?)",
                (key, label, icon, now),
            )
        _conn.commit()


def _seed_default_task_problem_statuses():
    existing = _conn.execute("SELECT COUNT(*) AS c FROM task_problem_statuses").fetchone()["c"]
    if existing == 0:
        now = now_iso()
        for label in DEFAULT_TASK_PROBLEM_STATUSES:
            _conn.execute(
                "INSERT INTO task_problem_statuses (label, created_at) VALUES (?, ?)", (label, now)
            )
        _conn.commit()


def list_task_categories():
    return _conn.execute("SELECT * FROM task_categories ORDER BY created_at ASC").fetchall()


def add_task_category(key: str, label: str, icon: str = None):
    _conn.execute(
        "INSERT INTO task_categories (key, label, icon, created_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET label=excluded.label, icon=excluded.icon",
        (key, label, icon, now_iso()),
    )
    _conn.commit()


def delete_task_category(key: str):
    _conn.execute("DELETE FROM task_categories WHERE key=?", (key,))
    _conn.commit()


def list_task_problem_statuses():
    return _conn.execute("SELECT * FROM task_problem_statuses ORDER BY created_at ASC").fetchall()


def add_task_problem_status(label: str):
    _conn.execute(
        "INSERT OR IGNORE INTO task_problem_statuses (label, created_at) VALUES (?, ?)",
        (label, now_iso()),
    )
    _conn.commit()


def delete_task_problem_status(status_id: int):
    _conn.execute("DELETE FROM task_problem_statuses WHERE id=?", (status_id,))
    _conn.commit()


def get_task_role_penalties():
    rows = _conn.execute("SELECT * FROM task_role_penalties").fetchall()
    return {r["role"]: r["penalty_amount"] for r in rows}


def set_task_role_penalty(role: str, amount: float):
    _conn.execute(
        "INSERT INTO task_role_penalties (role, penalty_amount, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(role) DO UPDATE SET penalty_amount=excluded.penalty_amount, updated_at=excluded.updated_at",
        (role, amount, now_iso()),
    )
    _conn.commit()


def _insert_one_task(from_teacher_id, to_teacher_id, to_role, text, urgent, deadline, category,
                      student_name, student_group, student_phone, student_problem_status, created_at):
    today = created_at[:10]
    count_today = _conn.execute(
        "SELECT COUNT(*) AS c FROM tasks WHERE date(created_at)=?", (today,)
    ).fetchone()["c"]
    daily_number = count_today + 1

    _conn.execute("""
        INSERT INTO tasks (from_teacher_id, to_teacher_id, to_role, text, urgent, deadline, category,
                            daily_number, student_name, student_group, student_phone, student_problem_status,
                            status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)
    """, (from_teacher_id, to_teacher_id, to_role, text, 1 if urgent else 0, deadline, category,
          daily_number, student_name, student_group, student_phone, student_problem_status, created_at))
    _conn.commit()
    return _conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]


def create_task(from_teacher_id: str, text: str, to_teacher_id: str = None, to_role: str = None,
                 urgent: bool = False, deadline: str = None, category: str = None,
                 student_name: str = None, student_group: str = None,
                 student_phone: str = None, student_problem_status: str = None):
    """
    Aniq xodimga yuborilsa — bitta yozuv.

    BUTUN ROLGA yuborilsa — bitta umumiy yozuv EMAS, balki o'sha roldagi HAR BIR faol
    xodimga ALOHIDA nusxa yaratiladi (har biri o'z to_teacher_id'siga ega). Aks holda
    bitta umumiy yozuv bo'lganida, xodimlardan biri "Bajarildi" desa, bu holat
    BOSHQA barcha xodimlarning ekranida ham o'zgarib qolar edi — garchi ular hech
    narsa qilmagan bo'lsalar ham. Endi har biri mustaqil ravishda o'z nusxasini
    ko'radi, boshlaydi va bajaradi; hisobotlar/reyting ham to'g'ri ishlaydi, chunki
    ular allaqachon to_teacher_id bo'yicha hisoblanadi.

    Qaytaradi: yaratilgan topshiriq(lar) ID'lari ro'yxati.
    """
    now = now_iso()
    common = dict(
        from_teacher_id=from_teacher_id, text=text, urgent=urgent, deadline=deadline,
        category=category, student_name=student_name, student_group=student_group,
        student_phone=student_phone, student_problem_status=student_problem_status,
        created_at=now,
    )

    if to_role and not to_teacher_id:
        recipients = [e["teacher_id"] for e in list_employees(role=to_role) if e["teacher_id"] != from_teacher_id]
        if not recipients:
            return []
        return [
            _insert_one_task(to_teacher_id=rid, to_role=to_role, **common)
            for rid in recipients
        ]

    return [_insert_one_task(to_teacher_id=to_teacher_id, to_role=to_role, **common)]


def get_task(task_id: int):
    return _conn.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()


def list_tasks_inbox(teacher_id: str, role: str):
    """Menga (aniq) YOKI mening rolimga yuborilgan barcha topshiriqlar, eng yangisi birinchi."""
    return _conn.execute("""
        SELECT * FROM tasks
        WHERE to_teacher_id=? OR (to_teacher_id IS NULL AND to_role=?)
        ORDER BY (status='done'), urgent DESC, created_at DESC
    """, (teacher_id, role)).fetchall()


def list_tasks_sent(teacher_id: str):
    return _conn.execute(
        "SELECT * FROM tasks WHERE from_teacher_id=? ORDER BY created_at DESC", (teacher_id,)
    ).fetchall()


def list_tasks_all(limit: int = 200):
    return _conn.execute(
        "SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?", (limit,)
    ).fetchall()


def list_tasks_in_range(start: str, end: str):
    """start/end format: 'YYYY-MM-DD' — shu sana oralig'ida yaratilgan barcha topshiriqlar."""
    return _conn.execute(
        "SELECT * FROM tasks WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at DESC",
        (start, end),
    ).fetchall()


def count_unseen_inbox_tasks(teacher_id: str, role: str) -> int:
    """Xodimga (yoki uning roliga) kelgan, hali bir marta ham ochilmagan topshiriqlar soni."""
    row = _conn.execute("""
        SELECT COUNT(*) AS c FROM tasks
        WHERE (to_teacher_id=? OR (to_teacher_id IS NULL AND to_role=?))
          AND seen_at IS NULL
          AND status != 'done'
    """, (teacher_id, role)).fetchone()
    return row["c"] if row else 0


def mark_inbox_tasks_seen(teacher_id: str, role: str) -> int:
    """Xodim topshiriqlar ro'yxatini ochganda — barcha yangi topshiriqlarni 'ko'rilgan' deb belgilaydi."""
    cur = _conn.cursor()
    cur.execute("""
        UPDATE tasks SET seen_at=?, seen_by=?
        WHERE (to_teacher_id=? OR (to_teacher_id IS NULL AND to_role=?))
          AND seen_at IS NULL
    """, (now_iso(), teacher_id, teacher_id, role))
    _conn.commit()
    return cur.rowcount


def mark_task_first_viewed(task_id: int, by_teacher_id: str):
    """Faqat 'birinchi marta ko'rilgan vaqt'ni jim (statusni o'zgartirmasdan) belgilaydi — analitika uchun."""
    row = get_task(task_id)
    if row and row["seen_at"] is None:
        _conn.execute(
            "UPDATE tasks SET seen_at=?, seen_by=? WHERE id=?", (now_iso(), by_teacher_id, task_id)
        )
        _conn.commit()


def mark_task_in_progress(task_id: int, by_teacher_id: str):
    """Xodim aniq 'Jarayonda' tugmasini bosganda chaqiriladi — avtomatik emas."""
    row = get_task(task_id)
    if row and row["status"] == "new":
        _conn.execute(
            "UPDATE tasks SET status='in_progress', in_progress_at=?, in_progress_by=? WHERE id=?",
            (now_iso(), by_teacher_id, task_id),
        )
        _conn.commit()


def mark_task_done(task_id: int, by_teacher_id: str):
    _conn.execute(
        "UPDATE tasks SET status='done', done_at=?, done_by=? WHERE id=?",
        (now_iso(), by_teacher_id, task_id),
    )
    _conn.commit()


def add_task_comment(task_id: int, from_teacher_id: str, text: str):
    _conn.execute(
        "INSERT INTO task_comments (task_id, from_teacher_id, text, created_at) VALUES (?, ?, ?, ?)",
        (task_id, from_teacher_id, text, now_iso()),
    )
    _conn.commit()


def list_task_comments(task_id: int):
    return _conn.execute(
        "SELECT * FROM task_comments WHERE task_id=? ORDER BY created_at ASC", (task_id,)
    ).fetchall()


def list_task_notifications(teacher_id: str, role: str, limit: int = 30):
    """Menga (yoki rolimga) kelgan so'nggi topshiriqlar — bildirishnomalar ro'yxati uchun."""
    return _conn.execute("""
        SELECT * FROM tasks
        WHERE to_teacher_id=? OR (to_teacher_id IS NULL AND to_role=?)
        ORDER BY created_at DESC
        LIMIT ?
    """, (teacher_id, role, limit)).fetchall()


# ---------- Izoh bildirishnomalari (qo'ng'iroqcha uchun) ----------

# "Menga tegishli" izoh: men qabul qiluvchi YOKI yuboruvchi bo'lgan topshiriqqa
# BOSHQA birov yozgan izoh.
_MY_COMMENTS_WHERE = """
    FROM task_comments c
    JOIN tasks t ON t.id = c.task_id
    WHERE c.from_teacher_id != ?
      AND (t.to_teacher_id = ? OR (t.to_teacher_id IS NULL AND t.to_role = ?) OR t.from_teacher_id = ?)
"""


def _my_comment_params(teacher_id: str, role: str):
    return (teacher_id, teacher_id, role, teacher_id)


def count_unread_comments(teacher_id: str, role: str) -> int:
    row = _conn.execute(f"""
        SELECT COUNT(*) AS c {_MY_COMMENTS_WHERE}
          AND NOT EXISTS (
              SELECT 1 FROM task_comment_reads r
              WHERE r.comment_id = c.id AND r.teacher_id = ?
          )
    """, _my_comment_params(teacher_id, role) + (teacher_id,)).fetchone()
    return row["c"] if row else 0


def list_comment_notifications(teacher_id: str, role: str, limit: int = 30):
    """Menga tegishli so'nggi izohlar — o'qilgan/o'qilmagan belgisi bilan."""
    return _conn.execute(f"""
        SELECT c.id AS comment_id, c.task_id, c.from_teacher_id, c.text, c.created_at,
               t.daily_number, t.text AS task_text, t.to_teacher_id, t.from_teacher_id AS task_from,
               (SELECT COUNT(*) FROM task_comment_reads r
                 WHERE r.comment_id = c.id AND r.teacher_id = ?) AS read_count
        {_MY_COMMENTS_WHERE}
        ORDER BY c.created_at DESC
        LIMIT ?
    """, (teacher_id,) + _my_comment_params(teacher_id, role) + (limit,)).fetchall()


def mark_comment_read(teacher_id: str, comment_id: int):
    _conn.execute(
        "INSERT OR IGNORE INTO task_comment_reads (teacher_id, comment_id, read_at) VALUES (?, ?, ?)",
        (teacher_id, comment_id, now_iso()),
    )
    _conn.commit()


def mark_task_comments_read(teacher_id: str, task_id: int):
    """Topshiriq izohlari ochilganda — o'sha topshiriqning barcha izohlari o'qilgan bo'ladi."""
    _conn.execute("""
        INSERT OR IGNORE INTO task_comment_reads (teacher_id, comment_id, read_at)
        SELECT ?, id, ? FROM task_comments WHERE task_id = ?
    """, (teacher_id, now_iso(), task_id))
    _conn.commit()


def mark_all_comments_read(teacher_id: str, role: str):
    _conn.execute(f"""
        INSERT OR IGNORE INTO task_comment_reads (teacher_id, comment_id, read_at)
        SELECT ?, c.id, ?
        {_MY_COMMENTS_WHERE}
    """, (teacher_id, now_iso()) + _my_comment_params(teacher_id, role))
    _conn.commit()


# ---------- AI xulosalari keshi ----------

def get_ai_summary(summary_type: str, ref_key: str):
    return _conn.execute(
        "SELECT * FROM ai_summaries WHERE summary_type=? AND ref_key=?", (summary_type, ref_key)
    ).fetchone()


def save_ai_summary(summary_type: str, ref_key: str, summary_text: str, generated_by: str = None):
    _conn.execute("""
        INSERT INTO ai_summaries (summary_type, ref_key, summary_text, generated_at, generated_by)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(summary_type, ref_key) DO UPDATE SET
            summary_text=excluded.summary_text, generated_at=excluded.generated_at, generated_by=excluded.generated_by
    """, (summary_type, ref_key, summary_text, now_iso(), generated_by))
    _conn.commit()


# ---------- Sinov (test) ma'lumotlarini tozalash ----------

# Sinov davrida kiritilgan, aniq xodimga bog'liq bo'lgan jadvallar. Real ishlab chiqishga
# o'tishdan oldin bu jadvallardan ko'rsatilgan teacher_id'larga tegishli qatorlar o'chiriladi.
_TEACHER_SCOPED_TABLES_FOR_PURGE = [
    "scorecards", "staff_performance", "edu_manager_scorecards",
    "sales_manager_daily_logs", "administrator_daily_logs", "edu_manager_daily_logs",
    "bonuses", "advances", "settlements", "employee_grade_history", "revenues",
]


def purge_test_employees(test_teacher_ids: list) -> dict:
    """
    Ko'rsatilgan teacher_id'lar (va faqat ular) uchun: xodimning o'zi HAMDA unga bog'liq
    barcha performance/moliyaviy yozuvlarni butunlay o'chiradi. Bundan tashqari, hozircha
    platformada REAL kompaniya tarixi hali kiritilmagan bo'lgani uchun (real ma'lumot
    keyinroq alohida import qilinadi), quyidagi umumiy (teacher_id'ga bog'liq bo'lmagan)
    jadvallar ham butunlay tozalanadi: company_metrics (kunlik agregat ko'rsatkichlar,
    faqat sinov kunlik hisobotlaridan avtomatik yig'ilgan), ai_summaries (sinov ma'lumotlari
    asosidagi keshlangan AI xulosalari), test_mode_sessions (sinov rejimi holati).

    CEO/Director hisoblari va ularning employees qatoridagi mavjud qiymatlari (masalan,
    Direktorning maoshi) BUTUNLAY DAXLSIZ qoladi — bu funksiya faqat berilgan
    test_teacher_ids ro'yxati bilan ishlaydi.

    Qaytaradi: {"deleted_employees": [...], "counts": {jadval: o'chirilgan_qator_soni}}
    """
    if not test_teacher_ids:
        return {"deleted_employees": [], "counts": {}}

    cur = _conn.cursor()
    placeholders = ",".join("?" * len(test_teacher_ids))
    counts = {}

    for table in _TEACHER_SCOPED_TABLES_FOR_PURGE:
        cur.execute(f"DELETE FROM {table} WHERE teacher_id IN ({placeholders})", test_teacher_ids)
        counts[table] = cur.rowcount

    # Topshiriqlar — sinov xodimi yuborgan YOKI qabul qilgan har qanday topshiriq
    task_ids = [r["id"] for r in cur.execute(
        f"SELECT id FROM tasks WHERE from_teacher_id IN ({placeholders}) OR to_teacher_id IN ({placeholders})",
        test_teacher_ids + test_teacher_ids,
    ).fetchall()]
    if task_ids:
        tph = ",".join("?" * len(task_ids))
        cur.execute(f"DELETE FROM task_comments WHERE task_id IN ({tph})", task_ids)
        cur.execute(f"DELETE FROM tasks WHERE id IN ({tph})", task_ids)
    counts["tasks"] = len(task_ids)

    # Umumiy (sinov davriga tegishli) jadvallar — real tarix hali kiritilmagan
    cur.execute("DELETE FROM company_metrics")
    counts["company_metrics"] = cur.rowcount
    cur.execute("DELETE FROM ai_summaries")
    counts["ai_summaries"] = cur.rowcount
    cur.execute("DELETE FROM test_mode_sessions")
    counts["test_mode_sessions"] = cur.rowcount

    # Eng oxirida — xodimning o'zi
    cur.execute(f"DELETE FROM employees WHERE teacher_id IN ({placeholders})", test_teacher_ids)
    counts["employees"] = cur.rowcount

    _conn.commit()
    return {"deleted_employees": test_teacher_ids, "counts": counts}


# ---------- Eski tizimdan real ma'lumotlarni import qilish (bir martalik migratsiya) ----------

def import_legacy_data(payload: dict) -> dict:
    """
    Eski EH_HR_System'dan (Railway'dagi "elegant-success" loyihasi) eksport qilingan
    real ma'lumotlarni yangi platformaga yozadi. `payload` chaqiruvchi tomonda allaqachon
    tozalangan bo'lishi kerak: sinov yozuvlari va CEO/Director (ular platformada allaqachon
    boshqa teacher_id bilan mavjud) chiqarib tashlangan. `payload["password_hashes"]`
    {teacher_id: password_hash} ko'rinishida oldindan hash qilingan parollar.

    Faqat hali platformada YO'Q xodimlarni yaratadi â mavjud xodimlarga tegmaydi.
    Qaytadan chaqirilsa (masalan xato bo'lib qayta urinilsa), xodimlar qayta yaratilmaydi,
    lekin scorecard/revenue/grade-history/advance/settlement yozuvlari ON CONFLICT orqali
    xavfsiz UPSERT qilinadi (dublikat bo'lmaydi).
    """
    counts = {
        "employees_created": 0, "employees_skipped_existing": 0,
        "grade_rates": 0, "settings": 0, "task_categories": 0,
        "task_problem_statuses": 0, "task_penalties": 0,
        "company_metrics": 0, "advances": 0, "settlements": 0,
        "scorecards": 0, "grade_history": 0, "revenues": 0,
    }

    pw_hashes = payload.get("password_hashes") or {}

    for e in payload.get("employees", []):
        tid = e["teacher_id"]
        if get_employee(tid):
            counts["employees_skipped_existing"] += 1
            continue
        add_employee(
            teacher_id=tid, full_name=e["full_name"], role=e["role"], grade=e.get("grade"),
            workload_rate=e.get("workload_rate") or 1.0, phone=e.get("phone"),
            fixed_salary=e.get("fixed_salary"), subject=e.get("subject"),
            revenue_percent=e.get("revenue_percent"),
            password_hash=pw_hashes.get(tid),
            login=e.get("login"),
        )
        counts["employees_created"] += 1

    settings = payload.get("settings") or {}
    for grade, rate in (settings.get("grade_rates") or {}).items():
        set_grade_rate(grade, rate)
        counts["grade_rates"] += 1
    if "kpi_pool_percent" in settings:
        set_kpi_pool_percent(settings["kpi_pool_percent"]); counts["settings"] += 1
    if "avans_percent" in settings:
        set_avans_percent(settings["avans_percent"]); counts["settings"] += 1
    if "min_kpi_percent" in settings:
        set_min_kpi_percent(settings["min_kpi_percent"]); counts["settings"] += 1
    if "groups_per_stavka" in settings:
        set_groups_per_stavka(settings["groups_per_stavka"]); counts["settings"] += 1
    for key, val in (settings.get("criterion_gates") or {}).items():
        set_criterion_gate(key, val)
        counts["settings"] += 1

    for cat in payload.get("task_categories", []):
        _conn.execute(
            "INSERT OR IGNORE INTO task_categories (key, label, icon, created_at) VALUES (?, ?, ?, ?)",
            (cat["key"], cat["label"], cat.get("icon"), cat.get("created_at") or now_iso()),
        )
        counts["task_categories"] += 1
    for st in payload.get("task_problem_statuses", []):
        _conn.execute(
            "INSERT OR IGNORE INTO task_problem_statuses (label, created_at) VALUES (?, ?)",
            (st["label"], st.get("created_at") or now_iso()),
        )
        counts["task_problem_statuses"] += 1
    for role, amt in (payload.get("task_penalties") or {}).items():
        _conn.execute("""
            INSERT INTO task_role_penalties (role, penalty_amount, updated_at) VALUES (?, ?, ?)
            ON CONFLICT(role) DO UPDATE SET penalty_amount=excluded.penalty_amount, updated_at=excluded.updated_at
        """, (role, amt, now_iso()))
        counts["task_penalties"] += 1
    _conn.commit()

    cm = payload.get("company_metrics")
    cm_rows = cm.get("rows", cm) if isinstance(cm, dict) else (cm or [])
    for row in cm_rows:
        data = {k: row.get(k) for k in _COMPANY_METRIC_FIELDS}
        upsert_company_metric(row["date"], data, row.get("updated_by") or row.get("created_by") or "Migratsiya")
        counts["company_metrics"] += 1

    for month, rows in (payload.get("advances") or {}).items():
        if not isinstance(rows, list):
            continue
        for r in rows:
            add_or_update_advance(
                r["teacher_id"], r["month"], r["amount"],
                r.get("given_by") or "Migratsiya", bool(r.get("is_manual")),
            )
            counts["advances"] += 1
    for month, rows in (payload.get("settlements") or {}).items():
        if not isinstance(rows, list):
            continue
        for r in rows:
            add_or_update_settlement(
                r["teacher_id"], r["month"], r["amount"],
                r.get("given_by") or "Migratsiya", bool(r.get("is_manual")),
            )
            counts["settlements"] += 1

    for tid, pe in (payload.get("perEmployee") or {}).items():
        for sc in pe.get("scorecard_history") or []:
            upsert_scorecard(
                tid, sc["month"], sc.get("retention"), sc.get("progress"), sc.get("attendance"),
                sc.get("homework"), sc.get("observation"), sc.get("feedback"), sc.get("lms"),
                sc.get("updated_by") or "Migratsiya",
            )
            counts["scorecards"] += 1
        for gh in pe.get("grade_history") or []:
            add_grade_history(
                tid, gh["effective_date"], gh.get("grade"), gh.get("workload_rate"),
                group_count=gh.get("group_count"), change_note=gh.get("change_note"),
                created_by=gh.get("created_by") or "Migratsiya",
            )
            counts["grade_history"] += 1
        rev = pe.get("revenue_history") or {}
        for rr in rev.get("rows") or []:
            if rr.get("revenue") is not None:
                upsert_revenue(tid, rr["month"], rr["revenue"], "Migratsiya")
                counts["revenues"] += 1

    _conn.commit()
    return counts


# ---------- O'QITUVCHINING SHAXSIY O'QUVCHILAR BAZASI ----------

def add_student(teacher_id: str, full_name: str, age: int = None, gender: str = None,
                 parent_name: str = None, phone: str = None, phone2: str = None,
                 siblings_count: int = None, district: str = None, mahalla: str = None,
                 school_number: str = None, class_grade: str = None, course: str = None):
    now = now_iso()
    _conn.execute("""
        INSERT INTO students (teacher_id, full_name, age, gender, parent_name, phone, phone2,
                               siblings_count, district, mahalla, school_number, class_grade, course,
                               active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    """, (teacher_id, full_name, age, gender, parent_name, phone, phone2,
          siblings_count, district, mahalla, school_number, class_grade, course, now, now))
    _conn.commit()
    return _conn.execute("SELECT last_insert_rowid() AS id").fetchone()["id"]


def get_student(student_id: int):
    return _conn.execute("SELECT * FROM students WHERE id=?", (student_id,)).fetchone()


def list_students_by_teacher(teacher_id: str):
    return _conn.execute(
        "SELECT * FROM students WHERE teacher_id=? AND active=1 ORDER BY full_name COLLATE NOCASE",
        (teacher_id,)
    ).fetchall()


def update_student(student_id: int, full_name: str = None, age: int = None, gender: str = None,
                    parent_name: str = None, phone: str = None, phone2: str = None,
                    siblings_count: int = None, district: str = None, mahalla: str = None,
                    school_number: str = None, class_grade: str = None, course: str = None):
    fields, values = [], []
    if full_name is not None:
        fields.append("full_name=?"); values.append(full_name)
    if age is not None:
        fields.append("age=?"); values.append(age)
    if gender is not None:
        fields.append("gender=?"); values.append(gender)
    if parent_name is not None:
        fields.append("parent_name=?"); values.append(parent_name)
    if phone is not None:
        fields.append("phone=?"); values.append(phone)
    if phone2 is not None:
        fields.append("phone2=?"); values.append(phone2)
    if siblings_count is not None:
        fields.append("siblings_count=?"); values.append(siblings_count)
    if district is not None:
        fields.append("district=?"); values.append(district)
    if mahalla is not None:
        fields.append("mahalla=?"); values.append(mahalla)
    if school_number is not None:
        fields.append("school_number=?"); values.append(school_number)
    if class_grade is not None:
        fields.append("class_grade=?"); values.append(class_grade)
    if course is not None:
        fields.append("course=?"); values.append(course)

    if not fields:
        return
    fields.append("updated_at=?"); values.append(now_iso())
    values.append(student_id)
    _conn.execute(f"UPDATE students SET {', '.join(fields)} WHERE id=?", values)
    _conn.commit()


def deactivate_student(student_id: int):
    _conn.execute("UPDATE students SET active=0, updated_at=? WHERE id=?", (now_iso(), student_id))
    _conn.commit()
