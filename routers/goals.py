from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db

router = APIRouter(prefix="/api/goals", tags=["goals"])


class Goal(BaseModel):
    name: str
    target: float
    current: float = 0.0
    target_date: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
def list_goals():
    conn = get_db()
    rows = conn.execute("SELECT * FROM goals ORDER BY name").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d["pct"] = round(d["current"] / d["target"] * 100, 1) if d["target"] else 0
        result.append(d)
    return result


@router.post("")
def create_goal(g: Goal):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO goals(name,target,current,target_date,notes) VALUES(?,?,?,?,?)",
        (g.name, g.target, g.current, g.target_date, g.notes),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM goals WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@router.put("/{id}")
def update_goal(id: int, g: Goal):
    conn = get_db()
    conn.execute(
        "UPDATE goals SET name=?,target=?,current=?,target_date=?,notes=? WHERE id=?",
        (g.name, g.target, g.current, g.target_date, g.notes, id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM goals WHERE id=?", (id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Not found")
    return dict(row)


@router.delete("/{id}")
def delete_goal(id: int):
    conn = get_db()
    conn.execute("DELETE FROM goals WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.get("/templates")
def get_templates():
    """Return goal template options with auto-calculated target amounts."""
    MONTHLY_FACTOR = {"monthly": 1, "annual": 1/12, "weekly": 52/12, "biweekly": 26/12, "semimonthly": 2}

    conn = get_db()
    recurring = [dict(r) for r in conn.execute("SELECT * FROM recurring").fetchall()]
    loans     = [dict(r) for r in conn.execute("SELECT * FROM loans").fetchall()]
    conn.close()

    monthly_income   = sum(
        r["amount"] * MONTHLY_FACTOR.get(r["frequency"], 1)
        for r in recurring if r["kind"] == "income"
    )
    monthly_expenses = sum(
        r["amount"] * MONTHLY_FACTOR.get(r["frequency"], 1)
        for r in recurring if r["kind"] == "expense"
    )
    monthly_loan_pmts = sum(l.get("monthly_payment") or 0 for l in loans)
    monthly_essential = monthly_expenses + monthly_loan_pmts
    annual_income = monthly_income * 12

    templates = []

    if monthly_essential > 0:
        for months in (3, 6, 12):
            templates.append({
                "id": f"emergency_{months}mo",
                "label": f"{months}-month emergency fund ({months} x essential expenses)",
                "name":  f"{months}-Month Emergency Fund",
                "target": round(monthly_essential * months, 2),
                "notes": f"Covers {months} months of expenses + loan payments (${monthly_essential:,.0f}/mo)",
            })

    if annual_income > 0:
        for pct in (10, 20, 30):
            templates.append({
                "id": f"save_{pct}pct",
                "label": f"Save {pct}% of annual salary (${annual_income * pct / 100:,.0f})",
                "name":  f"Save {pct}% of Salary",
                "target": round(annual_income * pct / 100, 2),
                "notes": f"{pct}% of ${annual_income:,.0f} annual income",
            })

    if monthly_expenses > 0:
        fire = round(monthly_expenses * 12 * 25, 2)
        templates.append({
            "id": "fire",
            "label": f"FIRE number (25x annual expenses = ${fire:,.0f})",
            "name":  "FIRE Number",
            "target": fire,
            "notes": "Financial independence: 25x annual expenses at 4% withdrawal rate",
        })

    for loan in loans:
        templates.append({
            "id": f"payoff_loan_{loan['id']}",
            "label": f"Pay off {loan['name']} (${loan['balance']:,.2f} at {loan['rate']}%)",
            "name":  f"Pay Off: {loan['name']}",
            "target": round(loan["balance"], 2),
            "notes": f"Current balance: ${loan['balance']:,.2f} at {loan['rate']}% APR",
        })

    templates.append({
        "id": "custom",
        "label": "Custom amount",
        "name":  "",
        "target": None,
        "notes": "",
    })

    return templates
