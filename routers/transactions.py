from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


class TransactionPatch(BaseModel):
    description: Optional[str] = None
    amount: Optional[float] = None
    category: Optional[str] = None
    date: Optional[str] = None


@router.get("")
def list_transactions(account_id: Optional[int] = None, limit: int = 200, offset: int = 0, search: str = ""):
    conn = get_db()

    accounts = [dict(r) for r in conn.execute("SELECT id, name, institution FROM accounts").fetchall()]
    acc_map = {a["id"]: a for a in accounts}

    where_clauses = []
    params = []

    if account_id:
        where_clauses.append("account_id = ?")
        params.append(account_id)

    if search:
        where_clauses.append("(LOWER(description) LIKE ? OR LOWER(category) LIKE ?)")
        q = "%" + search.lower() + "%"
        params.extend([q, q])

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    total = conn.execute(
        f"SELECT COUNT(*) FROM imported_transactions {where_sql}", params
    ).fetchone()[0]

    rows = conn.execute(
        f"SELECT * FROM imported_transactions {where_sql} ORDER BY date DESC, id DESC LIMIT ? OFFSET ?",
        params + [limit, offset]
    ).fetchall()

    conn.close()

    items = []
    for r in rows:
        d = dict(r)
        acc = acc_map.get(d.get("account_id"))
        d["account_name"] = acc["name"] if acc else "Unknown"
        d["institution"] = acc["institution"] if acc else ""
        items.append(d)

    return {"total": total, "items": items, "accounts": accounts}


@router.patch("/{txn_id}")
def patch_transaction(txn_id: int, body: TransactionPatch):
    conn = get_db()
    row = conn.execute("SELECT id FROM imported_transactions WHERE id=?", (txn_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Not found")

    fields = {k: v for k, v in body.model_dump().items() if v is not None}
    if not fields:
        conn.close()
        return {"ok": True}

    set_clause = ", ".join(f"{k}=?" for k in fields)
    conn.execute(
        f"UPDATE imported_transactions SET {set_clause} WHERE id=?",
        list(fields.values()) + [txn_id]
    )
    conn.commit()
    updated = dict(conn.execute("SELECT * FROM imported_transactions WHERE id=?", (txn_id,)).fetchone())
    conn.close()
    return updated
