from fastapi import APIRouter
from database import get_db

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

MONTHLY_FACTOR = {"monthly": 1, "annual": 1/12, "weekly": 52/12, "biweekly": 26/12, "semimonthly": 2}


def calc_payment(balance, annual_rate, term_months):
    if annual_rate == 0 or term_months == 0:
        return 0
    r = annual_rate / 100 / 12
    return balance * r * (1 + r) ** term_months / ((1 + r) ** term_months - 1)


@router.get("")
def get_dashboard():
    conn = get_db()

    accounts  = [dict(r) for r in conn.execute("SELECT * FROM accounts").fetchall()]
    recurring = [dict(r) for r in conn.execute("SELECT * FROM recurring WHERE active=1").fetchall()]
    loans     = [dict(r) for r in conn.execute("SELECT * FROM loans").fetchall()]
    goals     = [dict(r) for r in conn.execute("SELECT * FROM goals").fetchall()]
    rsu_rows  = [dict(r) for r in conn.execute(
        "SELECT shares_pending, shares_vested, current_price, federal_tax_rate, vesting_json "
        "FROM rsu_grants WHERE active=1"
    ).fetchall()]
    conn.close()

    # RSU equity
    import json as _json
    from datetime import date as _date, timedelta as _td
    _today   = _date.today().isoformat()
    _cut90   = (_date.today() + _td(days=90)).isoformat()
    rsu_pending_value = 0.0
    rsu_next90_net    = 0.0
    for r in rsu_rows:
        cp  = r.get("current_price") or 0
        ftr = (r.get("federal_tax_rate") or 22) / 100
        if cp:
            rsu_pending_value += cp * (r.get("shares_pending") or 0)
            for e in _json.loads(r.get("vesting_json") or "[]"):
                if not e.get("vested") and _today <= e.get("date","") <= _cut90:
                    rsu_next90_net += e["shares"] * cp * (1 - ftr)

    # Assets
    total_assets = sum(a["balance"] for a in accounts)
    liquid = sum(a["balance"] for a in accounts if a["type"] in ("checking", "savings"))
    investments = sum(a["balance"] for a in accounts if a["type"] == "investment")

    # Liabilities
    total_debt = sum(l["balance"] for l in loans)
    total_loan_payments = sum(
        l["monthly_payment"] or calc_payment(l["balance"], l["rate"], l["term_months"])
        for l in loans
    )

    # Net worth
    net_worth = total_assets - total_debt

    # Cash flow — metrics based on primary income only
    monthly_income = sum(
        r["amount"] * MONTHLY_FACTOR.get(r["frequency"], 1)
        for r in recurring if r["kind"] == "income" and r.get("category") == "primary"
    )
    monthly_supplemental = sum(
        r["amount"] * MONTHLY_FACTOR.get(r["frequency"], 1)
        for r in recurring if r["kind"] == "income" and r.get("category") != "primary"
    )
    monthly_expenses = sum(
        r["amount"] * MONTHLY_FACTOR.get(r["frequency"], 1)
        for r in recurring if r["kind"] == "expense"
    )
    monthly_cash_flow = monthly_income - monthly_expenses - total_loan_payments

    savings_rate = round(monthly_cash_flow / monthly_income * 100, 1) if monthly_income else 0

    # Emergency fund: months of expenses covered by liquid assets
    total_monthly_outflow = monthly_expenses + total_loan_payments
    emergency_months = round(liquid / total_monthly_outflow, 1) if total_monthly_outflow else 0

    # Debt-to-income ratio
    dti = round((total_loan_payments + monthly_expenses) / monthly_income * 100, 1) if monthly_income else 0

    # Goals progress
    goals_summary = [
        {"name": g["name"], "pct": round(g["current"] / g["target"] * 100, 1) if g["target"] else 0,
         "current": g["current"], "target": g["target"]}
        for g in goals
    ]

    # Advisor recommendations
    advice = []

    if emergency_months < 3:
        shortage = 3 * total_monthly_outflow - liquid
        advice.append({
            "priority": "high",
            "icon": "[!]",
            "text": f"Emergency fund is {emergency_months} months — target 3–6 months. Need ${shortage:,.0f} more.",
        })
    elif emergency_months < 6:
        advice.append({
            "priority": "medium",
            "icon": "[~]",
            "text": f"Emergency fund covers {emergency_months} months. Push toward 6 months for full security.",
        })
    else:
        advice.append({
            "priority": "good",
            "icon": "[ok]",
            "text": f"Emergency fund is solid at {emergency_months} months.",
        })

    if savings_rate < 10:
        advice.append({
            "priority": "high",
            "icon": "[!]",
            "text": f"Savings rate is {savings_rate}% — below 10%. Cut expenses or increase income.",
        })
    elif savings_rate < 20:
        advice.append({
            "priority": "medium",
            "icon": "[~]",
            "text": f"Savings rate is {savings_rate}%. Target 20%+ for financial independence.",
        })
    else:
        advice.append({
            "priority": "good",
            "icon": "[ok]",
            "text": f"Savings rate is {savings_rate}% — strong.",
        })

    if dti > 43:
        advice.append({
            "priority": "high",
            "icon": "[!]",
            "text": f"Debt-to-income ratio is {dti}% — above 43%. Lenders see this as high risk.",
        })
    elif dti > 28:
        advice.append({
            "priority": "medium",
            "icon": "[~]",
            "text": f"Debt-to-income ratio is {dti}%. Work toward getting below 28%.",
        })
    else:
        advice.append({
            "priority": "good",
            "icon": "[ok]",
            "text": f"Debt-to-income ratio is {dti}% — healthy.",
        })

    # Highest-rate loan = pay first
    if loans:
        worst = max(loans, key=lambda l: l["rate"])
        advice.append({
            "priority": "tip",
            "icon": "[tip]",
            "text": f"Highest-rate debt: {worst['name']} at {worst['rate']}%. Pay extra here first (avalanche method).",
        })

    if monthly_cash_flow < 0:
        advice.append({
            "priority": "high",
            "icon": "[!]",
            "text": f"Negative cash flow: ${abs(monthly_cash_flow):,.0f}/mo spending more than you earn.",
        })

    income_sources = sorted([
        {"name": r["name"],
         "monthly": round(r["amount"] * MONTHLY_FACTOR.get(r["frequency"], 1), 2),
         "per_period": r["amount"],
         "frequency": r["frequency"],
         "notes": r.get("notes") or "",
         "primary": r.get("category") == "primary"}
        for r in recurring if r["kind"] == "income"
    ], key=lambda x: (-int(x["primary"]), -x["monthly"]))

    expense_items = sorted([
        {"name": r["name"],
         "monthly": round(r["amount"] * MONTHLY_FACTOR.get(r["frequency"], 1), 2)}
        for r in recurring if r["kind"] == "expense"
    ], key=lambda x: -x["monthly"])

    loan_items = sorted([
        {"name": l["name"],
         "balance": l["balance"],
         "rate": l["rate"],
         "monthly": round(l["monthly_payment"] or calc_payment(l["balance"], l["rate"], l["term_months"]), 2)}
        for l in loans
    ], key=lambda x: -x["monthly"])

    account_items = sorted([
        {"name": a["name"], "type": a["type"],
         "balance": a["balance"], "institution": a.get("institution") or ""}
        for a in accounts
    ], key=lambda x: -x["balance"])

    return {
        "net_worth": round(net_worth, 2),
        "total_assets": round(total_assets, 2),
        "total_debt": round(total_debt, 2),
        "liquid": round(liquid, 2),
        "investments": round(investments, 2),
        "monthly_income": round(monthly_income, 2),
        "monthly_supplemental": round(monthly_supplemental, 2),
        "monthly_expenses": round(monthly_expenses, 2),
        "monthly_loan_payments": round(total_loan_payments, 2),
        "monthly_cash_flow": round(monthly_cash_flow, 2),
        "savings_rate": savings_rate,
        "emergency_months": emergency_months,
        "dti": dti,
        "goals": goals_summary,
        "advice": advice,
        "rsu_pending_value": round(rsu_pending_value, 2),
        "rsu_next90_net":    round(rsu_next90_net, 2),
        "income_sources": income_sources,
        "expense_items": expense_items,
        "loan_items": loan_items,
        "account_items": account_items,
    }
