from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


class Account(BaseModel):
    name: str
    type: str
    balance: float
    apy: float = 0.0
    institution: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
def list_accounts():
    conn = get_db()
    rows = conn.execute("SELECT * FROM accounts ORDER BY type, name").fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.post("")
def create_account(a: Account):
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO accounts(name,type,balance,apy,institution,notes) VALUES(?,?,?,?,?,?)",
        (a.name, a.type, a.balance, a.apy, a.institution, a.notes),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM accounts WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return dict(row)


@router.put("/{id}")
def update_account(id: int, a: Account):
    conn = get_db()
    conn.execute(
        "UPDATE accounts SET name=?,type=?,balance=?,apy=?,institution=?,notes=? WHERE id=?",
        (a.name, a.type, a.balance, a.apy, a.institution, a.notes, id),
    )
    conn.commit()
    row = conn.execute("SELECT * FROM accounts WHERE id=?", (id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Not found")
    return dict(row)


@router.delete("/{id}")
def delete_account(id: int):
    conn = get_db()
    conn.execute("DELETE FROM accounts WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return {"ok": True}
