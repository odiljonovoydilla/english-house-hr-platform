"""
SERVER — English House Mini App
==================================
Bitta Python jarayoni uch vazifani bajaradi:
  1. Telegram botdan keladigan xabarlarni qabul qiladi (/webhook/<secret>)
  2. Mini App'ning HTML/CSS/JS fayllarini beradi (/)
  3. Mini App uchun API'ni beradi (/api/...)

Railway'da ishga tushirish buyrug'i (Procfile'da yozilgan):
    uvicorn server:app --host 0.0.0.0 --port $PORT
"""

import os
import hmac
import hashlib
import json
from datetime import date
from urllib.parse import parse_qsl

import httpx
from fastapi import FastAPI, Request, HTTPException, Header
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv

import db
from payroll_engine import calc_payroll, calc_avans, calc_rashchyot

load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN")
WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "changeme")
PUBLIC_URL = os.getenv("PUBLIC_URL", "")  # masalan: https://your-app.up.railway.app

if not BOT_TOKEN:
    raise RuntimeError("BOT_TOKEN topilmadi. Railway Variables bo'limida qo'shing.")

TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

# Botning @username'i — startup vaqtida getMe orqali avtomatik olinadi,
# bir martalik havolalarni (https://t.me/<username>?start=<token>) qurish uchun kerak.
BOT_USERNAME = os.getenv("BOT_USERNAME") or None

app = FastAPI()
db.init_db()

WEBAPP_DIR = os.path.join(os.path.dirname(__file__), "webapp")
app.mount("/static", StaticFiles(directory=WEBAPP_DIR), name="static")


@app.on_event("startup")
async def fetch_bot_username():
    global BOT_USERNAME
    if BOT_USERNAME:
        return
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{TELEGRAM_API}/getMe")
            data = resp.json()
            BOT_USERNAME = data["result"]["username"]
    except Exception as e:
        print(f"[WARNING] Bot username avtomatik olinmadi: {e}")


@app.get("/")
def serve_index():
    return FileResponse(os.path.join(WEBAPP_DIR, "index.html"))


@app.get("/health")
def health():
    return {"status": "ok"}


# =========================================================
# TELEGRAM WEBHOOK — /start bosilganda Mini App tugmasini yuboradi
# =========================================================

async def send_message(chat_id: int, text: str, reply_markup: dict = None):
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if reply_markup:
        payload["reply_markup"] = json.dumps(reply_markup)
    async with httpx.AsyncClient() as client:
        resp = await client.post(f"{TELEGRAM_API}/sendMessage", data=payload)
        if resp.status_code != 200:
            print(f"[TELEGRAM ERROR] {resp.status_code}: {resp.text}")


def _open_app_keyboard():
    return {
        "inline_keyboard": [[
            {"text": "📊 Ochish — English House", "web_app": {"url": PUBLIC_URL}}
        ]]
    }


@app.post("/webhook/{secret}")
async def telegram_webhook(secret: str, request: Request):
    if secret != WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Noto'g'ri webhook manzili")

    update = await request.json()
    message = update.get("message")
    if not message:
        return {"ok": True}

    chat_id = message["chat"]["id"]
    text = message.get("text", "")

    if text.startswith("/start"):
        parts = text.split(maxsplit=1)
        payload = parts[1].strip() if len(parts) > 1 else None

        if payload:
            # Bir martalik havola orqali kelmoqda — xodimni shu telegram_id bilan bog'laymiz
            teacher_id = db.link_via_token(payload, chat_id)
            if teacher_id:
                emp = db.get_employee(teacher_id)
                await send_message(
                    chat_id,
                    f"✅ Xush kelibsiz, <b>{emp['full_name']}</b>! Tizimga muvaffaqiyatli bog'landingiz.",
                    reply_markup=_open_app_keyboard(),
                )
            else:
                await send_message(
                    chat_id,
                    "❌ Havola noto'g'ri yoki eskirgan (bir martalik havolalar faqat bir marta ishlaydi). "
                    "Administratorga murojaat qiling.",
                )
            return {"ok": True}

        # Payloadsiz /start — allaqachon bog'langan bo'lsa tugmani yuboramiz
        emp = db.get_employee_by_telegram_id(chat_id)
        if emp:
            await send_message(
                chat_id,
                "Xush kelibsiz! Tizimni ochish uchun tugmani bosing 👇",
                reply_markup=_open_app_keyboard(),
            )
        else:
            await send_message(
                chat_id,
                "Sizda shaxsiy kirish havolasi topilmadi. Administratordan havola so'rang.",
            )
    else:
        await send_message(chat_id, "Tizimni ochish uchun /start yuboring.")

    return {"ok": True}


# =========================================================
# TELEGRAM MINI APP — initData tekshiruvi (rasmiy Telegram algoritmi)
# =========================================================

def validate_init_data(init_data: str) -> dict:
    """
    Telegram'ning rasmiy Mini App validatsiya algoritmi.
    https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    try:
        parsed = dict(parse_qsl(init_data, strict_parsing=True))
    except ValueError:
        raise HTTPException(status_code=401, detail="initData noto'g'ri formatda")

    received_hash = parsed.pop("hash", None)
    if not received_hash:
        raise HTTPException(status_code=401, detail="hash topilmadi")

    data_check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    computed_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(computed_hash, received_hash):
        raise HTTPException(status_code=401, detail="Imzo mos kelmadi — ruxsat yo'q")

    user_json = parsed.get("user")
    if not user_json:
        raise HTTPException(status_code=401, detail="Foydalanuvchi ma'lumoti topilmadi")

    return json.loads(user_json)


def get_current_employee(x_telegram_init_data: str = Header(None)):
    if not x_telegram_init_data:
        raise HTTPException(status_code=401, detail="initData yuborilmadi")

    tg_user = validate_init_data(x_telegram_init_data)
    tg_id = tg_user["id"]

    emp = db.get_employee_by_telegram_id(tg_id)
    if emp:
        return emp

    raise HTTPException(
        status_code=403,
        detail="Siz tizimda ro'yxatdan o'tmagansiz. Administratordan shaxsiy havola so'rang.",
    )


def require_admin(emp) -> None:
    if emp["role"] not in ("CEO", "Director", "EduManager"):
        raise HTTPException(status_code=403, detail="Bu amal uchun ruxsatingiz yo'q")


def _build_link(token: str) -> str:
    if not BOT_USERNAME:
        return None
    return f"https://t.me/{BOT_USERNAME}?start={token}"


def _prev_month(month: str) -> str:
    y, m = map(int, month.split("-"))
    if m == 1:
        return f"{y - 1}-12"
    return f"{y}-{m - 1:02d}"


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
    }


# =========================================================
# API — O'QITUVCHI: O'Z NATIJASINI KO'RISH
# =========================================================

def _compute_for_teacher(emp, month: str):
    sc = db.get_scorecard(emp["teacher_id"], month)
    if not sc:
        return None

    grade_rates = db.get_grade_rates()
    kpi_pool_percent = db.get_kpi_pool_percent()
    bonus = db.get_total_bonus(emp["teacher_id"], month)

    result = calc_payroll(
        grade=emp["grade"],
        workload_rate=emp["workload_rate"],
        grade_rates=grade_rates,
        kpi_pool_percent=kpi_pool_percent,
        retention=sc["retention"], progress=sc["progress"],
        attendance=sc["attendance"], homework=sc["homework"],
        observation=sc["observation"], feedback=sc["feedback"], lms=sc["lms"],
        bonus=bonus,
    )
    return {
        "teacher_id": emp["teacher_id"],
        "full_name": emp["full_name"],
        "grade": result.grade,
        "month": month,
        "fix": result.base_salary,
        "kpi_pool": result.kpi_pool,
        "kpi_percent": result.kpi.final_percent,
        "kpi_amount": result.kpi_amount,
        "bonus": result.bonus,
        "total": result.total,
        "gate_notes": result.kpi.gate_notes,
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
    }


@app.get("/api/me/payroll")
def api_my_payroll(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    data = _compute_for_teacher(emp, month)
    if not data:
        return JSONResponse({"error": f"{month} uchun scorecard hali kiritilmagan"}, status_code=404)

    adv = db.get_advance(emp["teacher_id"], month)
    advance_amount = adv["amount"] if adv else 0
    data["advance_given"] = advance_amount
    data["rashchyot"] = calc_rashchyot(data["fix"], advance_amount, data["kpi_amount"], data["bonus"])
    return data


# =========================================================
# API — ADMIN: XODIMLAR
# =========================================================

@app.get("/api/employees")
def api_list_employees(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    rows = db.list_employees()
    return [dict(r) for r in rows]


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

    db.add_employee(
        teacher_id=body["teacher_id"],
        full_name=body["full_name"],
        role=body["role"],
        grade=body.get("grade"),
        workload_rate=float(body.get("workload_rate", 1.0)),
    )
    token = db.generate_link_token(body["teacher_id"])
    return {"ok": True, "link": _build_link(token)}


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
    )
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


@app.get("/api/employees/{teacher_id}/link")
def api_get_employee_link(teacher_id: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    target = db.get_employee(teacher_id)
    if not target:
        raise HTTPException(status_code=404, detail="Xodim topilmadi")

    if target["telegram_id"]:
        return {"linked": True, "link": None}

    token = target["link_token"] or db.generate_link_token(teacher_id)
    return {"linked": False, "link": _build_link(token)}


@app.post("/api/employees/{teacher_id}/link/regenerate")
def api_regenerate_employee_link(teacher_id: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    if not db.get_employee(teacher_id):
        raise HTTPException(status_code=404, detail="Xodim topilmadi")

    token = db.generate_link_token(teacher_id)
    return {"link": _build_link(token)}


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


# =========================================================
# API — ADMIN: OYLIK MOLIYA (BARCHA O'QITUVCHILAR)
# =========================================================

@app.get("/api/payroll")
def api_payroll_all(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    teachers = db.list_employees(role="Teacher")
    results = []
    missing = []
    for t in teachers:
        data = _compute_for_teacher(t, month)
        if data:
            adv = db.get_advance(t["teacher_id"], month)
            advance_amount = adv["amount"] if adv else 0
            data["advance_given"] = advance_amount
            data["rashchyot"] = calc_rashchyot(data["fix"], advance_amount, data["kpi_amount"], data["bonus"])
            results.append(data)
        else:
            missing.append({"teacher_id": t["teacher_id"], "full_name": t["full_name"]})

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

    grade_rates = db.get_grade_rates()
    fix = grade_rates.get(target["grade"], 0) * target["workload_rate"]
    avans_percent = db.get_avans_percent()
    amount = calc_avans(fix, avans_percent)

    db.add_or_update_advance(
        teacher_id=body["teacher_id"], month=body["month"], amount=amount, given_by=emp["full_name"]
    )
    return {"ok": True, "amount": amount}


@app.get("/api/advance")
def api_list_advances(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    rows = db.list_advances(month)
    return [dict(r) for r in rows]


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
    grade_rates = db.get_grade_rates()

    rows = []
    for t in teachers:
        rev = db.get_revenue(t["teacher_id"], month)
        data = _compute_for_teacher(t, month)
        expense = data["total"] if data else (grade_rates.get(t["grade"], 0) * t["workload_rate"])
        revenue_amount = rev["amount"] if rev else None
        profit = (revenue_amount - expense) if revenue_amount is not None else None
        percent = (
            round((profit / revenue_amount) * 100, 1)
            if (revenue_amount and revenue_amount > 0 and profit is not None)
            else None
        )
        rows.append({
            "teacher_id": t["teacher_id"],
            "full_name": t["full_name"],
            "grade": t["grade"],
            "revenue": revenue_amount,
            "expense": round(expense, 2),
            "profit": round(profit, 2) if profit is not None else None,
            "percent": percent,
        })

    return {"month": month, "rows": rows}


# =========================================================
# API — ADMIN: DASHBOARD
# =========================================================

@app.get("/api/dashboard")
def api_dashboard(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    all_active = db.list_employees()
    teachers = db.list_employees(role="Teacher")

    unlinked = sum(1 for t in all_active if not t["telegram_id"])

    results = []
    missing = []
    total_fix = total_kpi = total_bonus = 0.0
    for t in teachers:
        data = _compute_for_teacher(t, month)
        if data:
            results.append(data)
            total_fix += data["fix"]
            total_kpi += data["kpi_amount"]
            total_bonus += data["bonus"]
        else:
            missing.append({"teacher_id": t["teacher_id"], "full_name": t["full_name"]})

    total_expense = total_fix + total_kpi + total_bonus

    advances = db.list_advances(month)
    total_advance = sum(a["amount"] for a in advances)

    revenues = db.list_revenues(month)
    total_revenue = sum(r["amount"] for r in revenues) if revenues else None
    total_profit = (total_revenue - total_expense) if total_revenue is not None else None

    prev_month = _prev_month(month)
    prev_total_expense = 0.0
    for t in teachers:
        pdata = _compute_for_teacher(t, prev_month)
        if pdata:
            prev_total_expense += pdata["total"]

    sorted_by_kpi = sorted(results, key=lambda r: r["kpi_percent"], reverse=True)
    top3 = sorted_by_kpi[:3]
    bottom3 = list(reversed(sorted_by_kpi[-3:])) if len(sorted_by_kpi) > 3 else []

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
        "unlinked_employees": unlinked,
        "missing_scorecard": missing,
        "top3": [{"full_name": r["full_name"], "kpi_percent": r["kpi_percent"]} for r in top3],
        "bottom3": [{"full_name": r["full_name"], "kpi_percent": r["kpi_percent"]} for r in bottom3],
    }


# =========================================================
# API — ADMIN: HISOBOTLAR
# =========================================================

@app.get("/api/reports/totals")
def api_reports_totals(month: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)

    teachers = db.list_employees(role="Teacher")
    total_stavka = sum(t["workload_rate"] for t in teachers)
    total_fix = total_kpi = total_bonus = 0.0
    for t in teachers:
        data = _compute_for_teacher(t, month)
        if data:
            total_fix += data["fix"]
            total_kpi += data["kpi_amount"]
            total_bonus += data["bonus"]

    return {
        "month": month,
        "total_stavka": round(total_stavka, 2),
        "total_fix": round(total_fix, 2),
        "total_kpi": round(total_kpi, 2),
        "total_bonus": round(total_bonus, 2),
        "teacher_count": len(teachers),
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
            "fix": data["fix"] if data else None,
            "kpi_amount": data["kpi_amount"] if data else None,
            "kpi_percent": data["kpi_percent"] if data else None,
            "bonus": data["bonus"] if data else None,
            "total": data["total"] if data else None,
        })
    return {"teacher_id": teacher_id, "rows": rows}


# =========================================================
# API — ADMIN: GRADE STAVKALARI VA SOZLAMALAR
# =========================================================

@app.get("/api/settings")
def api_get_settings(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    return {
        "grade_rates": db.get_grade_rates(),
        "kpi_pool_percent": db.get_kpi_pool_percent(),
        "avans_percent": db.get_avans_percent(),
    }


@app.get("/api/settings/grade-rate-impact")
def api_grade_rate_impact(grade: str, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    return {"count": db.count_active_employees_by_grade(grade)}


@app.get("/api/settings/avans-impact")
def api_avans_impact(x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    return {"count": db.count_active_employees()}


@app.post("/api/settings/grade-rate")
async def api_set_grade_rate(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()
    db.set_grade_rate(body["grade"], float(body["rate"]))
    return {"ok": True}


@app.post("/api/settings/kpi-pool-percent")
async def api_set_kpi_pool_percent(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()
    db.set_kpi_pool_percent(float(body["value"]))
    return {"ok": True}


@app.post("/api/settings/avans-percent")
async def api_set_avans_percent(request: Request, x_telegram_init_data: str = Header(None)):
    emp = get_current_employee(x_telegram_init_data)
    require_admin(emp)
    body = await request.json()
    db.set_avans_percent(float(body["value"]))
    return {"ok": True}
