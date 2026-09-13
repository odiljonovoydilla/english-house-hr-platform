"""
PAYROLL ENGINE — English House
================================
Bu fayl — hisoblash mantig'ining YAGONA manbai (single source of truth).
Hech qanday Telegram yoki web kodi bilan aralashmagan, sof Python funksiyalar.

Nega alohida fayl:
- Test qilish oson (Telegram yoki server ishga tushirmasdan tekshirish mumkin)
- Kelajakda boshqa lavozimlar (Akademik menejer, Sotuvchi va h.k.) qo'shilganda
  bu fayl buzilmaydi, faqat kengaytiriladi
- Formulalar "Teacher HR Standard" hujjatidan so'zma-so'z ko'chirilgan
"""

from dataclasses import dataclass, field
from typing import Optional
from datetime import date as _date
import calendar
from datetime import date
import calendar


# =========================================================
# 1) GRADE STAVKALARI (hujjat 4.7-band)
# =========================================================
DEFAULT_GRADE_RATES = {
    "T0": 2_750_000,
    "T1": 4_500_000,
    "T2": 5_500_000,
    "T3": 7_000_000,
    "T4": 8_500_000,
    "T5": 10_500_000,
}

DEFAULT_KPI_POOL_PERCENT = 30  # hujjat 5.3-band: Maksimal KPI = FIX x 30%
DEFAULT_AVANS_PERCENT = 30     # Avans = FIX x avans_percent%
DEFAULT_MIN_KPI_PERCENT = 50   # Yakuniy KPI shu foizdan past bo'lsa, KPI summasi 0 bo'ladi


# =========================================================
# 2) KPI BALLASH JADVALLARI (5-BO'LIM)
# =========================================================

def score_retention(r: Optional[float]) -> float:
    """Retention — 25 ball maksimal (5.5.4-band)."""
    r = r or 0
    if r >= 97: return 25
    if r >= 95: return 22
    if r >= 93: return 19
    if r >= 91: return 15
    if r >= 89: return 10
    if r >= 87: return 5
    return 0


def score_progress(p: Optional[float]) -> float:
    """Student Progress — 25 ball maksimal (5.6.3-band)."""
    p = p or 0
    if p >= 90: return 25
    if p >= 85: return 22
    if p >= 80: return 19
    if p >= 75: return 15
    if p >= 70: return 10
    if p >= 65: return 5
    return 0


def score_attendance(a: Optional[float]) -> float:
    """Attendance Rate — 10 ball maksimal (5.7.2-band)."""
    a = a or 0
    if a >= 92: return 10
    if a >= 90: return 9
    if a >= 88: return 8
    if a >= 86: return 7
    if a >= 84: return 6
    if a >= 82: return 4
    if a >= 80: return 2
    return 0


def score_homework(h: Optional[float]) -> float:
    """Homework Completion — 10 ball maksimal (5.8.2-band)."""
    h = h or 0
    if h >= 90: return 10
    if h >= 85: return 9
    if h >= 80: return 8
    if h >= 75: return 7
    if h >= 70: return 5
    if h >= 65: return 3
    if h >= 60: return 1
    return 0


def score_observation(o: Optional[float]) -> float:
    """Observation Score — 15 ball maksimal (5.9.1-band). Chiziqli: (ball/25)*15."""
    o = o or 0
    return (o / 25) * 15


def score_feedback(f: Optional[float]) -> float:
    """Student Feedback — 10 ball maksimal (5.10.2-band)."""
    f = f or 0
    if f >= 9.5: return 10
    if f >= 9.0: return 9
    if f >= 8.5: return 8
    if f >= 8.0: return 6
    if f >= 7.5: return 4
    if f >= 7.0: return 2
    return 0


def score_lms(l: Optional[float]) -> float:
    """Platforma va akademik intizom — 5 ball maksimal (5.11-band). 0-5 oralig'ida to'g'ridan-to'g'ri."""
    l = l or 0
    return (l / 5) * 5


@dataclass
class KpiResult:
    final_percent: float
    raw_total_before_cap: float
    cap_applied: Optional[float]
    gate_notes: list = field(default_factory=list)
    retention_ball: float = 0
    progress_ball: float = 0
    attendance_ball: float = 0
    homework_ball: float = 0
    observation_ball: float = 0
    feedback_ball: float = 0
    lms_ball: float = 0


def calc_kpi(retention: float, progress: float, attendance: float, homework: float,
             observation: float, feedback: float, lms: float) -> KpiResult:
    """
    KPI balini hisoblaydi — Gate cheklovlarisiz, 7 ta mezonning sof yig'indisi (5-BO'LIM).
    Kirish qiymatlari:
      retention, progress, attendance, homework — foizda (0-100)
      observation — xom ball (0-25)
      feedback — o'rtacha ball (0-10)
      lms — ball (0-5)

    Eslatma: bu funksiya faqat XOM foizni (0-100) hisoblaydi. Bu foiz "Minimal KPI foizi"
    (Sozlamalar) dan past bo'lsa, KPI SUMMASI 0 bo'ladi — lekin bu tekshiruv calc_payroll'da
    amalga oshiriladi, chunki bu foizga emas, TO'LOVGA tegishli qaror.
    """
    retention_ball = score_retention(retention or 0)
    progress_ball = score_progress(progress or 0)
    attendance_ball = score_attendance(attendance)
    homework_ball = score_homework(homework)
    observation_ball = score_observation(observation or 0)
    feedback_ball = score_feedback(feedback)
    lms_ball = score_lms(lms)

    total_ball = (
        retention_ball + progress_ball + attendance_ball +
        homework_ball + observation_ball + feedback_ball + lms_ball
    )

    return KpiResult(
        final_percent=round(total_ball, 2),
        raw_total_before_cap=round(total_ball, 2),
        cap_applied=None,
        gate_notes=[],
        retention_ball=retention_ball,
        progress_ball=progress_ball,
        attendance_ball=attendance_ball,
        homework_ball=homework_ball,
        observation_ball=observation_ball,
        feedback_ball=feedback_ball,
        lms_ball=lms_ball,
    )


# =========================================================
# 3) FIX VA UMUMIY DAROMAD HISOBI (4-BO'LIM)
# =========================================================

@dataclass
class PayrollResult:
    grade: str
    grade_rate: float
    workload_rate: float
    base_salary: float          # FIX
    kpi_pool: float
    kpi: KpiResult
    kpi_amount: float
    bonus: float
    total: float


def calc_payroll(grade: str, workload_rate: float, grade_rates: dict,
                  kpi_pool_percent: float,
                  retention: float, progress: float, attendance: float,
                  homework: float, observation: float, feedback: float,
                  lms: float, bonus: float = 0,
                  min_kpi_percent: float = DEFAULT_MIN_KPI_PERCENT) -> PayrollResult:
    """
    Umumiy oylik daromadni hisoblaydi:
        FIX = grade_rate * workload_rate
        KPI fondi = FIX * kpi_pool_percent / 100
        Yakuniy KPI foiz = 7 ta mezon yig'indisi (Gate cheklovisiz, sof ball)
        Agar Yakuniy KPI foiz < min_kpi_percent bo'lsa -> KPI summasi = 0 (butunlay to'lanmaydi)
        Aks holda -> KPI summasi = KPI fondi * Yakuniy KPI foiz / 100
        Umumiy = FIX + KPI summasi + Bonus
    """
    grade_rate = grade_rates.get(grade, 0)
    base_salary = grade_rate * workload_rate
    kpi_pool = base_salary * kpi_pool_percent / 100

    kpi = calc_kpi(retention, progress, attendance, homework, observation, feedback, lms)

    if kpi.final_percent < min_kpi_percent:
        kpi_amount = 0
    else:
        kpi_amount = kpi_pool * kpi.final_percent / 100

    total = base_salary + kpi_amount + bonus

    return PayrollResult(
        grade=grade,
        grade_rate=grade_rate,
        workload_rate=workload_rate,
        base_salary=round(base_salary, 2),
        kpi_pool=round(kpi_pool, 2),
        kpi=kpi,
        kpi_amount=round(kpi_amount, 2),
        bonus=bonus,
        total=round(base_salary + kpi_amount + bonus, 2),
    )


# =========================================================
# 4) AVANS VA RASHCHYOT (yakuniy hisob-kitob)
# =========================================================

def calc_avans(fix: float, avans_percent: float) -> float:
    """
    Avans = FIX * (avans_percent / 100)
    Masalan: FIX=5,500,000 va avans_percent=30 bo'lsa, avans=1,650,000
    """
    return round(fix * avans_percent / 100, 2)


def calc_rashchyot(fix: float, avans_amount: float, kpi_amount: float, bonus: float) -> float:
    """
    Rashchyot (yakuniy, oy oxirida qo'lga tegadigan summa):
        Rashchyot = (FIX - Avans) + KPI + Bonus
    """
    return round((fix - avans_amount) + kpi_amount + bonus, 2)


def calc_effective_kpi_percent(kpi_pool_percent: float, kpi_final_percent: float) -> float:
    """
    "Umumiy KPI foizi" — FIX summadan qancha foiz aynan KPI sifatida qo'shilishini bildiradi.
    Masalan: KPI fondi 30% dan, xodimning scorecard balli 87% bo'lsa:
        effektiv foiz = 30 * 87 / 100 = 26.1%
    Va shu foiz FIX'ga qo'llanilsa, xuddi calc_payroll ichidagi kpi_amount bilan bir xil natija beradi
    (bu — shunchaki o'sha hisobni bitta "umumiy foiz" ko'rinishida ko'rsatish uchun).
    """
    return round(kpi_pool_percent * kpi_final_percent / 100, 2)


# =========================================================
# 5) EDU MANAGER KPI — Ta'lim menejeri uchun 6 mezonli vaznli tizim
#    (English House Academic Manager Payroll System v1.0 asosida)
# =========================================================

EDU_MANAGER_WEIGHTS = {
    "retention": 0.3,
    "teacher_performance": 0.2,
    "student_results": 0.2,
    "attendance": 0.1,
    "homework": 0.1,
    "occupancy": 0.1,
}


def score_em_retention(r: Optional[float]) -> float:
    """Student Retention — kiritish 0-1 oralig'ida (masalan 0.96 = 96%)."""
    r = r if r is not None else 0
    if r >= 0.98: return 1.0
    if r >= 0.97: return 0.9333
    if r >= 0.96: return 0.8667
    if r >= 0.95: return 0.8
    if r >= 0.94: return 0.6667
    if r >= 0.93: return 0.5333
    if r >= 0.92: return 0.4
    if r >= 0.91: return 0.2667
    return 0.0


def score_em_teacher_performance(t: Optional[float]) -> float:
    """Teacher Performance — o'qituvchilarning o'rtacha scorecard bali (0-100)."""
    t = t if t is not None else 0
    if t >= 90: return 1.0
    if t >= 88: return 0.9
    if t >= 86: return 0.8
    if t >= 84: return 0.7
    if t >= 82: return 0.5
    if t >= 80: return 0.3
    return 0.0


def score_em_student_results(g: Optional[float]) -> float:
    """Student Results o'sishi — oldingi oyga nisbatan o'sish (masalan 0.05 = 5%), manfiy ham bo'lishi mumkin."""
    g = g if g is not None else -1
    if g >= 0.08: return 1.0
    if g >= 0.06: return 0.9
    if g >= 0.04: return 0.8
    if g >= 0.02: return 0.6
    if g >= 0: return 0.4
    return 0.0


def score_em_attendance(a: Optional[float]) -> float:
    a = a if a is not None else 0
    if a >= 0.95: return 1.0
    if a >= 0.94: return 0.9
    if a >= 0.93: return 0.8
    if a >= 0.92: return 0.7
    if a >= 0.91: return 0.6
    if a >= 0.90: return 0.5
    return 0.0


def score_em_homework(h: Optional[float]) -> float:
    h = h if h is not None else 0
    if h >= 0.90: return 1.0
    if h >= 0.88: return 0.9
    if h >= 0.86: return 0.8
    if h >= 0.84: return 0.7
    if h >= 0.82: return 0.6
    if h >= 0.80: return 0.5
    return 0.0


def score_em_occupancy(o: Optional[float]) -> float:
    o = o if o is not None else 0
    if o >= 0.95: return 1.0
    if o >= 0.93: return 0.9
    if o >= 0.91: return 0.8
    if o >= 0.89: return 0.7
    if o >= 0.87: return 0.6
    if o >= 0.85: return 0.5
    return 0.0


@dataclass
class EduManagerKpiResult:
    final_percent: float
    retention_pct: float
    teacher_performance_pct: float
    student_results_pct: float
    attendance_pct: float
    homework_pct: float
    occupancy_pct: float


def calc_edu_manager_kpi(retention, teacher_performance, student_results,
                          attendance, homework, occupancy) -> EduManagerKpiResult:
    """
    Ta'lim menejeri uchun 6 mezonli vaznli KPI: har bir mezon 0-1 "ball foizi"ga
    aylantiriladi, so'ng vazn (ulush) bilan ko'paytirib qo'shiladi (yig'indi = 100%).
    """
    r_pct = score_em_retention(retention)
    tp_pct = score_em_teacher_performance(teacher_performance)
    sr_pct = score_em_student_results(student_results)
    at_pct = score_em_attendance(attendance)
    hw_pct = score_em_homework(homework)
    oc_pct = score_em_occupancy(occupancy)

    w = EDU_MANAGER_WEIGHTS
    final_percent = (
        r_pct * w["retention"] +
        tp_pct * w["teacher_performance"] +
        sr_pct * w["student_results"] +
        at_pct * w["attendance"] +
        hw_pct * w["homework"] +
        oc_pct * w["occupancy"]
    ) * 100

    return EduManagerKpiResult(
        final_percent=round(final_percent, 2),
        retention_pct=r_pct,
        teacher_performance_pct=tp_pct,
        student_results_pct=sr_pct,
        attendance_pct=at_pct,
        homework_pct=hw_pct,
        occupancy_pct=oc_pct,
    )


# =========================================================
# 6) SOTUV MENEJERI — kunlik ish faoliyati + oylik sotuv bonuslari
# =========================================================

SALES_MANAGER_DAILY_REPEAT_CALLS_TARGET = 25  # kunlik majburiy qayta qo'ng'iroqlar soni
SALES_MANAGER_REINVITE_TARGET = SALES_MANAGER_DAILY_REPEAT_CALLS_TARGET * 0.10  # 2.5


def working_days_in_month(year: int, month: int) -> int:
    """Oyning ish kunlari soni — yakshanbadan tashqari barcha kunlar (haftada 6 kun ishlaydi)."""
    days_in_month = calendar.monthrange(year, month)[1]
    count = 0
    for day in range(1, days_in_month + 1):
        weekday = date(year, month, day).weekday()  # 0=Dushanba ... 6=Yakshanba
        if weekday != 6:
            count += 1
    return count


def score_repeat_calls_daily_percent(count: Optional[float]) -> float:
    """
    Kunlik Arxivdan qayta sotuv qo'ng'iroqlari — natijaga qarab Kun Fix'ning
    necha foizi qoplanishini bildiradi (maksimal 30%, jadval bo'yicha).
    """
    c = count or 0
    if c >= 25: return 0.30
    if c >= 20: return 0.25
    if c >= 15: return 0.20
    if c >= 10: return 0.10
    if c >= 5: return 0.05
    return 0.0


@dataclass
class SalesManagerDailyResult:
    day_fix: float
    repeat_calls_amount: float
    waiting_contact_amount: float
    reinvite_amount: float
    total: float
    max_waiting: float
    waiting_percent: float
    reinvite_percent: float


def calc_sales_manager_daily(day_fix: float, repeat_calls: Optional[float],
                              waiting_contacted: Optional[float], max_waiting: float,
                              reinvite_count: Optional[float]) -> SalesManagerDailyResult:
    """
    Kun Fix uchtaga bo'linadi:
        30% — Kunlik Arxivdan qayta sotuv qo'ng'iroqlari (jadval bo'yicha)
        50% — Kutishda turganlar bilan aloqa (kunlik dinamik maksimalga nisbatan)
        20% — Re-invite (kunlik maksimal 2.5 taga nisbatan)
    """
    repeat_pct = score_repeat_calls_daily_percent(repeat_calls)
    repeat_amount = round(day_fix * repeat_pct, 2)

    wc = waiting_contacted or 0
    if max_waiting > 0:
        waiting_percent = min(1.0, wc / max_waiting)
    else:
        waiting_percent = 1.0 if wc == 0 else 0.0
    waiting_amount = round(day_fix * 0.50 * waiting_percent, 2)

    ri = reinvite_count or 0
    reinvite_percent = min(1.0, ri / SALES_MANAGER_REINVITE_TARGET) if SALES_MANAGER_REINVITE_TARGET > 0 else 0.0
    reinvite_amount = round(day_fix * 0.20 * reinvite_percent, 2)

    total = round(repeat_amount + waiting_amount + reinvite_amount, 2)

    return SalesManagerDailyResult(
        day_fix=round(day_fix, 2),
        repeat_calls_amount=repeat_amount,
        waiting_contact_amount=waiting_amount,
        reinvite_amount=reinvite_amount,
        total=total,
        max_waiting=max_waiting,
        waiting_percent=round(waiting_percent * 100, 1),
        reinvite_percent=round(reinvite_percent * 100, 1),
    )


@dataclass
class SalesManagerMonthlyBonus:
    conversion_percent: float
    total_sales: int
    conversion_bonus: float
    volume_bonus: float
    milestone_bonus: float
    combo_bonus: float
    total: float


def calc_sales_manager_monthly_bonus(total_sales: int, total_trial_attended: int) -> SalesManagerMonthlyBonus:
    """
    Oylik sotuv bonusi — 4 mustaqil komponentdan iborat, bir-biriga qo'shiladi:
      1) Konversiya bonusi: >=85% -> 1,000,000; >=70% -> 500,000; aks holda 0
      2) Hajm bonusi: 25 tadan keyingi har bir sotuv uchun 25,000
      3) 55+ milestone bonusi: 500,000
      4) Combo bonus: konversiya>80% VA sotuv>60 bo'lsa -> 1,500,000
    """
    conversion = round((total_sales / total_trial_attended) * 100, 2) if total_trial_attended > 0 else 0.0

    if conversion >= 85:
        conversion_bonus = 1_000_000
    elif conversion >= 70:
        conversion_bonus = 500_000
    else:
        conversion_bonus = 0

    extra_sales = max(0, total_sales - 25)
    volume_bonus = extra_sales * 25_000

    milestone_bonus = 500_000 if total_sales >= 55 else 0

    combo_bonus = 1_500_000 if (conversion > 80 and total_sales > 60) else 0

    total = conversion_bonus + volume_bonus + milestone_bonus + combo_bonus

    return SalesManagerMonthlyBonus(
        conversion_percent=conversion,
        total_sales=total_sales,
        conversion_bonus=conversion_bonus,
        volume_bonus=volume_bonus,
        milestone_bonus=milestone_bonus,
        combo_bonus=combo_bonus,
        total=total,
    )
