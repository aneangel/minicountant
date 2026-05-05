from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db

router = APIRouter(prefix="/api/recurring", tags=["recurring"])

MONTHLY_FACTOR = {"monthly": 1, "annual": 1/12, "weekly": 52/12, "biweekly": 26/12, "semimonthly": 2}


class Recurring(BaseModel):
    name: str
    kind: str
    amount: float
    category: Optional[str] = None
    frequency: str = "monthly"
    notes: Optional[str] = None


@router.get("")
def list_recurring():
    conn = get_db()
    rows = conn.execute("SELECT * FROM recurring WHERE active=1 ORDER BY kind, category, name").fetchall()
    conn.close()
    items = []
    for r in rows:
        d = dict(r)
        d["monthly_amount"] = d["amount"] * MONTHLY_FACTOR.get(d["frequency"], 1)
        items.append(d)
    return items


@router.post("")
def create_recurring(r: Recurring):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO recurring(name,kind,amount,category,frequency,notes) VALUES(?,?,?,?,?,?)",
        (r.name, r.kind, r.amount, r.category, r.frequency, r.notes),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM recurring WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@router.put("/{id}")
def update_recurring(id: int, r: Recurring):
    conn = get_db()
    conn.execute(
        "UPDATE recurring SET name=?,kind=?,amount=?,category=?,frequency=?,notes=? WHERE id=?",
        (r.name, r.kind, r.amount, r.category, r.frequency, r.notes, id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM recurring WHERE id=?", (id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Not found")
    return dict(row)


@router.delete("/{id}")
def delete_recurring(id: int):
    conn = get_db()
    conn.execute("UPDATE recurring SET active=0 WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return {"ok": True}
