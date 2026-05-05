from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db
import math

router = APIRouter(prefix="/api/loans", tags=["loans"])


class Loan(BaseModel):
    name: str
    balance: float
    original_balance: float
    rate: float          # annual % e.g. 6.5
    term_months: int
    start_date: str      # YYYY-MM-DD
    monthly_payment: Optional[float] = None
    notes: Optional[str] = None


def calc_payment(balance: float, annual_rate: float, term_months: int) -> float:
    if annual_rate == 0:
        return balance / term_months
    r = annual_rate / 100 / 12
    return balance * r * (1 + r) ** term_months / ((1 + r) ** term_months - 1)


def amortize(balance: float, annual_rate: float, monthly_payment: float):
    r = annual_rate / 100 / 12
    schedule = []
    n = 0
    while balance > 0.01 and n < 1200:
        interest = balance * r
        principal = min(monthly_payment - interest, balance)
        balance = max(balance - principal, 0)
        n += 1
        schedule.append({
            "month": n,
            "payment": round(monthly_payment, 2),
            "principal": round(principal, 2),
            "interest": round(interest, 2),
            "balance": round(balance, 2),
        })
    return schedule


@router.get("")
def list_loans():
    conn = get_db()
    rows = conn.execute("SELECT * FROM loans ORDER BY name").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        pmt = d["monthly_payment"] or calc_payment(d["balance"], d["rate"], d["term_months"])
        d["monthly_payment"] = round(pmt, 2)
        sched = amortize(d["balance"], d["rate"], pmt)
        d["months_remaining"] = len(sched)
        d["total_interest_remaining"] = round(sum(s["interest"] for s in sched), 2)
        result.append(d)
    return result


@router.post("")
def create_loan(loan: Loan):
    if not loan.monthly_payment:
        loan.monthly_payment = calc_payment(loan.balance, loan.rate, loan.term_months)
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO loans(name,balance,original_balance,rate,term_months,start_date,monthly_payment,notes) VALUES(?,?,?,?,?,?,?,?)",
        (loan.name, loan.balance, loan.original_balance, loan.rate, loan.term_months,
         loan.start_date, round(loan.monthly_payment, 2), loan.notes),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM loans WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@router.put("/{id}")
def update_loan(id: int, loan: Loan):
    if not loan.monthly_payment:
        loan.monthly_payment = calc_payment(loan.balance, loan.rate, loan.term_months)
    conn = get_db()
    conn.execute(
        "UPDATE loans SET name=?,balance=?,original_balance=?,rate=?,term_months=?,start_date=?,monthly_payment=?,notes=? WHERE id=?",
        (loan.name, loan.balance, loan.original_balance, loan.rate, loan.term_months,
         loan.start_date, round(loan.monthly_payment, 2), loan.notes, id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM loans WHERE id=?", (id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Not found")
    return dict(row)


@router.delete("/{id}")
def delete_loan(id: int):
    conn = get_db()
    conn.execute("DELETE FROM loans WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.get("/{id}/amortization")
def get_amortization(id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM loans WHERE id=?", (id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Not found")
    d = dict(row)
    pmt = d["monthly_payment"] or calc_payment(d["balance"], d["rate"], d["term_months"])
    return amortize(d["balance"], d["rate"], pmt)
