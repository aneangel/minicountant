from fastapi import APIRouter, Request
import json
from database import get_db

router = APIRouter(prefix="/api/budget", tags=["budget"])


@router.get("")
def get_budget():
    conn = get_db()
    row = conn.execute("SELECT value FROM config WHERE key='budget_snapshot'").fetchone()
    conn.close()
    if not row:
        return {}
    try:
        return json.loads(row["value"])
    except Exception:
        return {}


@router.post("")
async def save_budget(request: Request):
    body = await request.json()
    conn = get_db()
    conn.execute(
        "INSERT OR REPLACE INTO config(key,value) VALUES('budget_snapshot',?)",
        (json.dumps(body),),
    )
    conn.commit()
    conn.close()
    return {"ok": True}
