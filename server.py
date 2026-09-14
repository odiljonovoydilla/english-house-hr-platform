"""
SERVER — English House HR Platform
==================================
Bitta Python jarayoni uch vazifani bajaradi:
  1. Landing page va ilova (SPA) fayllarini beradi (/  va  /app)
  2. Login/parol orqali autentifikatsiyani boshqaradi (/api/login)
  3. Ilova uchun API'ni beradi (/api/...)

Bu — brauzer-birinchi platforma: kirish faqat login (teacher_id) + parol orqali,
Telegram Mini App yoki Login Widget ORQALI EMAS. Telegram bot integratsiyasi
(BOT_TOKEN) butunlay ixtiyoriy — sozlansa, faqat topshiriq bildirishnomalari va
xodimni Telegram'ga ixtiyoriy bog'lash uchun ishlatiladi, kirish uchun emas.

Railway'da ishga tushirish buyrug'i (Procfile'da yozilgan):
    uvicorn server:app --host 0.0.0.0 --port $PORT
"""

import os
import hmac
import hashlib
import secrets
import json
import time
import contextvars
from datetime import date
from urllib.parse import parse_qsl

import httpx
from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.responses import FileResponse, JSONResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

import db
from db import hash_password, verify_password
from payroll_engine import (
    calc_payroll, calc_avans, calc_rashchyot, calc_effective_kpi_percent, calc_kpi, calc_edu_manager_kpi,
    working_days_in_month, calc_sales_manager_daily, calc_sales_manager_monthly_bonus,
    SALES_MANAGER_DAILY_REPEAT_CALLS_TARGET, SALES_MANAGER_REINVITE_TARGET,
)

load_dotenv()

# Telegram bot — IXTIYORIY. Faqat topshiriq bildirishnomalari va xodimni ixtiyoriy
# Telegram'ga bog'lash uchun ishlatiladi. Kirish (login) buning bilan bog'liq emas.
BOT_TOKEN = os.getenv("BOT_TOKEN") or None
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "changeme")
PUBLIC_URL = os.getenv("PUBLIC_URL", "")  # masalan: https://your-app.up.railway.app

# Brauzer sessiya cookie'sini imzolash uchun.
SESSION_SECRET = os.getenv("SESSION_SECRET", WEBHOOK_SECRET)
SESSION_MAX_AGE = 60 * 60 * 24 * 30  # 30 kun

# Xizmat API kaliti — Cowork yoki boshqa tashqi avtomatlashtirish tizimlari uchun DOIMIY
# (muddati tugamaydigan), o'zgarmas kalit. Faqat pastda ko'rsatilgan bir nechta topshiriqlar
# endpoint'iga QO'SHIMCHA kirish usuli sifatida ishlaydi — login/parol sessiyasini almashtirmaydi
# va boshqa hech qanday endpoint'ga ta'sir qilmaydi. .env faylida saqlanadi, kodga yozilmaydi.
SERVICE_API_KEY = os.getenv("SERVICE_API_KEY") or None

# get_current_employee() ko'plab endpoint'larda oddiy funksiya sifatida (FastAPI in'ektsiyasisiz)
# chaqiriladi, shuning uchun brauzer sessiya cookie'sini unga alohida parametr qilib emas,
# har bir so'rov boshida shu contextvar'ga yozib, o'sha yerdan o'qiymiz.
_session_cookie_ctx: contextvars.ContextVar = contextvars.ContextVar("session_cookie", default=None)

TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}" if BOT_TOKEN else None

# Botning @username'i — sozlangan bo'lsa, startup vaqtida getMe orqali avtomatik olinadi,
# ixtiyoriy bir martalik Telegram-bog'lash havolalarini qurish uchun kerak.
BOT_USERNAME = os.getenv("BOT_USERNAME") or None

app = FastAPI()
db.init_db()

WEBAPP_DIR = os.path.join(os.path.dirname(__file__), "webapp")
app.mount("/static", StaticFiles(directory=WEBAPP_DIR), name="static")


@app.middleware("http")
async def no_cache_for_webapp_files(request: Request, call_next):
    """
    Telegram'ning Mini App web-view'i ba'zan HTML/JS/CSS'ni juda qattiq keshlab qo'yadi
    va yangi deploy qilingan o'zgarishlar ko'rinmay qoladi. Shu sababli asosiy sahifa va
    /static/ ostidagi barcha fayllarga "hech qachon keshlama" ko'rsatmasini majburiy qo'shamiz.
    """
    response = await call_next(request)
    if request.url.path in ("/", "/app", "/login") or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response


@app.middleware("http")
async def capture_session_cookie(request: Request, call_next):
    _session_cookie_ctx.set(request.cookies.get("eh_session"))
    return await call_next(request)


@app.on_event("startup")
async def fetch_bot_username():
    global BOT_USERNAME
    if BOT_USERNAME or not BOT_TOKEN:
        return
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{TELEGRAM_API}/getMe")
            data = resp.json()
            BOT_USERNAME = data["result"]["username"]
    except Exception as e:
        print(f"[WARNING] Bot username avtomatik olinmadi: {e}")


@app.get("/")
def serve_landing():
    return FileResponse(os.path.join(WEBAPP_DIR, "index.html"))


@app.get("/app")
def serve_app():
    return FileResponse(os.path.join(WEBAPP_DIR, "app.html"))


@app.get("/health")
def health():
    return {"status": "ok"}


# =========================================================
# BRAUZERDA KIRISH — Login (teacher_id) + Parol
# =========================================================

@app.get("/login")
def login_page():
    html = """<!DOCTYPE html>
<html lang="uz">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>English House — Kirish</title>
<link rel="stylesheet" href="/static/style.css" />
</head>
<body>
  <div class="center-box" style="min-height:100vh;">
    <div class="login-card">
      <span class="lp-logo-mark">🏫</span>
      <h1>English House</h1>
      <p>Login va parolingiz bilan kiring</p>
      <form id="loginForm" style="text-align:left;">
        <label>Login</label>
        <input id="loginId" type="text" autocomplete="username" required />
        <label>Parol</label>
        <input id="loginPw" type="password" autocomplete="current-password" required />
        <button class="primary" type="submit">Kirish</button>
        <div id="loginMsg" style="margin-top:10px;font-size:13px;"></div>
      </form>
    </div>
  </div>
  <script>
    document.getElementById("loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const msg = document.getElementById("loginMsg");
      msg.textContent = "Tekshirilmoqda...";
      try {
        const res = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teacher_id: document.getElementById("loginId").value.trim(),
            password: document.getElementById("loginPw").value,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || "Kirishda xatolik");
        }
        window.location.href = "/app";
      } catch (err) {
        msg.innerHTML = '<span class="error-box">' + err.message + '</span>';
      }
    });
  </script>
</body>
</html>"""
    return HTMLResponse(html)


@app.post("/api/login")
async def api_login(request: Request):
    body = await request.json()
    teacher_id = (body.get("teacher_id") or "").strip()
    password = body.get("password") or ""
    if not teacher_id or not password:
        raise HTTPException(status_code=400, detail="Login va parol kiritilishi shart")

    emp = db.get_employee(teacher_id)
    if not emp or not emp["active"] or not verify_password(password, emp["password_hash"]):
        raise HTTPException(status_code=401, detail="Login yoki parol noto'g'ri")

    token = create_session_token(emp["teacher_id"])
    resp = JSONResponse({"ok": True})
    resp.set_cookie(
        "eh_session", token,
        max_age=SESSION_MAX_AGE, httponly=True, secure=True, samesite="lax",
    )
    return resp


@app.post("/api/logout")
def api_logout():
    resp = JSONResponse({"ok": True})
    resp.delete_cookie("eh_session")
    return resp


# =========================================================
# TELEGRAM BILDIRISHNOMALARI — IXTIYORIY (BOT_TOKEN sozlansagina ishlaydi)
# Kirish/login bunga bog'liq emas; faqat topshiriq bildirishnomalari uchun.
# =========================================================

async def send_message(chat_id: int, text: str, reply_markup: dict = None):
    if not TELEGRAM_API:
        return
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = json.dumps(reply_markup)
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{TELEGRAM_API}/sendMessage", data=payload)
        if resp.status_code != 200:
            print(f"[TELEGRAM ERROR] {resp.status_code}: {resp.text}")


def _open_app_keyboard():
    # Bu platforma brauzerda ishlaydi (Mini App WebView emas) — tugma oddiy havola
    # sifatida telefon/kompyuterning haqiqiy brauzerini ochadi.
    return {
        "inline_keyboard": [[
            {"text": "🌐 English House'ni ochish", "url": f"{PUBLIC_URL}/login"}
        ]]
    }


@app.post("/webhook/{secret}")
async def telegram_webhook(secret: str, request: Request):
    """
    IXTIYORIY: bu platformada kirish faqat login/parol orqali (Telegram orqali emas).
    Webhook faqat BOT_TOKEN sozlanib, kelajakda bildirishnoma boti sifatida
    ishlatilmoqchi bo'lsa foydali — /start bosilganda saytga havola yuboradi, xolos.
    """
    if secret != WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Noto'g'ri webhook manzili")

    update = await request.json()
    message = update.get("message")
    if not message:
        return {"ok": True}

    chat_id = message["chat"]["id"]
    text = message.get("text", "")

    if text.startswith("/start"):
        await send_message(
            chat_id,
            "Xush kelibsiz! Tizimga kirish uchun quyidagi tugmani bosing 👇",
            reply_markup=_open_app_keyboard(),
        )
    else:
        await send_message(chat_id, "Tizimga kirish uchun /start yuboring.")

    return {"ok": True}


def create_session_token(teacher_id: str) -> str:
    """Brauzer sessiyasi uchun oddiy imzolangan token: teacher_id.muddat.imzo"""
    expiry = int(time.time()) + SESSION_MAX_AGE
    payload = f"{teacher_id}.{expiry}"
    sig = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}.{sig}"


def verify_session_token(token: str):
    try:
        teacher_id, expiry_str, sig = token.rsplit(".", 2)
    except ValueError:
        return None
    payload = f"{teacher_id}.{expiry_str}"
    expected_sig = hmac.new(SESSION_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_sig, sig):
        return None
    if int(expiry_str) < time.time():
        return None
    return teacher_id


def _get_real_teacher_id() -> str:
    """Sessiya cookie'sidan HAQIQIY (sinov rejimi/impersonatsiyaga bog'liq bo'lmagan) teacher_id."""
    eh_session = _session_cookie_ctx.get()
    if not eh_session:
        raise HTTPException(status_code=401, detail="Kirish talab qilinadi")
    teacher_id = verify_session_token(eh_session)
    if not teacher_id:
        raise HTTPException(status_code=401, detail="Sessiya yaroqsiz yoki muddati tugagan")
    return teacher_id


def get_current_employee(x_telegram_init_data: str = Header(None)):
    """
    Barcha endpoint'lar shu funksiyani chaqiradi. Parametr nomi tarixiy sabablarga ko'ra
    saqlanib qolgan (ko'p joyda hali ham shu nom bilan chaqiriladi), lekin bu platformada
    kirish FAQAT login/parol sessiyasi orqali — Telegram bilan bog'liq emas.
    """
    real_teacher_id = _get_real_teacher_id()

    # Sinov rejimi (Test Mode) — CEO boshqa xodim sifatida ko'rish uchun vaqtincha almashtiradi.
    impersonating_id = db.get_impersonation(real_teacher_id)
    if impersonating_id:
        impersonated = db.get_employee(impersonating_id)
        if impersonated:
            return impersonated
        db.clear_impersonation(real_teacher_id)

    emp = db.get_employee(real_teacher_id)
    if not emp or not emp["active"]:
        raise HTTPException(status_code=403, detail="Hisobingiz faol emas. Administratorga murojaat qiling.")
    return emp


def _verify_service_api_key(authorization: str) -> bool:
    """
    'Authorization: Bearer <SERVICE_API_KEY>' header'ini tekshiradi.
    SERVICE_API_KEY .env'da sozlanmagan bo'lsa (bo'sh), doim False qaytaradi — ya'ni bu
    autentifikatsiya usuli standart holatda O'CHIRILGAN.
    """
    if not SERVICE_API_KEY or not authorization:
        return False
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return False
    return hmac.compare_digest(token.strip(), SERVICE_API_KEY)


def get_current_employee_or_service(x_telegram_init_data: str = Header(None), authorization: str = Header(None)):
    """
    Xodim sessiyasi (cookie) BILAN BIRGA — xizmat API kaliti orqali ham kirish imkonini beruvchi
    qo'shimcha funksiya. FAQAT quyidagi topshiriqlar (tasks) endpoint'larida ishlatiladi:
      /api/tasks (POST), /api/tasks/all (GET), /api/tasks/{id}/start (POST), /api/tasks/{id}/done (POST)
    Bu Cowork yoki boshqa tashqi avtomatlashtirish tizimlari topshiriqlarni login/parolsiz,
    doimiy 'Authorization: Bearer <SERVICE_API_KEY>' header'i orqali boshqarishi uchun qo'shilgan.
    Boshqa barcha endpoint'lar hamon FAQAT get_current_employee() (login/parol sessiyasi) orqali
    ishlaydi — bu funksiya ularga ta'sir qilmaydi.

    Kalit to'g'ri bo'lsa, ADMIN_TEACHER_ID xodimi (CEO) nomidan harakat qiladi va shu 4 ta
    endpoint'dagi rol/egalik cheklovlari (masalan, faqat topshiriq egasi "Bajarildi" bosishi)
    chetlab o'tiladi — chunki xizmat kaliti administrator darajasidagi ishonchli avtomatlashtirish
    uchun mo'ljallangan.

    Qaytaradi: (xodim_dict, is_service: bool)
    """
    if _verify_service_api_key(authorization):
        admin_teacher_id = os.getenv("ADMIN_TEACHER_ID")
        emp = db.get_employee(admin_teacher_id) if admin_teacher_id else None
        if not emp:
            raise HTTPException(
                status_code=500,
                detail="Xizmat kaliti uchun ADMIN_TEACHER_ID xodimi topilmadi. .env'dagi "
                       "ADMIN_TEACHER_ID to'g'ri sozlanganini tekshiring.",
            )
        return emp, True
    return get_current_employee(x_telegram_init_data), False


def require_admin(emp) -> None:
    if emp["role"] not in ("CEO", "Director", "EduManager"):
        raise HTTPException(status_code=403, detail="Bu amal uchun ruxsatingiz yo'q")


def require_owner(emp) -> None:
    """Faqat CEO/Director — kompaniya darajasidagi moliyaviy ma'lumotlar uchun (Edu Manager kirmaydi)."""
    if emp["role"] not in ("CEO", "Director"):
        raise HTTPException(status_code=403, detail="Bu amal uchun ruxsatingiz yo'q")


def require_ceo(emp) -> None:
    """Faqat CEO — tizim sozlamalari (grade narxlari, foizlar) uchun. Direktor ham kirmaydi."""
    if emp["role"] != "CEO":
        raise HTTPException(status_code=403, detail="Bu amal uchun ruxsatingiz yo'q")


def _prev_month(month: str) -> str:
    y, m = map(int, month.split("-"))
    if m == 1:
        return f"{y - 1}-12"
    return f"{y}-{m - 1:02d}"


def _expense_for_teacher(t, month: str, grade_rates: dict) -> float:
    """
    Xodimning shu oy uchun xarajati. Agar scorecard kiritilgan bo'lsa FIX+KPI+Bonus,
    aks holda faqat FIX+Bonus (chunki KPI hali hisoblanmagan).
    """
    return _compute_for_teacher(t, month)["total"]


def _last_n_months(n: int):
    out = []
    d = date.today().replace(day=1)
    for _ in range(n):
        out.append(d.strftime("%Y-%m"))
        if d.month == 1:
            d = d.replace(year=d.year - 1, month=12)
        else:
            d = d.replace(month=d.month - 1)
    return out


# =========================================================
# API — AUTH / PROFIL
# =========================================================

@app.post("/api/auth")
def api_auth(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    return {
        "teacher_id": emp["teacher_id"],
        "full_name": emp["full_name"],
        "role": emp["role"],
        "grade": emp["grade"],
        "workload_rate": emp["workload_rate"],
        "subject": emp["subject"],
    }


# =========================================================
# API — O'QITUVCHI: O'Z NATIJASINI KO'RISH
# =========================================================

def _compute_for_teacher(emp, month: str):
    """
    Har doim FIX va Bonusni qaytaradi — bular Grade/Stavka va Bonus jadvalidan keladi,
    scorecardga bog'liq emas (shuning uchun Avans berish uchun scorecard shart emas).
    Faqat KPI (va shunga bog'liq Rashchyot) hisoblash uchun scorecard kerak — agar hali
    kiritilmagan bo'lsa, "kpi_available": False qaytariladi va KPI 0 deb hisoblanadi.

    MUHIM: Grade/Stavka JORIY qiymat emas, balki SHU OY uchun tarixda amal qilgan
    qiymat(lar) ishlatiladi — shunda xodimning kelajakdagi o'zgarishi o'tgan oylar
    hisob-kitobini retroaktiv ravishda o'zgartirib yubormaydi. Agar oy ICHIDA
    (masalan guruh qo'shilishi tufayli) stavka o'zgargan bo'lsa, Fix kunlarga
    MUTANOSIB (prorata) hisoblanadi — har bir davr o'z kunlari ulushicha qo'shiladi.
    """
    grade_rates = db.get_grade_rates()
    kpi_pool_percent = db.get_kpi_pool_percent()
    min_kpi_percent = db.get_min_kpi_percent()
    bonus = db.get_total_bonus(emp["teacher_id"], month)

    periods = db.get_stavka_periods_in_month(emp["teacher_id"], month)
    if periods:
        import calendar
        from datetime import date as _dt
        year, mon = map(int, month.split("-"))
        days_in_month = calendar.monthrange(year, mon)[1]

        prorated_fix = 0.0
        grade = periods[-1][2]  # ko'rsatish uchun — oydagi eng so'nggi davr grade'i
        for (p_start, p_end, p_grade, p_workload) in periods:
            p_days = (_dt.fromisoformat(p_end) - _dt.fromisoformat(p_start)).days + 1
            p_rate = grade_rates.get(p_grade, 0)
            prorated_fix += p_rate * (p_workload or 0) * p_days
        fix = prorated_fix / days_in_month if days_in_month > 0 else 0
        # calc_payroll() grade*workload_rate ko'paytmasi orqali Fix hisoblaydi — proratsiya
        # qilingan Fix'ni to'g'ridan-to'g'ri ishlatish uchun, uni "grade_rates" ichiga
        # bitta soxta yozuv sifatida joylashtiramiz (workload_rate=1.0 bilan)
        workload_rate = 1.0
        synthetic_grade_rates = {grade: fix}
    else:
        hist = db.get_grade_at_month(emp["teacher_id"], month)
        grade = hist["grade"] if hist else emp["grade"]
        workload_rate = hist["workload_rate"] if hist else emp["workload_rate"]
        synthetic_grade_rates = grade_rates
        fix = grade_rates.get(grade, 0) * workload_rate

    kpi_pool = fix * kpi_pool_percent / 100

    sc = db.get_scorecard(emp["teacher_id"], month)
    if not sc:
        return {
            "teacher_id": emp["teacher_id"],
            "full_name": emp["full_name"],
            "grade": grade,
            "month": month,
            "fix": round(fix, 2),
            "kpi_pool": round(kpi_pool, 2),
            "kpi_pool_percent": kpi_pool_percent,
            "kpi_percent": 0,
            "effective_kpi_percent": 0,
            "kpi_amount": 0,
            "bonus": bonus,
            "total": round(fix + bonus, 2),
            "gate_notes": [],
            "breakdown": None,
            "raw_scores": None,
            "kpi_available": False,
        }

    result = calc_payroll(
        grade=grade,
        workload_rate=workload_rate,
        grade_rates=synthetic_grade_rates,
        kpi_pool_percent=kpi_pool_percent,
        retention=sc["retention"], progress=sc["progress"],
        attendance=sc["attendance"], homework=sc["homework"],
        observation=sc["observation"], feedback=sc["feedback"], lms=sc["lms"],
        bonus=bonus,
        min_kpi_percent=min_kpi_percent,
    )
    teacher_gate_notes = list(result.kpi.gate_notes)
    if result.kpi_amount == 0 and result.kpi.final_percent < min_kpi_percent:
        teacher_gate_notes.append(
            f"KPI foizi ({result.kpi.final_percent:g}%) Minimal KPI chegarasidan ({min_kpi_percent:g}%) past — summa 0"
        )

    return {
        "teacher_id": emp["teacher_id"],
        "full_name": emp["full_name"],
        "grade": result.grade,
        "month": month,
        "fix": result.base_salary,
        "kpi_pool": result.kpi_pool,
        "kpi_pool_percent": kpi_pool_percent,
        "kpi_percent": result.kpi.final_percent,
        "effective_kpi_percent": calc_effective_kpi_percent(kpi_pool_percent, result.kpi.final_percent),
        "kpi_amount": result.kpi_amount,
        "bonus": result.bonus,
        "total": result.total,
        "gate_notes": teacher_gate_notes,
        "breakdown": {
            "retention": result.kpi.retention_ball,
            "progress": result.kpi.progress_ball,
            "attendance": result.kpi.attendance_ball,
            "homework": result.kpi.homework_ball,
            "observation": result.kpi.observation_ball,
            "feedback": result.kpi.feedback_ball,
            "lms": result.kpi.lms_ball,
        },
        "raw_scores": {
            "retention": sc["retention"], "progress": sc["progress"],
            "attendance": sc["attendance"], "homework": sc["homework"],
            "observation": sc["observation"], "feedback": sc["feedback"], "lms": sc["lms"],
        },
        "kpi_available": True,
    }


def _compute_for_staff(emp, month: str):
    """
    Teacher bo'lmagan rollar (Direktor, Edu Manager, Administrator, Sotuv menejeri) uchun.

    Hozircha KPI/samaradorlik tizimi ishlab chiqilmagan — shuning uchun faqat
    FIX (oylik maosh) + Bonus asosida hisoblanadi. KPI ishlashi hech qanday
    kutilayotgan ma'lumotga bog'liq emas, shuning uchun har doim natija qaytaradi
    (Teacher'dagi kabi scorecard kutish shart emas).
    """
    fix = emp["fixed_salary"] or 0
    bonus = db.get_total_bonus(emp["teacher_id"], month)
    total = fix + bonus

    return {
        "teacher_id": emp["teacher_id"],
        "full_name": emp["full_name"],
        "grade": None,
        "month": month,
        "fix": round(fix, 2),
        "kpi_pool": 0,
        "kpi_pool_percent": 0,
        "kpi_percent": 0,
        "effective_kpi_percent": 0,
        "kpi_amount": 0,
        "bonus": bonus,
        "total": round(total, 2),
        "gate_notes": [],
        "breakdown": None,
        "raw_scores": None,
        "kpi_available": True,
    }


def _compute_for_subject_teacher(emp, month: str):
    """
    "Fan o'qituvchisi" (masalan Matematika, Koreys tili) — bular Grade/Stavka bo'yicha emas,
    balki o'sha oy uchun kiritilgan TUSHUM (Tushum bo'limida) va shaxsiy ULUSH FOIZI
    (revenue_percent, xodim profilida belgilanadi) asosida ishlaydi:
        Rashchyot (bu yerda "fix" deb ataladi, chunki qolgan hisob-kitob shu asosda quriladi)
            = Tushum * (revenue_percent / 100)
    Agar shu oy uchun hali tushum kiritilmagan bo'lsa, hisob-kitob mumkin emas ("kpi_available": False).
    """
    rev = db.get_revenue(emp["teacher_id"], month)
    percent = emp["revenue_percent"] or 0
    bonus = db.get_total_bonus(emp["teacher_id"], month)

    if not rev:
        return {
            "teacher_id": emp["teacher_id"],
            "full_name": emp["full_name"],
            "grade": None,
            "subject": emp["subject"],
            "month": month,
            "fix": 0,
            "kpi_pool": 0,
            "kpi_pool_percent": 0,
            "kpi_percent": 0,
            "effective_kpi_percent": 0,
            "kpi_amount": 0,
            "bonus": bonus,
            "total": round(bonus, 2),
            "gate_notes": [],
            "breakdown": None,
            "raw_scores": None,
            "kpi_available": False,
            "revenue_percent": percent,
            "revenue_amount": None,
        }

    revenue_amount = rev["amount"]
    fix = round(revenue_amount * percent / 100, 2)
    total = round(fix + bonus, 2)

    return {
        "teacher_id": emp["teacher_id"],
        "full_name": emp["full_name"],
        "grade": None,
        "subject": emp["subject"],
        "month": month,
        "fix": fix,
        "kpi_pool": 0,
        "kpi_pool_percent": 0,
        "kpi_percent": 0,
        "effective_kpi_percent": 0,
        "kpi_amount": 0,
        "bonus": bonus,
        "total": total,
        "gate_notes": [],
        "breakdown": None,
        "raw_scores": None,
        "kpi_available": True,
        "revenue_percent": percent,
        "revenue_amount": revenue_amount,
    }


def _compute_for_edu_manager(emp, month: str):
    """
    Ta'lim menejeri (EduManager) uchun 6 mezonli vaznli KPI tizimi
    (English House Academic Manager Payroll System v1.0 asosida):
    Retention, Teacher Performance, Student Results o'sishi, Attendance, Homework, Group Occupancy.

    Qo'shimcha ikkilamchi gate: agar "Hisobot tasdiqlangan" yoki "Ma'lumot haqqoniy"
    belgilanmagan bo'lsa, ball qanchalik yuqori bo'lmasin, KPI summasi 0 bo'ladi.
    Bundan tashqari, umumiy "Minimal KPI foizi" (Sozlamalar) chegarasi ham qo'llanadi.
    """
    fix = emp["fixed_salary"] or 0
    kpi_pool_percent = db.get_kpi_pool_percent()
    min_kpi_percent = db.get_min_kpi_percent()
    kpi_pool = fix * kpi_pool_percent / 100
    bonus = db.get_total_bonus(emp["teacher_id"], month)

    sc = db.get_edu_manager_scorecard(emp["teacher_id"], month)
    if not sc:
        return {
            "teacher_id": emp["teacher_id"],
            "full_name": emp["full_name"],
            "grade": None,
            "month": month,
            "fix": round(fix, 2),
            "kpi_pool": round(kpi_pool, 2),
            "kpi_pool_percent": kpi_pool_percent,
            "kpi_percent": 0,
            "effective_kpi_percent": 0,
            "kpi_amount": 0,
            "bonus": bonus,
            "total": round(fix + bonus, 2),
            "gate_notes": [],
            "breakdown": None,
            "raw_scores": None,
            "kpi_available": False,
            "report_approved": None,
            "data_honest": None,
            "gate_blocked": False,
        }

    kpi = calc_edu_manager_kpi(
        retention=sc["retention"],
        teacher_performance=sc["teacher_performance"],
        student_results=sc["student_results"],
        attendance=sc["attendance"],
        homework=sc["homework"],
        occupancy=sc["occupancy"],
    )

    report_approved = bool(sc["report_approved"])
    data_honest = bool(sc["data_honest"])
    gate_blocked = not (report_approved and data_honest)

    gate_notes = []
    if gate_blocked:
        gate_notes.append("Hisobot tasdiqlanmagan yoki ma'lumot haqqoniy emas deb belgilangan — KPI summasi 0")
    elif kpi.final_percent < min_kpi_percent:
        gate_notes.append(f"KPI foizi ({kpi.final_percent:g}%) Minimal KPI chegarasidan ({min_kpi_percent:g}%) past — summa 0")

    if gate_blocked or kpi.final_percent < min_kpi_percent:
        kpi_amount = 0
    else:
        kpi_amount = kpi_pool * kpi.final_percent / 100

    total = round(fix + kpi_amount + bonus, 2)

    return {
        "teacher_id": emp["teacher_id"],
        "full_name": emp["full_name"],
        "grade": None,
        "month": month,
        "fix": round(fix, 2),
        "kpi_pool": round(kpi_pool, 2),
        "kpi_pool_percent": kpi_pool_percent,
        "kpi_percent": kpi.final_percent,
        "effective_kpi_percent": calc_effective_kpi_percent(kpi_pool_percent, kpi.final_percent),
        "kpi_amount": round(kpi_amount, 2),
        "bonus": bonus,
        "total": total,
        "gate_notes": gate_notes,
        "breakdown": {
            "retention": kpi.retention_pct,
            "teacher_performance": kpi.teacher_performance_pct,
            "student_results": kpi.student_results_pct,
            "attendance": kpi.attendance_pct,
            "homework": kpi.homework_pct,
            "occupancy": kpi.occupancy_pct,
        },
        "raw_scores": {
            "retention": sc["retention"],
            "teacher_performance": sc["teacher_performance"],
            "student_results": sc["student_results"],
            "attendance": sc["attendance"],
            "homework": sc["homework"],
            "occupancy": sc["occupancy"],
        },
        "kpi_available": True,
        "report_approved": report_approved,
        "data_honest": data_honest,
        "gate_blocked": gate_blocked,
    }


def _compute_sales_manager_max_waiting(teacher_id: str, month: str, date_str: str) -> float:
    """
    Berilgan kun uchun "Kutishda turganlar" maksimal soni — shu oyning boshidan
    o'sha kungacha (kirmagan holda) TASDIQLANGAN kunlik yozuvlar bo'yicha
    (yangi qabul − yangi sotuv) yig'indisi.
    """
    rows = db.list_approved_sales_manager_daily_before(teacher_id, month, date_str)
    total_admissions = sum((r["new_admissions"] or 0) for r in rows)
    total_sales = sum((r["new_sales"] or 0) for r in rows)
    return max(0, total_admissions - total_sales)


def _compute_for_sales_manager(emp, month: str):
    """
    Sotuv menejeri uchun soddalashtirilgan tizim:
    1) "Fix" — oddiy Oylik maosh (boshqa xodimlar kabi, kunlik formula endi yo'q)
    2) "KPI summasi" — oylik sotuv bonuslari (konversiya, hajm, milestone, combo),
       FAQAT Direktor TASDIQLAGAN kunlik yozuvlardan avtomatik yig'ilgan raqamlar asosida.
       Bu — Scorecard bo'limida ko'rsatish uchun ham ishlatiladi (to'liq avtomatik, qo'lda
       kiritish shart emas).
    """
    fix = emp["fixed_salary"] or 0
    bonus = db.get_total_bonus(emp["teacher_id"], month)

    daily_logs = db.list_sales_manager_daily_in_month(emp["teacher_id"], month)
    approved_logs = [r for r in daily_logs if r["status"] == "approved"]

    total_admissions = sum((r["new_admissions"] or 0) for r in approved_logs)
    total_sales = sum((r["new_sales"] or 0) for r in approved_logs)
    total_trial_attended = sum((r["trial_attended"] or 0) for r in approved_logs)
    total_trial_booked = sum((r["trial_booked"] or 0) for r in approved_logs)
    total_activated = sum((r["activated_count"] or 0) for r in approved_logs)
    extra_sales_over_quota = max(0, total_sales - 25)

    monthly_bonus = calc_sales_manager_monthly_bonus(total_sales, total_admissions)
    kpi_available = len(approved_logs) > 0

    kpi_amount = monthly_bonus.total if kpi_available else 0
    total = round(fix + kpi_amount + bonus, 2)

    return {
        "teacher_id": emp["teacher_id"],
        "full_name": emp["full_name"],
        "grade": None,
        "month": month,
        "fix": round(fix, 2),
        "kpi_pool": 0,
        "kpi_pool_percent": 0,
        "kpi_percent": monthly_bonus.conversion_percent,
        "effective_kpi_percent": 0,
        "kpi_amount": round(kpi_amount, 2),
        "bonus": bonus,
        "total": total,
        "gate_notes": [],
        "breakdown": {
            "total_admissions": total_admissions,
            "total_sales": total_sales,
            "extra_sales_over_quota": extra_sales_over_quota,
            "total_trial_booked": total_trial_booked,
            "total_trial_attended": total_trial_attended,
            "total_activated": total_activated,
            "conversion_percent": monthly_bonus.conversion_percent,
            "conversion_bonus": monthly_bonus.conversion_bonus,
            "volume_bonus": monthly_bonus.volume_bonus,
            "milestone_bonus": monthly_bonus.milestone_bonus,
            "combo_bonus": monthly_bonus.combo_bonus,
            "approved_days": len(approved_logs),
        },
        "raw_scores": None,
        "kpi_available": kpi_available,
    }


def _compute_for_employee(emp, month: str):
    """Har qanday xodim uchun universal dispatcher — rolga qarab to'g'ri hisoblash funksiyasini chaqiradi."""
    if emp["role"] == "Teacher":
        return _compute_for_teacher(emp, month)
    if emp["role"] == "SubjectTeacher":
        return _compute_for_subject_teacher(emp, month)
    if emp["role"] == "EduManager":
        return _compute_for_edu_manager(emp, month)
    if emp["role"] == "SalesManager":
        return _compute_for_sales_manager(emp, month)
    return _compute_for_staff(emp, month)


@app.get("/api/me/payroll")
def api_my_payroll(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    data = _compute_for_employee(emp, month)
    if not data:
        return JSONResponse({"error": f"{month} uchun ma'lumot hali kiritilmagan"}, status_code=404)

    adv = db.get_advance(emp["teacher_id"], month)
    advance_amount = adv["amount"] if adv else 0
    data["advance_given"] = advance_amount
    data["rashchyot"] = calc_rashchyot(data["fix"], advance_amount, data["kpi_amount"], data["bonus"])

    settlement = db.get_settlement(emp["teacher_id"], month)
    data["is_settled"] = settlement is not None
    data["settled_amount"] = settlement["amount"] if settlement else None
    return data


@app.get("/api/me/profile")
def api_my_profile(x_telegram_init_data: str = Header(None)):
    """
    Xodimning asosiy ma'lumotlari (rol, fix summa) — oylik baholashga bog'liq emas,
    shuning uchun hali baholanmagan oylar uchun ham ishlaydi.
    Teacher uchun: fix = grade_narxi * stavka. Boshqa rollar uchun: fix = fixed_salary.
    """
    emp = get_current_employee(x_telegram_init_data)
    if emp["role"] == "Teacher":
        grade_rates = db.get_grade_rates()
        fix = grade_rates.get(emp["grade"], 0) * emp["workload_rate"]
    else:
        fix = emp["fixed_salary"] or 0
    return {
        "teacher_id": emp["teacher_id"],
        "full_name": emp["full_name"],
        "role": emp["role"],
        "grade": emp["grade"],
        "workload_rate": emp["workload_rate"],
        "fix": round(fix, 2),
        "subject": emp["subject"],
        "revenue_percent": emp["revenue_percent"],
    }


# =========================================================
# API — ADMIN: XODIMLAR
# =========================================================

@app.get("/api/employees")
def api_list_employees(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    rows = db.list_employees()
    return [dict(r) for r in rows]


@app.get("/api/employees/directory")
def api_employees_directory(x_telegram_init_data: str = Header(None)):
    """
    Barcha faol xodimlarning ODDIY ro'yxati (ism, rol, teacher_id) — HAR QANDAY autentifikatsiya
    qilingan xodim uchun ochiq (maosh kabi maxfiy moliyaviy ma'lumotlarsiz). Bu — Topshiriqlar
    bo'limida "kimga yuborilsin" tanlovini to'ldirish uchun ishlatiladi.
    """
    get_current_employee(x_telegram_init_data)
    rows = db.list_employees()
    return [
        {"teacher_id": r["teacher_id"], "full_name": r["full_name"], "role": r["role"], "grade": r["grade"]}
        for r in rows
    ]


@app.post("/api/employees")
async def api_add_employee(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()

    required = ["teacher_id", "full_name", "role"]
    for f in required:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    if db.get_employee(body["teacher_id"]):
        raise HTTPException(status_code=400, detail="Bu Teacher ID allaqachon mavjud")

    password = body.get("password") or secrets.token_urlsafe(6)

    db.add_employee(
        teacher_id=body["teacher_id"],
        full_name=body["full_name"],
        role=body["role"],
        grade=body.get("grade"),
        workload_rate=float(body.get("workload_rate", 1.0)),
        phone=body.get("phone"),
        fixed_salary=float(body["fixed_salary"]) if body.get("fixed_salary") is not None else None,
        subject=body.get("subject"),
        revenue_percent=float(body["revenue_percent"]) if body.get("revenue_percent") is not None else None,
        password_hash=hash_password(password),
    )
    # Parol shu yerda ochiq matnda faqat BIR MARTA qaytariladi — admin uni xodimga yetkazadi.
    return {"ok": True, "teacher_id": body["teacher_id"], "password": password}


@app.post("/api/employees/{teacher_id}/set-password")
async def api_set_employee_password(teacher_id: str, request: Request, x_telegram_init_data: str = Header(None)):
    """Admin xodim uchun parolni o'rnatadi/tiklaydi. Parol berilmasa, tasodifiy vaqtinchalik parol yaratiladi."""
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    if not db.get_employee(teacher_id):
        raise HTTPException(status_code=404, detail="Xodim topilmadi")

    body = await request.json()
    password = (body.get("password") or "").strip() or secrets.token_urlsafe(6)
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="Parol kamida 4 belgidan iborat bo'lishi kerak")

    db.set_password(teacher_id, hash_password(password))
    return {"ok": True, "password": password}


@app.patch("/api/employees/{teacher_id}")
async def api_update_employee(teacher_id: str, request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    if not db.get_employee(teacher_id):
        raise HTTPException(status_code=404, detail="Xodim topilmadi")

    body = await request.json()
    db.update_employee(
        teacher_id,
        full_name=body.get("full_name"),
        grade=body.get("grade"),
        workload_rate=float(body["workload_rate"]) if body.get("workload_rate") is not None else None,
        fixed_salary=float(body["fixed_salary"]) if body.get("fixed_salary") is not None else None,
        subject=body.get("subject"),
        revenue_percent=float(body["revenue_percent"]) if body.get("revenue_percent") is not None else None,
        effective_date=body.get("effective_date"),
        updated_by=emp["full_name"],
    )
    return {"ok": True}


@app.get("/api/employees/{teacher_id}/grade-history")
def api_employee_grade_history(teacher_id: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    rows = db.list_grade_history(teacher_id)
    return [dict(r) for r in rows]


@app.post("/api/employees/{teacher_id}/grade-history/{entry_id}/delete")
def api_delete_grade_history_entry(teacher_id: str, entry_id: int, x_telegram_init_data: str = Header(None)):
    """
    Xato yoki chalkash bo'lib qolgan Grade/Stavka tarixi yozuvini butunlay o'chiradi.
    Xodimning JORIY (employees jadvalidagi) stavkasiga tegmaydi — faqat shu bitta
    tarix yozuvini olib tashlaydi.
    """
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    db.delete_grade_history_entry(entry_id)
    return {"ok": True}


@app.post("/api/employees/{teacher_id}/deactivate")
def api_deactivate_employee(teacher_id: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    if not db.get_employee(teacher_id):
        raise HTTPException(status_code=404, detail="Xodim topilmadi")
    db.update_employee(teacher_id, active=False)
    return {"ok": True}


@app.post("/api/employees/{teacher_id}/activate")
def api_activate_employee(teacher_id: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    if not db.get_employee(teacher_id):
        raise HTTPException(status_code=404, detail="Xodim topilmadi")
    db.update_employee(teacher_id, active=True)
    return {"ok": True}


# =========================================================
# API — ADMIN: SCORECARD KIRITISH
# =========================================================

@app.post("/api/scorecard")
async def api_upsert_scorecard(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()

    for f in ["teacher_id", "month"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.upsert_scorecard(
        teacher_id=body["teacher_id"],
        month=body["month"],
        retention=body.get("retention"),
        progress=body.get("progress"),
        attendance=body.get("attendance"),
        homework=body.get("homework"),
        observation=body.get("observation"),
        feedback=body.get("feedback"),
        lms=body.get("lms"),
        updated_by=emp["full_name"],
    )
    return {"ok": True}


@app.get("/api/scorecard")
def api_get_scorecard(teacher_id: str, month: str, x_telegram_init_data: str = Header(None)):
    """Bitta xodimning bitta oy uchun scorecard yozuvini olish (tahrirlash uchun oldindan to'ldirish)."""
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    row = db.get_scorecard(teacher_id, month)
    if not row:
        return {"exists": False, "data": None}
    return {"exists": True, "data": dict(row)}


@app.get("/api/scorecard/history")
def api_scorecard_history(teacher_id: str, months: int = 6, x_telegram_init_data: str = Header(None)):
    """Bitta xodimning kiritilgan scorecard yozuvlari tarixi (oylar bo'yicha, eng yangisi birinchi)."""
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    rows = db.list_scorecards_by_teacher(teacher_id, limit=months)
    out = []
    for r in rows:
        d = dict(r)
        kpi = calc_kpi(
            retention=r["retention"], progress=r["progress"], attendance=r["attendance"],
            homework=r["homework"], observation=r["observation"], feedback=r["feedback"],
            lms=r["lms"],
        )
        d["kpi_percent"] = kpi.final_percent
        out.append(d)
    return out


@app.post("/api/scorecard/delete")
async def api_delete_scorecard(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()

    for f in ["teacher_id", "month"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.delete_scorecard(body["teacher_id"], body["month"])
    return {"ok": True}


@app.post("/api/staff-performance")
async def api_upsert_staff_performance(request: Request, x_telegram_init_data: str = Header(None)):
    """Teacher bo'lmagan rollar uchun oylik samaradorlik foizini kiritish."""
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()

    for f in ["teacher_id", "month"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.upsert_staff_performance(
        teacher_id=body["teacher_id"],
        month=body["month"],
        performance_percent=body.get("performance_percent"),
        updated_by=emp["full_name"],
    )
    return {"ok": True}


@app.post("/api/edu-manager-scorecard")
async def api_upsert_edu_manager_scorecard(request: Request, x_telegram_init_data: str = Header(None)):
    """Ta'lim menejeri uchun 6 mezonli KPI scorecardini kiritish/tahrirlash."""
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()

    for f in ["teacher_id", "month"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.upsert_edu_manager_scorecard(
        teacher_id=body["teacher_id"],
        month=body["month"],
        retention=body.get("retention"),
        teacher_performance=body.get("teacher_performance"),
        student_results=body.get("student_results"),
        attendance=body.get("attendance"),
        homework=body.get("homework"),
        occupancy=body.get("occupancy"),
        report_approved=bool(body.get("report_approved")),
        data_honest=bool(body.get("data_honest")),
        updated_by=emp["full_name"],
    )
    return {"ok": True}


@app.get("/api/edu-manager-scorecard")
def api_get_edu_manager_scorecard(teacher_id: str, month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    row = db.get_edu_manager_scorecard(teacher_id, month)
    if not row:
        return {"exists": False, "data": None}
    return {"exists": True, "data": dict(row)}


@app.post("/api/edu-manager-scorecard/delete")
async def api_delete_edu_manager_scorecard(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()

    for f in ["teacher_id", "month"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.delete_edu_manager_scorecard(body["teacher_id"], body["month"])
    return {"ok": True}


@app.get("/api/edu-manager-scorecard/history")
def api_edu_manager_scorecard_history(teacher_id: str, months: int = 6, x_telegram_init_data: str = Header(None)):
    """Bitta ta'lim menejerining kiritilgan KPI scorecard tarixi."""
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    rows = db.list_edu_manager_scorecards_by_manager(teacher_id, limit=months)
    out = []
    for r in rows:
        kpi = calc_edu_manager_kpi(
            retention=r["retention"], teacher_performance=r["teacher_performance"],
            student_results=r["student_results"], attendance=r["attendance"],
            homework=r["homework"], occupancy=r["occupancy"],
        )
        d = dict(r)
        d["kpi_percent"] = kpi.final_percent
        out.append(d)
    return out


# =========================================================
# API — SOTUV MENEJERI: KUNLIK ISH FAOLIYATI (tasdiqlash workflow'i bilan)
# =========================================================

def _sm_daily_targets(teacher_id: str, date_str: str):
    """Berilgan kun uchun bajarilishi kerak bo'lgan maqsadlar (eslatma uchun)."""
    month = date_str[:7]
    max_waiting = _compute_sales_manager_max_waiting(teacher_id, month, date_str)
    return {
        "repeat_calls_archive": SALES_MANAGER_DAILY_REPEAT_CALLS_TARGET,
        "waiting_contact_count": max_waiting,
        "reinvite_count": SALES_MANAGER_REINVITE_TARGET,
    }


@app.get("/api/sales-manager-daily/me")
def api_sm_daily_me(date: str, x_telegram_init_data: str = Header(None)):
    """Sotuv menejerining o'zi uchun — shu kunlik yozuvni va bugungi maqsadlarni qaytaradi."""
    emp = get_current_employee(x_telegram_init_data)
    if emp["role"] != "SalesManager":
        raise HTTPException(status_code=403, detail="Bu amal faqat Sotuv menejeri uchun")

    row = db.get_sales_manager_daily(emp["teacher_id"], date)
    targets = _sm_daily_targets(emp["teacher_id"], date)

    return {
        "date": date,
        "exists": row is not None,
        "data": dict(row) if row else None,
        "targets": targets,
    }


@app.post("/api/sales-manager-daily/me")
async def api_sm_daily_save(request: Request, x_telegram_init_data: str = Header(None)):
    """Sotuv menejeri o'zining kunlik ma'lumotlarini qoralama sifatida saqlaydi (hali yubormaydi)."""
    emp = get_current_employee(x_telegram_init_data)
    if emp["role"] != "SalesManager":
        raise HTTPException(status_code=403, detail="Bu amal faqat Sotuv menejeri uchun")

    body = await request.json()
    date_str = body.get("date")
    if not date_str:
        raise HTTPException(status_code=400, detail="'date' maydoni to'ldirilishi shart")

    existing = db.get_sales_manager_daily(emp["teacher_id"], date_str)
    if existing and existing["status"] in ("pending", "approved"):
        raise HTTPException(
            status_code=400,
            detail="Bu kun uchun ma'lumot yuborilgan yoki tasdiqlangan — tahrirlash mumkin emas",
        )

    db.upsert_sales_manager_daily(emp["teacher_id"], date_str, body)
    return {"ok": True}


@app.post("/api/sales-manager-daily/me/submit")
async def api_sm_daily_submit(request: Request, x_telegram_init_data: str = Header(None)):
    """Sotuv menejeri kunlik ma'lumotni Direktorga ko'rib chiqish uchun yuboradi."""
    emp = get_current_employee(x_telegram_init_data)
    if emp["role"] != "SalesManager":
        raise HTTPException(status_code=403, detail="Bu amal faqat Sotuv menejeri uchun")

    body = await request.json()
    date_str = body.get("date")
    if not date_str:
        raise HTTPException(status_code=400, detail="'date' maydoni to'ldirilishi shart")

    row = db.get_sales_manager_daily(emp["teacher_id"], date_str)
    if not row:
        raise HTTPException(status_code=400, detail="Avval ma'lumotlarni kiriting")
    if row["status"] in ("pending", "approved"):
        raise HTTPException(status_code=400, detail="Bu yozuv allaqachon yuborilgan yoki tasdiqlangan")

    db.submit_sales_manager_daily(emp["teacher_id"], date_str)
    return {"ok": True}


@app.get("/api/sales-manager-daily/pending")
def api_sm_daily_pending(x_telegram_init_data: str = Header(None)):
    """Direktor/CEO uchun — barcha Sotuv menejerlarning ko'rib chiqilishi kerak bo'lgan kunlik yozuvlari."""
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    rows = db.list_pending_sales_manager_daily()
    out = []
    for r in rows:
        target = db.get_employee(r["teacher_id"])
        d = dict(r)
        d["full_name"] = target["full_name"] if target else r["teacher_id"]
        out.append(d)
    return out


def _sync_company_metrics_for_date(date_str: str, updated_by: str):
    """
    Sotuv menejeri, Administrator va Ta'lim menejerining shu kun uchun TASDIQLANGAN
    barcha yozuvlarini yig'ib, Kompaniya ko'rsatkichi (company_metrics) jadvaliga
    tegishli maydonlarni avtomatik hisoblab yozadi. Direktor qo'lda kiritgan
    tushum/xarajat/topshiriqlar maydonlariga tegilmaydi.
    """
    partial = {}

    sm_rows = db.list_approved_sales_manager_daily_for_date(date_str)
    if sm_rows:
        partial["new_admissions"] = sum((r["new_admissions"] or 0) for r in sm_rows)
        partial["sales_count"] = sum((r["new_sales"] or 0) for r in sm_rows)
        partial["trial_count"] = sum((r["trial_attended"] or 0) for r in sm_rows)
        partial["repeat_sales_calls"] = sum((r["repeat_calls_archive"] or 0) for r in sm_rows)

    admin_rows = db.list_approved_administrator_daily_for_date(date_str)
    if admin_rows:
        partial["admin_contacted_clients"] = sum((r["admin_contacted_clients"] or 0) for r in admin_rows)
        partial["risky_contacted_count"] = sum((r["risky_contacted_count"] or 0) for r in admin_rows)
        partial["frozen_count"] = sum((r["frozen_count"] or 0) for r in admin_rows)
        partial["left_count"] = sum((r["left_count"] or 0) for r in admin_rows)
        partial["complaints_count"] = sum((r["complaints_count"] or 0) for r in admin_rows)

    edu_rows = db.list_approved_edu_manager_daily_for_date(date_str)
    if edu_rows:
        partial["start_active"] = sum((r["start_active"] or 0) for r in edu_rows)
        partial["end_active"] = sum((r["end_active"] or 0) for r in edu_rows)
        partial["risky_count"] = sum((r["risky_count"] or 0) for r in edu_rows)
        att_vals = [r["attendance_percent"] for r in edu_rows if r["attendance_percent"] is not None]
        if att_vals:
            partial["attendance_percent"] = round(sum(att_vals) / len(att_vals), 2)

    if partial:
        db.update_company_metric_partial(date_str, partial, updated_by)


@app.post("/api/sales-manager-daily/approve")
async def api_sm_daily_approve(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)
    body = await request.json()

    for f in ["teacher_id", "date"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.review_sales_manager_daily(body["teacher_id"], body["date"], approved=True, reviewed_by=emp["full_name"])
    _sync_company_metrics_for_date(body["date"], emp["full_name"])
    return {"ok": True}


@app.post("/api/sales-manager-daily/reject")
async def api_sm_daily_reject(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)
    body = await request.json()

    for f in ["teacher_id", "date"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.review_sales_manager_daily(
        body["teacher_id"], body["date"], approved=False,
        reviewed_by=emp["full_name"], note=body.get("note"),
    )
    return {"ok": True}


# =========================================================
# API — ADMINISTRATOR: KUNLIK ISH FAOLIYATI (tasdiqlash workflow'i bilan)
# =========================================================

@app.get("/api/administrator-daily/me")
def api_admin_daily_me(date: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    if emp["role"] != "Administrator":
        raise HTTPException(status_code=403, detail="Bu amal faqat Administrator uchun")

    row = db.get_administrator_daily(emp["teacher_id"], date)
    return {"date": date, "exists": row is not None, "data": dict(row) if row else None}


@app.post("/api/administrator-daily/me")
async def api_admin_daily_save(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    if emp["role"] != "Administrator":
        raise HTTPException(status_code=403, detail="Bu amal faqat Administrator uchun")

    body = await request.json()
    date_str = body.get("date")
    if not date_str:
        raise HTTPException(status_code=400, detail="'date' maydoni to'ldirilishi shart")

    existing = db.get_administrator_daily(emp["teacher_id"], date_str)
    if existing and existing["status"] in ("pending", "approved"):
        raise HTTPException(
            status_code=400,
            detail="Bu kun uchun ma'lumot yuborilgan yoki tasdiqlangan — tahrirlash mumkin emas",
        )

    db.upsert_administrator_daily(emp["teacher_id"], date_str, body)
    return {"ok": True}


@app.post("/api/administrator-daily/me/submit")
async def api_admin_daily_submit(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    if emp["role"] != "Administrator":
        raise HTTPException(status_code=403, detail="Bu amal faqat Administrator uchun")

    body = await request.json()
    date_str = body.get("date")
    if not date_str:
        raise HTTPException(status_code=400, detail="'date' maydoni to'ldirilishi shart")

    row = db.get_administrator_daily(emp["teacher_id"], date_str)
    if not row:
        raise HTTPException(status_code=400, detail="Avval ma'lumotlarni kiriting")
    if row["status"] in ("pending", "approved"):
        raise HTTPException(status_code=400, detail="Bu yozuv allaqachon yuborilgan yoki tasdiqlangan")

    db.submit_administrator_daily(emp["teacher_id"], date_str)
    return {"ok": True}


@app.get("/api/administrator-daily/pending")
def api_admin_daily_pending(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    rows = db.list_pending_administrator_daily()
    out = []
    for r in rows:
        target = db.get_employee(r["teacher_id"])
        d = dict(r)
        d["full_name"] = target["full_name"] if target else r["teacher_id"]
        out.append(d)
    return out


@app.post("/api/administrator-daily/approve")
async def api_admin_daily_approve(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)
    body = await request.json()

    for f in ["teacher_id", "date"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.review_administrator_daily(body["teacher_id"], body["date"], approved=True, reviewed_by=emp["full_name"])
    _sync_company_metrics_for_date(body["date"], emp["full_name"])
    return {"ok": True}


@app.post("/api/administrator-daily/reject")
async def api_admin_daily_reject(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)
    body = await request.json()

    for f in ["teacher_id", "date"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.review_administrator_daily(
        body["teacher_id"], body["date"], approved=False,
        reviewed_by=emp["full_name"], note=body.get("note"),
    )
    return {"ok": True}


# =========================================================
# API — EDU MANAGER: KUNLIK ISH FAOLIYATI (tasdiqlash workflow'i bilan)
# =========================================================

@app.get("/api/edu-manager-daily/me")
def api_edu_daily_me(date: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    if emp["role"] != "EduManager":
        raise HTTPException(status_code=403, detail="Bu amal faqat Ta'lim menejeri uchun")

    row = db.get_edu_manager_daily(emp["teacher_id"], date)
    return {"date": date, "exists": row is not None, "data": dict(row) if row else None}


@app.post("/api/edu-manager-daily/me")
async def api_edu_daily_save(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    if emp["role"] != "EduManager":
        raise HTTPException(status_code=403, detail="Bu amal faqat Ta'lim menejeri uchun")

    body = await request.json()
    date_str = body.get("date")
    if not date_str:
        raise HTTPException(status_code=400, detail="'date' maydoni to'ldirilishi shart")

    existing = db.get_edu_manager_daily(emp["teacher_id"], date_str)
    if existing and existing["status"] in ("pending", "approved"):
        raise HTTPException(
            status_code=400,
            detail="Bu kun uchun ma'lumot yuborilgan yoki tasdiqlangan — tahrirlash mumkin emas",
        )

    db.upsert_edu_manager_daily(emp["teacher_id"], date_str, body)
    return {"ok": True}


@app.post("/api/edu-manager-daily/me/submit")
async def api_edu_daily_submit(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    if emp["role"] != "EduManager":
        raise HTTPException(status_code=403, detail="Bu amal faqat Ta'lim menejeri uchun")

    body = await request.json()
    date_str = body.get("date")
    if not date_str:
        raise HTTPException(status_code=400, detail="'date' maydoni to'ldirilishi shart")

    row = db.get_edu_manager_daily(emp["teacher_id"], date_str)
    if not row:
        raise HTTPException(status_code=400, detail="Avval ma'lumotlarni kiriting")
    if row["status"] in ("pending", "approved"):
        raise HTTPException(status_code=400, detail="Bu yozuv allaqachon yuborilgan yoki tasdiqlangan")

    db.submit_edu_manager_daily(emp["teacher_id"], date_str)
    return {"ok": True}


@app.get("/api/edu-manager-daily/pending")
def api_edu_daily_pending(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    rows = db.list_pending_edu_manager_daily()
    out = []
    for r in rows:
        target = db.get_employee(r["teacher_id"])
        d = dict(r)
        d["full_name"] = target["full_name"] if target else r["teacher_id"]
        out.append(d)
    return out


@app.post("/api/edu-manager-daily/approve")
async def api_edu_daily_approve(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)
    body = await request.json()

    for f in ["teacher_id", "date"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.review_edu_manager_daily(body["teacher_id"], body["date"], approved=True, reviewed_by=emp["full_name"])
    _sync_company_metrics_for_date(body["date"], emp["full_name"])
    return {"ok": True}


@app.post("/api/edu-manager-daily/reject")
async def api_edu_daily_reject(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)
    body = await request.json()

    for f in ["teacher_id", "date"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.review_edu_manager_daily(
        body["teacher_id"], body["date"], approved=False,
        reviewed_by=emp["full_name"], note=body.get("note"),
    )
    return {"ok": True}


# =========================================================
# API — ADMIN: OYLIK MOLIYA (BARCHA O'QITUVCHILAR)
# =========================================================

@app.get("/api/payroll")
def api_payroll_all(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    staff = db.list_employees()
    results = []
    missing = []
    avans_percent = db.get_avans_percent()
    for t in staff:
        data = _compute_for_employee(t, month)

        adv = db.get_advance(t["teacher_id"], month)
        advance_amount = adv["amount"] if adv else 0
        data["advance_given"] = advance_amount
        data["advance_is_given"] = adv is not None
        data["advance_is_manual"] = bool(adv["is_manual"]) if adv else False
        data["auto_advance_preview"] = calc_avans(data["fix"], avans_percent)
        data["rashchyot"] = calc_rashchyot(data["fix"], advance_amount, data["kpi_amount"], data["bonus"])

        settlement = db.get_settlement(t["teacher_id"], month)
        data["is_settled"] = settlement is not None
        data["settled_amount"] = settlement["amount"] if settlement else None
        data["settlement_is_manual"] = bool(settlement["is_manual"]) if settlement else False

        data["role"] = t["role"]
        results.append(data)

        if not data["kpi_available"]:
            missing.append({"teacher_id": t["teacher_id"], "full_name": t["full_name"], "role": t["role"]})

    return {
        "month": month,
        "results": results,
        "missing_scorecard": missing,
        "total": sum(r["total"] for r in results),
        "total_rashchyot": sum(r["rashchyot"] for r in results),
    }


# =========================================================
# API — ADMIN: BONUS QO'SHISH
# =========================================================

@app.post("/api/bonus")
async def api_add_bonus(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()

    for f in ["teacher_id", "month", "amount"]:
        if body.get(f) is None:
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.add_bonus(
        teacher_id=body["teacher_id"],
        month=body["month"],
        amount=float(body["amount"]),
        note=body.get("note", ""),
        created_by=emp["full_name"],
    )
    return {"ok": True}


# =========================================================
# API — ADMIN: AVANS
# =========================================================

@app.post("/api/advance")
async def api_give_advance(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()

    for f in ["teacher_id", "month"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    target = db.get_employee(body["teacher_id"])
    if not target:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")

    manual_amount = body.get("manual_amount")
    if manual_amount is not None:
        amount = float(manual_amount)
        is_manual = True
    else:
        fix = _compute_for_employee(target, body["month"])["fix"]
        avans_percent = db.get_avans_percent()
        amount = calc_avans(fix, avans_percent)
        is_manual = False

    db.add_or_update_advance(
        teacher_id=body["teacher_id"], month=body["month"], amount=amount,
        given_by=emp["full_name"], is_manual=is_manual,
    )
    return {"ok": True, "amount": amount}


@app.get("/api/advance")
def api_list_advances(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    rows = db.list_advances(month)
    return [dict(r) for r in rows]


@app.post("/api/settlement")
async def api_give_settlement(request: Request, x_telegram_init_data: str = Header(None)):
    """Yakuniy hisob-kitob (Rashchyot) to'landi deb belgilash — hozirgi hisoblangan summa saqlanadi."""
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()

    for f in ["teacher_id", "month"]:
        if not body.get(f):
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    target = db.get_employee(body["teacher_id"])
    if not target:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")

    data = _compute_for_employee(target, body["month"])
    if not data["kpi_available"]:
        raise HTTPException(
            status_code=400,
            detail="Rashchyot berish uchun avval shu oy uchun Scorecard kiritilishi kerak",
        )

    adv = db.get_advance(target["teacher_id"], body["month"])
    advance_amount = adv["amount"] if adv else 0

    manual_amount = body.get("manual_amount")
    if manual_amount is not None:
        rashchyot = float(manual_amount)
        is_manual = True
    else:
        rashchyot = calc_rashchyot(data["fix"], advance_amount, data["kpi_amount"], data["bonus"])
        is_manual = False

    db.add_or_update_settlement(
        teacher_id=body["teacher_id"], month=body["month"], amount=rashchyot,
        given_by=emp["full_name"], is_manual=is_manual,
    )
    return {"ok": True, "amount": rashchyot}


@app.get("/api/settlement")
def api_list_settlements(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    rows = db.list_settlements(month)
    return [dict(r) for r in rows]


@app.get("/api/finance-summary")
def api_finance_summary(month: str, x_telegram_init_data: str = Header(None)):
    """
    Kompaniya moliyasi (P&L) — oy uchun kompaniya tushumi/xarajati va jami ish haqi xarajati
    birlashtirilgan holda, sof foydani ko'rsatadi.
    """
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    company_rows = db.list_company_metrics_for_month(month)
    company_revenue = 0.0
    company_expense = 0.0
    for r in company_rows:
        company_revenue += (r["click_revenue"] or 0) + (r["card_revenue"] or 0) + (r["cash_revenue"] or 0)
        company_expense += (r["click_expense"] or 0) + (r["card_expense"] or 0) + (r["cash_expense"] or 0)

    staff = db.list_employees()
    payroll_fix = payroll_kpi = payroll_bonus = 0.0
    for t in staff:
        data = _compute_for_employee(t, month)
        if data:
            payroll_fix += data["fix"]
            payroll_kpi += data["kpi_amount"]
            payroll_bonus += data["bonus"]
    payroll_total = payroll_fix + payroll_kpi + payroll_bonus

    net_profit = company_revenue - company_expense - payroll_total

    return {
        "month": month,
        "days_with_data": len(company_rows),
        "company_revenue": round(company_revenue, 2),
        "company_expense": round(company_expense, 2),
        "payroll_fix": round(payroll_fix, 2),
        "payroll_kpi": round(payroll_kpi, 2),
        "payroll_bonus": round(payroll_bonus, 2),
        "payroll_total": round(payroll_total, 2),
        "net_profit": round(net_profit, 2),
    }


# =========================================================
# API — ADMIN: OYLIK TUSHUM VA RENTABELLIK
# =========================================================

@app.post("/api/revenue")
async def api_set_revenue(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()

    for f in ["teacher_id", "month", "amount"]:
        if body.get(f) is None:
            raise HTTPException(status_code=400, detail=f"'{f}' maydoni to'ldirilishi shart")

    db.upsert_revenue(
        teacher_id=body["teacher_id"], month=body["month"],
        amount=float(body["amount"]), created_by=emp["full_name"],
    )
    return {"ok": True}


@app.get("/api/revenue")
def api_list_revenue(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    teachers = db.list_employees(role="Teacher")
    subject_teachers = db.list_employees(role="SubjectTeacher")

    rows = []
    for t in teachers + subject_teachers:
        rev = db.get_revenue(t["teacher_id"], month)
        revenue_amount = rev["amount"] if rev else None

        data = _compute_for_employee(t, month)
        fix = data["fix"]
        kpi_amount = data["kpi_amount"]
        bonus = data["bonus"]
        total_payroll = data["total"]

        payroll_percent = (
            round((total_payroll / revenue_amount) * 100, 1)
            if (revenue_amount and revenue_amount > 0)
            else None
        )

        rows.append({
            "teacher_id": t["teacher_id"],
            "full_name": t["full_name"],
            "grade": t["grade"] or t["subject"],
            "revenue": revenue_amount,
            "fix": round(fix, 2),
            "kpi_amount": round(kpi_amount, 2),
            "bonus": round(bonus, 2),
            "total_payroll": round(total_payroll, 2),
            "payroll_percent": payroll_percent,
        })

    return {"month": month, "rows": rows}


@app.get("/api/revenue/history")
def api_revenue_history(teacher_id: str, months: int = 6, x_telegram_init_data: str = Header(None)):
    """Bitta xodimning oylar bo'yicha tushum tarixi (tahrirlash uchun ham ishlatiladi)."""
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    target = db.get_employee(teacher_id)
    if not target:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")

    rows = []
    for m in _last_n_months(months):
        rev = db.get_revenue(teacher_id, m)
        revenue_amount = rev["amount"] if rev else None
        data = _compute_for_employee(target, m)
        total_payroll = data["total"]
        payroll_percent = (
            round((total_payroll / revenue_amount) * 100, 1)
            if (revenue_amount and revenue_amount > 0)
            else None
        )
        rows.append({
            "month": m,
            "revenue": revenue_amount,
            "total_payroll": round(total_payroll, 2),
            "payroll_percent": payroll_percent,
        })

    return {"teacher_id": teacher_id, "full_name": target["full_name"], "rows": rows}


# =========================================================
# API — ADMIN: DASHBOARD
# =========================================================

@app.get("/api/dashboard")
def api_dashboard(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    all_active = db.list_employees()
    teachers = db.list_employees(role="Teacher")

    # Top-3/Bottom-3 reytingi — bu o'qituvchilarning o'qitish sifati bo'yicha (scorecard asosida),
    # shuning uchun faqat Teacher rolidagilar bo'yicha hisoblanadi.
    teacher_results = []
    missing = []
    for t in teachers:
        data = _compute_for_teacher(t, month)
        if data["kpi_available"]:
            teacher_results.append(data)
        else:
            missing.append({"teacher_id": t["teacher_id"], "full_name": t["full_name"]})

    # Jami xarajat — endi BARCHA faol xodimlar (o'qituvchi, direktor, administrator va h.k.) bo'yicha,
    # chunki bu markazning haqiqiy umumiy ish haqi xarajatini ko'rsatishi kerak.
    total_fix = total_kpi = total_bonus = 0.0
    for t in all_active:
        data = _compute_for_employee(t, month)
        if data:
            total_fix += data["fix"]
            total_kpi += data["kpi_amount"]
            total_bonus += data["bonus"]

    total_expense = total_fix + total_kpi + total_bonus

    active_ids_all = {t["teacher_id"] for t in all_active}
    advances = [a for a in db.list_advances(month) if a["teacher_id"] in active_ids_all]
    total_advance = sum(a["amount"] for a in advances)

    active_teacher_ids_for_revenue = {t["teacher_id"] for t in teachers}
    revenues = [r for r in db.list_revenues(month) if r["teacher_id"] in active_teacher_ids_for_revenue]
    total_revenue = sum(r["amount"] for r in revenues) if revenues else None
    total_profit = (total_revenue - total_expense) if total_revenue is not None else None

    prev_month = _prev_month(month)
    prev_total_expense = 0.0
    for t in all_active:
        pdata = _compute_for_employee(t, prev_month)
        if pdata:
            prev_total_expense += pdata["total"]

    sorted_by_kpi = sorted(teacher_results, key=lambda r: r["kpi_percent"], reverse=True)
    # Top-3'ga faqat KPI 70% dan yuqori bo'lganlar kiradi — past ko'rsatkichni "top" sifatida ko'rsatish noto'g'ri
    eligible_for_top = [r for r in sorted_by_kpi if r["kpi_percent"] >= 70]
    top3 = eligible_for_top[:3]

    # Bottom-3'dan Top-3'da allaqachon bo'lganlar chiqarib tashlanadi — aks holda kam sonli
    # o'qituvchilar bo'lganda (masalan 4-5 kishi) bitta odam ikkalasida ham chiqib qolishi mumkin edi
    top3_ids = {r["teacher_id"] for r in top3}
    remaining_for_bottom = [r for r in sorted_by_kpi if r["teacher_id"] not in top3_ids]
    bottom3 = list(reversed(remaining_for_bottom[-3:])) if remaining_for_bottom else []

    return {
        "month": month,
        "total_expense": round(total_expense, 2),
        "prev_total_expense": round(prev_total_expense, 2),
        "total_fix": round(total_fix, 2),
        "total_kpi": round(total_kpi, 2),
        "total_bonus": round(total_bonus, 2),
        "total_advance": round(total_advance, 2),
        "total_revenue": round(total_revenue, 2) if total_revenue is not None else None,
        "total_profit": round(total_profit, 2) if total_profit is not None else None,
        "active_employees": len(all_active),
        "missing_scorecard": missing,
        "top3": [{"full_name": r["full_name"], "kpi_percent": r["kpi_percent"]} for r in top3],
        "bottom3": [{"full_name": r["full_name"], "kpi_percent": r["kpi_percent"]} for r in bottom3],
    }


ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")


async def _call_claude(system_prompt: str, user_prompt: str, max_tokens: int = 500) -> str:
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="AI xulosasi uchun ANTHROPIC_API_KEY Railway Variables bo'limiga qo'shilishi kerak",
        )
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            },
            json={
                "model": "claude-haiku-4-5-20251001",
                "max_tokens": max_tokens,
                "system": system_prompt,
                "messages": [{"role": "user", "content": user_prompt}],
            },
        )
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail=f"AI xizmati xatosi: {resp.text[:200]}")
        data = resp.json()
        return "".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()


def _gather_dashboard_ai_data(month: str) -> dict:
    """Dashboard'dagi asosiy ko'rsatkichlarni AI xulosasi uchun bitta ixcham lug'atga yig'adi."""
    all_active = db.list_employees()
    teachers = db.list_employees(role="Teacher")

    teacher_results = []
    missing = []
    for t in teachers:
        data = _compute_for_teacher(t, month)
        if data["kpi_available"]:
            teacher_results.append(data)
        else:
            missing.append(t["full_name"])

    total_fix = total_kpi = total_bonus = 0.0
    for t in all_active:
        data = _compute_for_employee(t, month)
        if data:
            total_fix += data["fix"]
            total_kpi += data["kpi_amount"]
            total_bonus += data["bonus"]
    total_expense = total_fix + total_kpi + total_bonus

    prev_month = _prev_month(month)
    prev_total_expense = 0.0
    for t in all_active:
        pdata = _compute_for_employee(t, prev_month)
        if pdata:
            prev_total_expense += pdata["total"]

    avg_kpi = round(sum(r["kpi_percent"] for r in teacher_results) / len(teacher_results), 1) if teacher_results else None
    sorted_by_kpi = sorted(teacher_results, key=lambda r: r["kpi_percent"])
    weakest = [{"full_name": r["full_name"], "kpi_percent": r["kpi_percent"]} for r in sorted_by_kpi[:3]]
    strongest = [{"full_name": r["full_name"], "kpi_percent": r["kpi_percent"]} for r in sorted_by_kpi[-3:]]

    year, mon = map(int, month.split("-"))
    import calendar as _cal
    days_in_month = _cal.monthrange(year, mon)[1]
    metrics_rows = db.list_company_metrics_range(f"{month}-01", f"{month}-{days_in_month:02d}")
    sum_fields = ["new_admissions", "sales_count", "left_count", "frozen_count", "trial_count", "complaints_count"]
    sums = {f: 0 for f in sum_fields}
    attendance_values = []
    for r in metrics_rows:
        for f in sum_fields:
            v = r[f]
            if v is not None:
                sums[f] += v
        if r["attendance_percent"] is not None:
            attendance_values.append(r["attendance_percent"])
    avg_attendance = round(sum(attendance_values) / len(attendance_values), 1) if attendance_values else None

    return {
        "month": month,
        "total_expense": round(total_expense, 2),
        "prev_total_expense": round(prev_total_expense, 2),
        "active_employees": len(all_active),
        "teachers_without_scorecard": missing,
        "avg_teacher_kpi_percent": avg_kpi,
        "weakest_teachers": weakest,
        "strongest_teachers": strongest,
        "new_admissions": sums["new_admissions"],
        "sales_count": sums["sales_count"],
        "left_count": sums["left_count"],
        "frozen_count": sums["frozen_count"],
        "trial_count": sums["trial_count"],
        "complaints_count": sums["complaints_count"],
        "avg_attendance_percent": avg_attendance,
    }


DASHBOARD_AI_SYSTEM_PROMPT = """Sen "English House" til markazi uchun ishlaydigan moliyaviy-operatsion tahlilchisan.
Senga JSON formatida shu oyning haqiqiy ko'rsatkichlari beriladi. Shu ma'lumotlar ASOSIDA, CEO uchun
qisqa (3-5 gap), aniq, professional oylik xulosa yoz.

QOIDALAR:
- FAQAT berilgan raqamlarga asoslan — hech qanday taxmin, o'ylab topilgan fakt qo'shma.
- Eng muhim narsalarni ajratib ko'rsat: xarajat o'tgan oyga nisbatan qanday o'zgargan, o'rtacha KPI qanday,
  qaysi o'qituvchilar past natija ko'rsatgan, talabalar harakati (yangi qabul/chiqib ketish/muzlatish) qanday.
- Agar biror narsa muammoli ko'rinsa (masalan ko'p talaba chiqib ketgan, past KPI), buni aniq ayt.
- Agar hammasi yaxshi bo'lsa, buni ham aniq ayt — sun'iy muammo o'ylab topma.
- Raqamlarni "so'm" bilan yoki foiz belgisi bilan tabiiy tarzda yoz.

TIL VA YOZUV SHAKLI HAQIDA QAT'IY QOIDALAR:
- FAQAT o'zbek tilida, FAQAT lotin alifbosida yoz. Rus tilidagi biror bir so'z yoki oy nomi
  (masalan "Август", "Сентябрь") ishlatma — oylarni doim o'zbekcha lotin yoz: Yanvar, Fevral,
  Mart, Aprel, May, Iyun, Iyul, Avgust, Sentyabr, Oktyabr, Noyabr, Dekabr.
- Markdown belgilaridan MUTLAQO foydalanma: **, ##, #, *, -, `, [ ] kabi belgilarni yozma.
  Sarlavha, ro'yxat belgisi yoki qalin matn kerak bo'lsa, oddiy so'zlar bilan ifodala
  (masalan "Muhimi:" yoki "Diqqat:" kabi so'z bilan boshla, belgi bilan emas).
- Faqat oddiy, sof matn (plain text) yoz — hech qanday formatlash belgisisiz.
"""


@app.get("/api/dashboard/ai-summary")
def api_get_dashboard_ai_summary(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    row = db.get_ai_summary("dashboard_monthly", month)
    if not row:
        return {"exists": False, "summary": None, "generated_at": None}
    return {"exists": True, "summary": row["summary_text"], "generated_at": row["generated_at"]}


@app.post("/api/dashboard/ai-summary")
async def api_generate_dashboard_ai_summary(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    data = _gather_dashboard_ai_data(month)
    user_prompt = json.dumps(data, ensure_ascii=False, indent=2)

    raw_summary = await _call_claude(DASHBOARD_AI_SYSTEM_PROMPT, user_prompt, max_tokens=500)
    summary_text = _strip_markdown_symbols(raw_summary)
    db.save_ai_summary("dashboard_monthly", month, summary_text, generated_by=emp["full_name"])

    return {"exists": True, "summary": summary_text, "generated_at": db.get_ai_summary("dashboard_monthly", month)["generated_at"]}


def _strip_markdown_symbols(text: str) -> str:
    """
    Xavfsizlik choralari sifatida — AI ba'zan ko'rsatmaga qaramay Markdown belgisini
    (**, #, *, -) qoldirib yuborishi mumkin. Bu funksiya shunday belgilarni tozalab,
    sof matn qoldiradi.
    """
    import re
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[\*\-]\s+", "", text, flags=re.MULTILINE)
    return text.strip()


# =========================================================
# API — ADMIN: HISOBOTLAR
# =========================================================

@app.get("/api/reports/totals")
def api_reports_totals(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    teachers = db.list_employees(role="Teacher")
    grade_rates = db.get_grade_rates()

    total_stavka = sum(t["workload_rate"] for t in teachers)

    # Jami FIX va Jami Bonus — BARCHA faol o'qituvchilar bo'yicha (scorecard kiritilgan-kiritilmaganidan qat'i nazar,
    # chunki FIX faqat grade+stavkaga bog'liq, bonus esa scorecard'dan mustaqil beriladi)
    total_fix = 0.0
    total_bonus = 0.0
    for t in teachers:
        total_fix += grade_rates.get(t["grade"], 0) * t["workload_rate"]
        total_bonus += db.get_total_bonus(t["teacher_id"], month)

    # Jami KPI — faqat scorecard kiritilgan xodimlar bo'yicha (KPI faqat scorecard bo'lsa hisoblanadi)
    total_kpi = 0.0
    for t in teachers:
        data = _compute_for_teacher(t, month)
        if data:
            total_kpi += data["kpi_amount"]

    avg_stavka_amount = round(total_fix / total_stavka, 2) if total_stavka > 0 else 0

    # O'qituvchi ulushi — faqat HOZIRGI FAOL o'qituvchilar bo'yicha (Tushum bo'limida ko'rinadigan
    # ro'yxat bilan bir xil bo'lishi uchun; faolsizlantirilgan/eski xodimlarning eski tushum yozuvlari
    # bu hisobga qo'shilmaydi)
    active_teacher_ids = {t["teacher_id"] for t in teachers}
    revenues = [r for r in db.list_revenues(month) if r["teacher_id"] in active_teacher_ids]
    total_revenue = sum(r["amount"] for r in revenues)
    total_expense_with_revenue = 0.0
    for r in revenues:
        t = db.get_employee(r["teacher_id"])
        if t:
            total_expense_with_revenue += _expense_for_teacher(t, month, grade_rates)
    avg_teacher_share_percent = (
        round((total_expense_with_revenue / total_revenue) * 100, 1) if total_revenue > 0 else None
    )

    return {
        "month": month,
        "total_stavka": round(total_stavka, 2),
        "total_fix": round(total_fix, 2),
        "total_kpi": round(total_kpi, 2),
        "total_bonus": round(total_bonus, 2),
        "teacher_count": len(teachers),
        "avg_stavka_amount": avg_stavka_amount,
        "total_revenue": round(total_revenue, 2) if revenues else None,
        "avg_teacher_share_percent": avg_teacher_share_percent,
    }


@app.get("/api/reports/history")
def api_reports_history(teacher_id: str, months: int = 6, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    target = db.get_employee(teacher_id)
    if not target:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")

    rows = []
    for m in _last_n_months(months):
        data = _compute_for_teacher(target, m)
        rows.append({
            "month": m,
            "fix": data["fix"],
            "kpi_amount": data["kpi_amount"] if data["kpi_available"] else None,
            "kpi_percent": data["kpi_percent"] if data["kpi_available"] else None,
            "bonus": data["bonus"],
            "total": data["total"],
        })
    return {"teacher_id": teacher_id, "rows": rows}


@app.get("/api/reports/scorecard-summary")
def api_reports_scorecard_summary(month: str, x_telegram_init_data: str = Header(None)):
    """
    Barcha o'qituvchilarning (faqat Teacher roli) shu oy uchun Scorecard natijalari bo'yicha
    har bir KPI mezoni (yo'nalishi) kesimida o'rtacha ko'rsatkich — xodimlar soniga bo'lingan holda.
    Bundan tashqari, har bir o'qituvchining har bir mezon bo'yicha shaxsiy XOM foizi va BALL foizi,
    va Sozlamalardagi Gate chegarasiga nisbatan holati ham qaytariladi.
    """
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    gates = db.get_criterion_gates()
    teachers = db.list_employees(role="Teacher")
    breakdowns = []
    raw_scores_list = []
    kpi_percents = []
    missing = []
    teacher_rows = []

    criteria_defs = [
        {"key": "retention", "label": "🔁 Retention", "max": 25, "max_raw": 100},
        {"key": "progress", "label": "📈 Student Progress", "max": 25, "max_raw": 100},
        {"key": "attendance", "label": "🗓️ Attendance", "max": 10, "max_raw": 100},
        {"key": "homework", "label": "📝 Homework", "max": 10, "max_raw": 100},
        {"key": "observation", "label": "👀 Observation", "max": 15, "max_raw": 25},
        {"key": "feedback", "label": "💬 Student Feedback", "max": 10, "max_raw": 10},
        {"key": "lms", "label": "💻 Platforma intizomi", "max": 5, "max_raw": 5},
    ]

    for t in teachers:
        data = _compute_for_teacher(t, month)
        if data["kpi_available"]:
            breakdowns.append(data["breakdown"])
            raw_scores_list.append(data["raw_scores"])
            kpi_percents.append(data["kpi_percent"])

            row = {"teacher_id": t["teacher_id"], "full_name": t["full_name"], "kpi_percent": data["kpi_percent"]}
            for c in criteria_defs:
                ball = data["breakdown"][c["key"]]
                raw_val = data["raw_scores"][c["key"]] or 0
                raw_percent = round((raw_val / c["max_raw"]) * 100, 1)
                row[f'{c["key"]}_percent'] = round((ball / c["max"]) * 100, 1)
                row[f'{c["key"]}_raw'] = raw_val
                row[f'{c["key"]}_raw_percent'] = raw_percent
                row[f'{c["key"]}_below_gate'] = gates.get(c["key"], 0) > 0 and raw_percent < gates[c["key"]]
            teacher_rows.append(row)
        else:
            missing.append({"teacher_id": t["teacher_id"], "full_name": t["full_name"]})

    count = len(breakdowns)

    def avg_of(key):
        if count == 0:
            return None
        return sum(b[key] for b in breakdowns) / count

    def avg_raw_of(key):
        if count == 0:
            return None
        return sum((r[key] or 0) for r in raw_scores_list) / count

    criteria = []
    for c in criteria_defs:
        avg_ball = avg_of(c["key"])
        avg_percent = round((avg_ball / c["max"]) * 100, 1) if avg_ball is not None else None
        avg_raw = avg_raw_of(c["key"])
        avg_raw_percent = round((avg_raw / c["max_raw"]) * 100, 1) if avg_raw is not None else None
        below_gate_count = sum(
            1 for r in teacher_rows if r[f'{c["key"]}_below_gate']
        ) if gates.get(c["key"], 0) > 0 else 0
        criteria.append({
            "key": c["key"],
            "label": c["label"],
            "avg_ball": round(avg_ball, 2) if avg_ball is not None else None,
            "max_ball": c["max"],
            "avg_percent": avg_percent,
            "avg_raw": round(avg_raw, 1) if avg_raw is not None else None,
            "avg_raw_percent": avg_raw_percent,
            "gate": gates.get(c["key"], 0),
            "below_gate_count": below_gate_count,
        })

    avg_kpi_percent = round(sum(kpi_percents) / count, 1) if count > 0 else None

    return {
        "month": month,
        "teacher_count": count,
        "missing_scorecard": missing,
        "avg_kpi_percent": avg_kpi_percent,
        "criteria": criteria,
        "teachers": teacher_rows,
    }


# =========================================================
# API — EDU MANAGER: KPI REYTINGI VA HISOBOTLAR (moliyaviy ma'lumotsiz)
# =========================================================

@app.get("/api/kpi-ranking")
def api_kpi_ranking(month: str, x_telegram_init_data: str = Header(None)):
    """
    Faqat KPI ko'rsatkichi — moliyaviy summasiz. Edu Manager sahifasi uchun.
    """
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    teachers = db.list_employees(role="Teacher")
    ranked = []
    missing = []
    for t in teachers:
        data = _compute_for_teacher(t, month)
        if data["kpi_available"]:
            ranked.append({
                "teacher_id": t["teacher_id"],
                "full_name": t["full_name"],
                "grade": t["grade"],
                "kpi_percent": data["kpi_percent"],
            })
        else:
            missing.append({"teacher_id": t["teacher_id"], "full_name": t["full_name"]})

    ranked.sort(key=lambda r: r["kpi_percent"], reverse=True)
    return {"month": month, "ranked": ranked, "missing_scorecard": missing}


@app.get("/api/reports/kpi-summary")
def api_reports_kpi_summary(month: str, x_telegram_init_data: str = Header(None)):
    """
    Edu Manager uchun hisobot — faqat KPI ko'rsatkichlari, moliyaviy summalarsiz.
    """
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    teachers = db.list_employees(role="Teacher")
    kpi_values = []
    missing = []
    green = yellow = red = 0
    for t in teachers:
        data = _compute_for_teacher(t, month)
        if data["kpi_available"]:
            p = data["kpi_percent"]
            kpi_values.append(p)
            if p >= 90:
                green += 1
            elif p >= 80:
                yellow += 1
            else:
                red += 1
        else:
            missing.append({"teacher_id": t["teacher_id"], "full_name": t["full_name"]})

    avg_kpi = round(sum(kpi_values) / len(kpi_values), 1) if kpi_values else None

    trend = []
    for m in reversed(_last_n_months(6)):
        m_values = []
        for t in teachers:
            data = _compute_for_teacher(t, m)
            if data["kpi_available"]:
                m_values.append(data["kpi_percent"])
        trend.append({
            "month": m,
            "avg_kpi_percent": round(sum(m_values) / len(m_values), 1) if m_values else None,
        })

    return {
        "month": month,
        "teacher_count": len(teachers),
        "avg_kpi_percent": avg_kpi,
        "green_count": green,
        "yellow_count": yellow,
        "red_count": red,
        "missing_scorecard": missing,
        "trend": trend,
    }

@app.get("/api/settings")
def api_get_settings(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    return {
        "grade_rates": db.get_grade_rates(),
        "kpi_pool_percent": db.get_kpi_pool_percent(),
        "avans_percent": db.get_avans_percent(),
        "min_kpi_percent": db.get_min_kpi_percent(),
        "criterion_gates": db.get_criterion_gates(),
        "groups_per_stavka": db.get_groups_per_stavka(),
    }


@app.get("/api/settings/grade-rate-impact")
def api_grade_rate_impact(grade: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    return {"count": db.count_active_employees_by_grade(grade)}


@app.get("/api/settings/avans-impact")
def api_avans_impact(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    return {"count": db.count_active_employees()}


@app.post("/api/settings/grade-rate")
async def api_set_grade_rate(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    db.set_grade_rate(body["grade"], float(body["rate"]))
    return {"ok": True}


@app.post("/api/settings/kpi-pool-percent")
async def api_set_kpi_pool_percent(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    db.set_kpi_pool_percent(float(body["value"]))
    return {"ok": True}


@app.post("/api/settings/avans-percent")
async def api_set_avans_percent(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    db.set_avans_percent(float(body["value"]))
    return {"ok": True}


@app.post("/api/settings/min-kpi-percent")
async def api_set_min_kpi_percent(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    db.set_min_kpi_percent(float(body["value"]))
    return {"ok": True}


@app.post("/api/settings/groups-per-stavka")
async def api_set_groups_per_stavka(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    db.set_groups_per_stavka(float(body["value"]))
    return {"ok": True}


@app.post("/api/employees/{teacher_id}/group-change")
async def api_employee_group_change(teacher_id: str, request: Request, x_telegram_init_data: str = Header(None)):
    """
    Xodimga (Teacher) guruh qo'shish/ayirish — qulaylik uchun: administrator stavkani o'zi
    hisoblamaydi, faqat "+1 guruh" yoki "-1 guruh" va sanani kiritadi. Tizim joriy guruh
    sonini avtomatik hisoblab, yangi stavkani (kun darajasida, ko'rsatilgan sanadan
    boshlab kuchga kiradigan) o'zi belgilaydi.
    """
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    target = db.get_employee(teacher_id)
    if not target:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")
    if target["role"] != "Teacher":
        raise HTTPException(status_code=400, detail="Guruh o'zgarishi faqat Teacher uchun")

    body = await request.json()
    effective_date = body.get("effective_date")
    delta_groups = body.get("delta_groups")
    note = body.get("note")
    if not effective_date or delta_groups is None:
        raise HTTPException(status_code=400, detail="'effective_date' va 'delta_groups' maydonlari to'ldirilishi shart")

    groups_per_stavka = db.get_groups_per_stavka()

    # Joriy (korsatilgan SANAGA nisbatan oldingi) guruh sonini aniqlaymiz — bu, agar
    # bazada shu sanadan KEYINGI (masalan boshqa oy uchun oldin kiritilgan) yozuv
    # bo'lsa ham, ularni aralashtirib yubormaydi.
    baseline_info = db.get_stavka_baseline_before_date(teacher_id, effective_date)
    if baseline_info and baseline_info["group_count"] is not None:
        current_groups = baseline_info["group_count"]
    elif baseline_info:
        current_groups = round((baseline_info["workload_rate"] or 0) * groups_per_stavka)
    else:
        current_workload = target["workload_rate"] or 0
        current_groups = round(current_workload * groups_per_stavka)

    new_groups = max(0, current_groups + float(delta_groups))
    new_workload_rate = new_groups / groups_per_stavka if groups_per_stavka > 0 else 0

    db.update_employee(teacher_id, workload_rate=new_workload_rate, effective_date=effective_date, updated_by=emp["full_name"])
    # update_employee o'zi ham oddiy (group_count/note'siz) tarix yozuvini yaratadi —
    # shuning uchun BIZNING batafsil yozuvimizni SO'NGGI marta qo'shamiz, u ON CONFLICT
    # orqali to'g'ri group_count/change_note bilan ustidan yozadi.
    db.add_grade_history(
        teacher_id, effective_date, grade=target["grade"], workload_rate=new_workload_rate,
        group_count=new_groups, change_note=note, created_by=emp["full_name"],
    )

    return {"ok": True, "new_group_count": new_groups, "new_workload_rate": round(new_workload_rate, 4)}


@app.post("/api/settings/criterion-gate")
async def api_set_criterion_gate(request: Request, x_telegram_init_data: str = Header(None)):
    """
    Har bir KPI mezoni (Retention, Progress va h.k.) uchun alohida Gate chegarasini belgilaydi.
    MUHIM: bu chegara FAQAT Hisobotlar bo'limida (kimlar chegaradan pastligini ko'rsatish uchun)
    ishlatiladi — ish haqi/KPI summasi hisob-kitobiga hech qanday ta'sir qilmaydi.
    """
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    criterion = body.get("criterion")
    if criterion not in db.CRITERION_KEYS:
        raise HTTPException(status_code=400, detail="Notog'ri mezon")
    db.set_criterion_gate(criterion, float(body["value"]))
    return {"ok": True}


# =========================================================
# API — KOMPANIYA KO'RSATKICHI (kunlik, faqat CEO/Director)
# =========================================================

def _compute_metric_derived(row) -> dict:
    total_revenue = (row["click_revenue"] or 0) + (row["card_revenue"] or 0) + (row["cash_revenue"] or 0)
    total_expense = (row["click_expense"] or 0) + (row["card_expense"] or 0) + (row["cash_expense"] or 0)

    # O'sish — kun boshi va kun oxiridagi faol o'quvchilar sonining oddiy farqi.
    # ESLATMA: ilgari bu yerda "start_active + sales_count - left_count - end_active"
    # hisoblanardi — bu aslida o'sish emas, balki kiritilgan sotuv/chiqish sonlari
    # kutilgan yakuniy sonni real kiritilgan end_active bilan qanchalik mos kelishini
    # tekshiruvchi FARQ (residual) edi, va ishorasi ham teskari edi: agar maktab
    # haqiqatan o'sgan bo'lsa ham, bu formula ko'pincha 0 ga yaqin yoki manfiy chiqib,
    # "📉 Tushish" deb noto'g'ri ko'rsatilishi mumkin edi.
    growth = None
    if row["start_active"] is not None and row["end_active"] is not None:
        growth = row["end_active"] - row["start_active"]

    return {
        "total_revenue": round(total_revenue, 2),
        "total_expense": round(total_expense, 2),
        "growth": growth,
    }


@app.get("/api/company-metrics")
def api_get_company_metric(date: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    row = db.get_company_metric(date)
    if not row:
        return {"exists": False, "data": None}

    data = dict(row)
    data.update(_compute_metric_derived(row))
    return {"exists": True, "data": data}


@app.post("/api/company-metrics")
async def api_set_company_metric(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    body = await request.json()
    date = body.get("date")
    if not date:
        raise HTTPException(status_code=400, detail="'date' maydoni to'ldirilishi shart")

    # FAQAT Direktor kiritadigan maydonlar (tushum/xarajat/topshiriqlar) yangilanadi —
    # talabalar harakati/qo'ng'iroq maydonlariga tegilmaydi, chunki ular endi
    # rol asosidagi tasdiqlangan kunlik yozuvlardan avtomatik sinxronlanadi.
    partial = {k: v for k, v in body.items() if k != "date"}
    db.update_company_metric_partial(date, partial, emp["full_name"])

    row = db.get_company_metric(date)
    data = dict(row)
    data.update(_compute_metric_derived(row))
    return {"ok": True, "data": data}


@app.get("/api/company-metrics/history")
def api_company_metrics_history(limit: int = 14, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    rows = db.list_company_metrics(limit)
    out = []
    for r in rows:
        d = dict(r)
        d.update(_compute_metric_derived(r))
        out.append(d)
    return {"rows": out}


@app.get("/api/company-metrics/range")
def api_company_metrics_range(start: str, end: str, x_telegram_init_data: str = Header(None)):
    """
    Kompaniya hisoboti — belgilangan sana oralig'idagi barcha kunlik ko'rsatkichlarning yig'indisi/o'rtachasi.
    """
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    rows = db.list_company_metrics_range(start, end)

    sum_fields = [
        "new_admissions", "sales_count", "left_count", "frozen_count",
        "trial_count", "risky_count", "repeat_sales_calls",
        "admin_contacted_clients", "risky_contacted_count", "complaints_count",
    ]
    sums = {f: 0 for f in sum_fields}

    total_revenue = 0.0
    total_expense = 0.0
    attendance_values = []
    aggregate_growth = 0
    has_growth = False
    daily = []

    for r in rows:
        derived = _compute_metric_derived(r)
        total_revenue += derived["total_revenue"]
        total_expense += derived["total_expense"]

        for f in sum_fields:
            v = r[f]
            if v is not None:
                sums[f] += v

        if r["attendance_percent"] is not None:
            attendance_values.append(r["attendance_percent"])

        if derived["growth"] is not None:
            aggregate_growth += derived["growth"]
            has_growth = True

        daily.append({
            "date": r["date"],
            "total_revenue": derived["total_revenue"],
            "total_expense": derived["total_expense"],
            "growth": derived["growth"],
        })

    avg_attendance = round(sum(attendance_values) / len(attendance_values), 1) if attendance_values else None

    return {
        "start": start,
        "end": end,
        "days_with_data": len(rows),
        "total_revenue": round(total_revenue, 2),
        "total_expense": round(total_expense, 2),
        "total_profit": round(total_revenue - total_expense, 2),
        "sums": sums,
        "avg_attendance_percent": avg_attendance,
        "aggregate_growth": aggregate_growth if has_growth else None,
        "daily": daily,
    }


# =========================================================
# API — SINOV REJIMI (Test Mode): bitta Telegram akkaunt bilan turli rollarni sinash
# =========================================================

@app.get("/api/me/test-mode-status")
def api_test_mode_status():
    """Joriy sessiya sinov rejimida ekanini tekshiradi (rolidan qat'i nazar)."""
    real_teacher_id = _get_real_teacher_id()

    impersonating_id = db.get_impersonation(real_teacher_id)
    if not impersonating_id:
        return {"in_test_mode": False}

    real_emp = db.get_employee(real_teacher_id)
    return {
        "in_test_mode": True,
        "original_full_name": real_emp["full_name"] if real_emp else None,
        "original_role": real_emp["role"] if real_emp else None,
    }


@app.post("/api/admin/switch-my-link")
async def api_switch_my_link(request: Request):
    """
    FAQAT CEO uchun: sinov maqsadida boshqa xodim sifatida ko'rishni boshlaydi.
    MUHIM: bu hech qachon haqiqiy sessiyani o'zgartirmaydi — faqat "kim sifatida
    ko'rilyapti" degan vaqtincha xaritalashni saqlaydi.
    """
    real_teacher_id = _get_real_teacher_id()

    # Doim HAQIQIY (impersonatsiyaga bog'liq bo'lmagan) identifikatsiya orqali tekshiramiz —
    # shuning uchun bir necha marta ketma-ket boshqa-boshqa rolga o'tish ham xavfsiz ishlaydi.
    real_emp = db.get_employee(real_teacher_id)
    if not real_emp:
        raise HTTPException(status_code=403, detail="Xodim topilmadi")
    if real_emp["role"] != "CEO":
        raise HTTPException(
            status_code=403,
            detail="Sinov rejimini boshlash uchun avval CEO sifatida kirishingiz kerak",
        )

    body = await request.json()
    target_teacher_id = body.get("target_teacher_id")
    if not target_teacher_id:
        raise HTTPException(status_code=400, detail="'target_teacher_id' maydoni to'ldirilishi shart")

    target = db.get_employee(target_teacher_id)
    if not target:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")

    db.set_impersonation(real_teacher_id, target_teacher_id)

    return {"ok": True, "now_full_name": target["full_name"], "now_role": target["role"]}


@app.post("/api/admin/exit-test-mode")
def api_exit_test_mode():
    """Sinov rejimidan chiqadi. Haqiqiy sessiyaga hech qachon tegilmagani uchun, shunchaki xaritalashni o'chiramiz."""
    real_teacher_id = _get_real_teacher_id()

    if not db.get_impersonation(real_teacher_id):
        raise HTTPException(status_code=400, detail="Siz sinov rejimida emassiz")

    db.clear_impersonation(real_teacher_id)
    return {"ok": True}


# =========================================================
# API — TOPSHIRIQLAR (xodimlar orasidagi buyruq/xabar tizimi)
# =========================================================

ROLE_LABELS_UZ = {
    "CEO": "CEO",
    "Director": "Direktor",
    "EduManager": "Ta'lim menejeri",
    "Teacher": "O'qituvchi",
    "SubjectTeacher": "Fan o'qituvchisi",
    "Administrator": "Administrator",
    "SalesManager": "Sotuv menejeri",
}


def _task_category_labels_map():
    cats = db.list_task_categories()
    return {c["key"]: f"{c['icon'] or ''} {c['label']}".strip() for c in cats}


def _task_to_dict(row, category_labels=None, role_penalties=None):
    d = dict(row)
    from_emp = db.get_employee(d["from_teacher_id"])
    d["from_full_name"] = from_emp["full_name"] if from_emp else d["from_teacher_id"]
    if d["to_teacher_id"]:
        to_emp = db.get_employee(d["to_teacher_id"])
        d["to_display"] = to_emp["full_name"] if to_emp else d["to_teacher_id"]
        d["to_role_actual"] = to_emp["role"] if to_emp else None
    else:
        d["to_display"] = ROLE_LABELS_UZ.get(d["to_role"], d["to_role"])
        d["to_role_actual"] = d["to_role"]

    cat_labels = category_labels if category_labels is not None else _task_category_labels_map()
    d["category_label"] = cat_labels.get(d["category"]) if d["category"] else None

    d["is_overdue"] = bool(
        d["deadline"] and d["status"] != "done" and d["deadline"] < _todaystr_for_tasks()
    )

    penalties = role_penalties if role_penalties is not None else db.get_task_role_penalties()
    penalty_rate = penalties.get(d["to_role_actual"], 0) if d["to_role_actual"] else 0
    d["penalty_amount"] = penalty_rate if d["is_overdue"] else 0

    d["comment_count"] = len(db.list_task_comments(d["id"]))
    return d


def _todaystr_for_tasks():
    from datetime import date as _d
    return _d.today().isoformat()


@app.post("/api/tasks")
async def api_create_task(
    request: Request,
    x_telegram_init_data: str = Header(None),
    authorization: str = Header(None),
):
    emp, _is_service = get_current_employee_or_service(x_telegram_init_data, authorization)
    body = await request.json()

    text = (body.get("text") or "").strip()
    to_teacher_id = body.get("to_teacher_id")
    to_role = body.get("to_role")
    urgent = bool(body.get("urgent"))
    deadline = body.get("deadline") or None
    category = body.get("category") or None

    if not text:
        raise HTTPException(status_code=400, detail="Topshiriq matni to'ldirilishi shart")
    if not to_teacher_id and not to_role:
        raise HTTPException(status_code=400, detail="Qabul qiluvchi (aniq xodim yoki rol) tanlanishi shart")
    if to_teacher_id and not db.get_employee(to_teacher_id):
        raise HTTPException(status_code=404, detail="Qabul qiluvchi xodim topilmadi")

    task_id = db.create_task(
        from_teacher_id=emp["teacher_id"], text=text,
        to_teacher_id=to_teacher_id, to_role=to_role, urgent=urgent,
        deadline=deadline, category=category,
        student_name=body.get("student_name") or None,
        student_group=body.get("student_group") or None,
        student_phone=body.get("student_phone") or None,
        student_problem_status=body.get("student_problem_status") or None,
    )

    # Telegram orqali darhol bildirishnoma yuboramiz
    prefix = "🔴 SHOSHILINCH TOPSHIRIQ" if urgent else "📋 Yangi topshiriq"
    deadline_line = f"\n📅 Muddat: {deadline}" if deadline else ""
    notif_text = f"{prefix}\n\n<b>{emp['full_name']}</b> ({ROLE_LABELS_UZ.get(emp['role'], emp['role'])}):\n{text}{deadline_line}"

    if to_teacher_id:
        target = db.get_employee(to_teacher_id)
        if target and target["telegram_id"]:
            await send_message(target["telegram_id"], notif_text, reply_markup=_open_app_keyboard())
    else:
        targets = db.list_employees(role=to_role)
        for t in targets:
            if t["telegram_id"]:
                await send_message(t["telegram_id"], notif_text, reply_markup=_open_app_keyboard())

    return {"ok": True, "id": task_id}


@app.get("/api/tasks/inbox")
def api_tasks_inbox(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    rows = db.list_tasks_inbox(emp["teacher_id"], emp["role"])

    # Faqat "birinchi ko'rilgan vaqt"ni jim belgilaymiz (analitika uchun) — status esa
    # FAQAT xodim aniq "🔄 Jarayonda" tugmasini bosganda o'zgaradi, avtomatik emas.
    for r in rows:
        db.mark_task_first_viewed(r["id"], emp["teacher_id"])

    rows = db.list_tasks_inbox(emp["teacher_id"], emp["role"])
    cat_labels = _task_category_labels_map()
    penalties = db.get_task_role_penalties()
    return [_task_to_dict(r, cat_labels, penalties) for r in rows]


@app.get("/api/tasks/sent")
def api_tasks_sent(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    rows = db.list_tasks_sent(emp["teacher_id"])
    cat_labels = _task_category_labels_map()
    penalties = db.get_task_role_penalties()
    return [_task_to_dict(r, cat_labels, penalties) for r in rows]


@app.get("/api/tasks/all")
def api_tasks_all(x_telegram_init_data: str = Header(None), authorization: str = Header(None)):
    emp, is_service = get_current_employee_or_service(x_telegram_init_data, authorization)
    if not is_service:
        require_owner(emp)
    rows = db.list_tasks_all()
    cat_labels = _task_category_labels_map()
    penalties = db.get_task_role_penalties()
    return [_task_to_dict(r, cat_labels, penalties) for r in rows]


@app.post("/api/tasks/{task_id}/start")
def api_task_mark_in_progress(
    task_id: int,
    x_telegram_init_data: str = Header(None),
    authorization: str = Header(None),
):
    """Xodim 'Jarayonda' tugmasini aniq bosganda chaqiriladi — avtomatik emas."""
    emp, is_service = get_current_employee_or_service(x_telegram_init_data, authorization)
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Topshiriq topilmadi")

    if not is_service:
        is_recipient = (task["to_teacher_id"] == emp["teacher_id"]) or (
            task["to_teacher_id"] is None and task["to_role"] == emp["role"]
        )
        if not is_recipient:
            raise HTTPException(status_code=403, detail="Bu topshiriq sizga tegishli emas")

    db.mark_task_in_progress(task_id, emp["teacher_id"])
    return {"ok": True}


@app.post("/api/tasks/{task_id}/done")
async def api_task_mark_done(
    task_id: int,
    x_telegram_init_data: str = Header(None),
    authorization: str = Header(None),
):
    emp, is_service = get_current_employee_or_service(x_telegram_init_data, authorization)
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Topshiriq topilmadi")

    if not is_service:
        is_recipient = (task["to_teacher_id"] == emp["teacher_id"]) or (
            task["to_teacher_id"] is None and task["to_role"] == emp["role"]
        )
        if not is_recipient:
            raise HTTPException(status_code=403, detail="Bu topshiriq sizga tegishli emas")

    db.mark_task_done(task_id, emp["teacher_id"])

    sender = db.get_employee(task["from_teacher_id"])
    if sender and sender["telegram_id"]:
        await send_message(
            sender["telegram_id"],
            f"✅ Bajarildi: <b>{emp['full_name']}</b> quyidagi topshiriqni bajardi:\n{task['text']}",
        )

    return {"ok": True}


@app.get("/api/tasks/{task_id}/comments")
def api_task_comments_list(task_id: int, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Topshiriq topilmadi")

    rows = db.list_task_comments(task_id)
    out = []
    for r in rows:
        d = dict(r)
        author = db.get_employee(d["from_teacher_id"])
        d["from_full_name"] = author["full_name"] if author else d["from_teacher_id"]
        out.append(d)
    return out


@app.post("/api/tasks/{task_id}/comments")
async def api_task_comments_add(task_id: int, request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    task = db.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Topshiriq topilmadi")

    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Izoh matni bo'sh bo'lishi mumkin emas")

    db.add_task_comment(task_id, emp["teacher_id"], text)

    # Qarama-qarshi tomonga bildirishnoma yuboramiz: agar men yuboruvchi bo'lsam -> qabul qiluvchi(lar)ga,
    # agar men qabul qiluvchi bo'lsam -> yuboruvchiga
    notif_text = f"💬 Yangi izoh ({emp['full_name']}):\n\"{task['text'][:60]}...\"\n\n{text}"
    if emp["teacher_id"] == task["from_teacher_id"]:
        if task["to_teacher_id"]:
            target = db.get_employee(task["to_teacher_id"])
            if target and target["telegram_id"]:
                await send_message(target["telegram_id"], notif_text, reply_markup=_open_app_keyboard())
        elif task["to_role"]:
            for t in db.list_employees(role=task["to_role"]):
                if t["telegram_id"]:
                    await send_message(t["telegram_id"], notif_text, reply_markup=_open_app_keyboard())
    else:
        sender = db.get_employee(task["from_teacher_id"])
        if sender and sender["telegram_id"]:
            await send_message(sender["telegram_id"], notif_text, reply_markup=_open_app_keyboard())

    return {"ok": True}


@app.get("/api/task-categories")
def api_get_task_categories(x_telegram_init_data: str = Header(None)):
    get_current_employee(x_telegram_init_data)
    rows = db.list_task_categories()
    return [dict(r) for r in rows]


@app.get("/api/task-problem-statuses")
def api_get_task_problem_statuses(x_telegram_init_data: str = Header(None)):
    get_current_employee(x_telegram_init_data)
    rows = db.list_task_problem_statuses()
    return [dict(r) for r in rows]


@app.post("/api/settings/task-categories/add")
async def api_add_task_category(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    key = (body.get("key") or "").strip()
    label = (body.get("label") or "").strip()
    icon = (body.get("icon") or "").strip() or None
    if not key or not label:
        raise HTTPException(status_code=400, detail="'key' va 'label' to'ldirilishi shart")
    db.add_task_category(key, label, icon)
    return {"ok": True}


@app.post("/api/settings/task-categories/delete")
async def api_delete_task_category(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    key = body.get("key")
    if not key:
        raise HTTPException(status_code=400, detail="'key' to'ldirilishi shart")
    db.delete_task_category(key)
    return {"ok": True}


@app.post("/api/settings/task-problem-statuses/add")
async def api_add_task_problem_status(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    label = (body.get("label") or "").strip()
    if not label:
        raise HTTPException(status_code=400, detail="'label' to'ldirilishi shart")
    db.add_task_problem_status(label)
    return {"ok": True}


@app.post("/api/settings/task-problem-statuses/delete")
async def api_delete_task_problem_status(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    status_id = body.get("id")
    if not status_id:
        raise HTTPException(status_code=400, detail="'id' to'ldirilishi shart")
    db.delete_task_problem_status(status_id)
    return {"ok": True}


@app.get("/api/settings/task-penalties")
def api_get_task_penalties(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    penalties = db.get_task_role_penalties()
    return {r: penalties.get(r, 0) for r in ROLE_LABELS_UZ.keys()}


@app.post("/api/settings/task-penalties")
async def api_set_task_penalty(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_ceo(emp)
    body = await request.json()
    role = body.get("role")
    amount = body.get("amount")
    if not role or amount is None:
        raise HTTPException(status_code=400, detail="'role' va 'amount' to'ldirilishi shart")
    db.set_task_role_penalty(role, float(amount))
    return {"ok": True}


@app.get("/api/tasks/my-summary")
def api_tasks_my_summary(start: str, end: str, x_telegram_init_data: str = Header(None)):
    """
    Har bir xodim uchun — shaxsiy topshiriqlar statistikasi va muddati o'tgan
    topshiriqlar uchun jarima summasi (CEO'nikiga o'xshash, lekin faqat OZINIKI).
    """
    emp = get_current_employee(x_telegram_init_data)
    rows = db.list_tasks_in_range(start, end)
    my_rows = [
        t for t in rows
        if t["to_teacher_id"] == emp["teacher_id"] or (not t["to_teacher_id"] and t["to_role"] == emp["role"])
    ]

    cat_labels = _task_category_labels_map()
    penalties = db.get_task_role_penalties()
    my_penalty_rate = penalties.get(emp["role"], 0)

    tasks_dicts = [_task_to_dict(t, cat_labels, penalties) for t in my_rows]

    total = len(tasks_dicts)
    done = sum(1 for t in tasks_dicts if t["status"] == "done")
    in_progress = sum(1 for t in tasks_dicts if t["status"] == "in_progress")
    not_done = sum(1 for t in tasks_dicts if t["status"] == "new")
    overdue_tasks = [t for t in tasks_dicts if t["is_overdue"]]
    total_penalty = my_penalty_rate * len(overdue_tasks)

    return {
        "start": start, "end": end,
        "total": total, "done": done, "in_progress": in_progress, "not_done": not_done,
        "overdue_count": len(overdue_tasks),
        "penalty_rate": my_penalty_rate,
        "total_penalty": total_penalty,
        "overdue_tasks": overdue_tasks,
    }


@app.get("/api/reports/tasks-summary")
def api_reports_tasks_summary(start: str, end: str, x_telegram_init_data: str = Header(None)):
    """
    Topshiriqlar tarixi va analitikasi — rol bo'yicha nechta topshiriq berilgani,
    nechtasi bajarilgani/jarayonda/hali ko'rilmagani, jarima summasi, va har bir
    xodim bo'yicha kim bajaryapti, kim bajarmayapti.
    """
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    rows = db.list_tasks_in_range(start, end)
    employees = db.list_employees()
    emp_by_id = {e["teacher_id"]: e for e in employees}
    role_penalties = db.get_task_role_penalties()
    today = _todaystr_for_tasks()

    def recipient_role(t):
        if t["to_teacher_id"]:
            e = emp_by_id.get(t["to_teacher_id"])
            return e["role"] if e else None
        return t["to_role"]

    def is_overdue(t):
        return bool(t["deadline"] and t["status"] != "done" and t["deadline"] < today)

    role_stats = {}
    overall = {"total": 0, "done": 0, "in_progress": 0, "not_done": 0, "overdue": 0, "total_penalty": 0}

    for t in rows:
        role = recipient_role(t)
        if not role:
            continue

        overdue = is_overdue(t)
        penalty = role_penalties.get(role, 0) if overdue else 0

        overall["total"] += 1
        if t["status"] == "done":
            overall["done"] += 1
        elif t["status"] == "in_progress":
            overall["in_progress"] += 1
        else:
            overall["not_done"] += 1
        if overdue:
            overall["overdue"] += 1
            overall["total_penalty"] += penalty

        if role not in role_stats:
            role_stats[role] = {
                "total": 0, "done": 0, "in_progress": 0, "not_done": 0,
                "overdue": 0, "total_penalty": 0, "employees": {},
            }
        rs = role_stats[role]
        rs["total"] += 1
        if t["status"] == "done":
            rs["done"] += 1
        elif t["status"] == "in_progress":
            rs["in_progress"] += 1
        else:
            rs["not_done"] += 1
        if overdue:
            rs["overdue"] += 1
            rs["total_penalty"] += penalty

        # Faqat aniq xodimga yuborilgan topshiriqlar shaxsiy statistikaga kiradi
        # (butun rolga yuborilganlar — kim bajarishi aniq bo'lmagani uchun umumiy hisobga kiradi, xolos)
        if t["to_teacher_id"]:
            eid = t["to_teacher_id"]
            if eid not in rs["employees"]:
                ename = emp_by_id[eid]["full_name"] if eid in emp_by_id else eid
                rs["employees"][eid] = {
                    "teacher_id": eid, "full_name": ename, "assigned": 0, "done": 0,
                    "pending": 0, "overdue": 0, "total_penalty": 0,
                }
            es = rs["employees"][eid]
            es["assigned"] += 1
            if t["status"] == "done":
                es["done"] += 1
            else:
                es["pending"] += 1
            if overdue:
                es["overdue"] += 1
                es["total_penalty"] += penalty

    by_role = []
    for role, rs in role_stats.items():
        by_role.append({
            "role": role,
            "role_label": ROLE_LABELS_UZ.get(role, role),
            "total": rs["total"],
            "done": rs["done"],
            "in_progress": rs["in_progress"],
            "not_done": rs["not_done"],
            "overdue": rs["overdue"],
            "total_penalty": rs["total_penalty"],
            "penalty_rate": role_penalties.get(role, 0),
            "employees": sorted(rs["employees"].values(), key=lambda x: -x["pending"]),
        })
    by_role.sort(key=lambda x: -x["total"])

    return {"start": start, "end": end, "overall": overall, "by_role": by_role}


# ============================================================
# Sinov (test) ma'lumotlarini tozalash — faqat CEO/Director
# ============================================================

@app.post("/api/admin/purge-test-employees")
async def api_admin_purge_test_employees(request: Request, x_telegram_init_data: str = Header(None)):
    """
    Ko'rsatilgan teacher_id'lar (va faqat ular) uchun: xodim va unga bog'liq barcha
    scorecard/KPI/kunlik hisobot/avans/rashchyot/bonus/tushum yozuvlarini butunlay
    o'chiradi, shu xodim ishtirokidagi topshiriqlarni tozalaydi, va hozircha real
    kompaniya tarixi kiritilmagan bo'lgani uchun company_metrics/ai_summaries/
    test_mode_sessions jadvallarini ham butunlay tozalaydi (bular faqat sinov kunlik
    hisobotlaridan avtomatik yig'ilgan edi).

    Xavfsizlik: faqat CEO/Director chaqira oladi; ro'yxatda CEO/Director rolidagi
    xodim bo'lsa, so'rov butunlay rad etiladi (o'z-o'zini yoki boshqa rahbarni bu
    orqali o'chirib bo'lmaydi).
    """
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    body = await request.json()
    teacher_ids = body.get("teacher_ids") or []
    if not isinstance(teacher_ids, list) or not teacher_ids:
        raise HTTPException(status_code=400, detail="teacher_ids ro'yxati bo'sh yoki noto'g'ri")

    for tid in teacher_ids:
        target = db.get_employee(tid)
        if not target:
            raise HTTPException(status_code=404, detail=f"Xodim topilmadi: {tid}")
        if target["role"] in ("CEO", "Director"):
            raise HTTPException(
                status_code=400,
                detail=f"'{tid}' — CEO/Director hisobi, bu endpoint orqali o'chirib bo'lmaydi",
            )

    result = db.purge_test_employees(teacher_ids)
    return {"ok": True, **result}


# ============================================================
# Eski tizimdan real ma'lumotlarni import qilish â faqat CEO/Director
# ============================================================

@app.post("/api/admin/import-legacy-data")
async def api_admin_import_legacy_data(request: Request, x_telegram_init_data: str = Header(None)):
    """
    Eski EH_HR_System'dan (Railway "elegant-success" loyihasi) eksport qilingan,
    oldindan tozalangan real ma'lumotlarni (xodimlar, scorecardlar, tushum,
    avans/rashchyot, grade tarixi, kompaniya kunlik ko'rsatkichlari, sozlamalar)
    yangi platformaga bir martalik yozadi.

    Xavfsizlik: faqat CEO/Director chaqira oladi. Qayta chaqirilsa xavfsiz â
    xodimlar qayta yaratilmaydi (mavjudlari o'tkazib yuboriladi), boshqa
    jadvallar esa UPSERT qilinadi (dublikat bo'lmaydi).
    """
    emp = get_current_employee(x_telegram_init_data)
    require_owner(emp)

    payload = await request.json()
    result = db.import_legacy_data(payload)
    return {"ok": True, **result}
