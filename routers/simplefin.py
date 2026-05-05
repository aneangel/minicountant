import base64
import re
import urllib.request
import urllib.parse
import json
import time
from collections import defaultdict
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db

router = APIRouter(prefix="/api/simplefin", tags=["simplefin"])


# ---- Config helpers ----

def get_config(key: str) -> Optional[str]:
    conn = get_db()
    row = conn.execute("SELECT value FROM config WHERE key=?", (key,)).fetchone()
    conn.close()
    return row["value"] if row else None


def set_config(key: str, value: str):
    conn = get_db()
    conn.execute("INSERT OR REPLACE INTO config(key,value) VALUES(?,?)", (key, value))
    conn.commit()
    conn.close()


# ---- SimpleFIN fetch ----

def _fetch_simplefin(access_url: str, start_days: int = 90) -> dict:
    start_ts = int(time.time()) - start_days * 86400
    url = access_url.rstrip("/") + "/accounts?start-date=" + str(start_ts)

    # Extract auth from URL and rebuild without credentials for header
    match = re.match(r"(https?)://([^:]+):([^@]+)@(.+)", url)
    if not match:
        raise ValueError("Access URL format invalid — expected https://user:pass@host/path")
    scheme, user, password, rest = match.groups()
    clean_url = f"{scheme}://{rest}"
    creds = base64.b64encode(f"{user}:{password}".encode()).decode()

    req = urllib.request.Request(clean_url, headers={"Authorization": f"Basic {creds}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise HTTPException(502, f"SimpleFIN returned {e.code}: {e.reason}")
    except Exception as e:
        raise HTTPException(502, f"SimpleFIN fetch failed: {e}")


# ---- Endpoints ----

class SetupToken(BaseModel):
    token: str  # base64-encoded setup token


class AccessURL(BaseModel):
    access_url: str


class LinkAccount(BaseModel):
    sfin_id: str
    account_id: Optional[int] = None   # None = create new
    name: Optional[str] = None
    type: Optional[str] = None
    apy: float = 0.0
    institution: Optional[str] = None
    ignore: bool = False


@router.get("/status")
def get_status():
    url = get_config("simplefin_access_url")
    return {"connected": url is not None}


@router.post("/claim")
def claim_token(body: SetupToken):
    """Exchange a base64 setup token for an access URL."""
    try:
        claim_url = base64.b64decode(body.token.strip()).decode()
    except Exception:
        raise HTTPException(400, "Invalid token — must be base64 encoded")

    match = re.match(r"(https?)://([^:]+):([^@]+)@(.+)", claim_url)
    if not match:
        raise HTTPException(400, "Decoded token is not a valid URL")

    scheme, user, password, rest = match.groups()
    clean_url = f"{scheme}://{rest}"
    creds = base64.b64encode(f"{user}:{password}".encode()).decode()
    req = urllib.request.Request(clean_url, method="POST",
                                  headers={"Authorization": f"Basic {creds}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            access_url = resp.read().decode().strip()
    except urllib.error.HTTPError as e:
        raise HTTPException(502, f"Claim failed: {e.code} {e.reason}")
    except Exception as e:
        raise HTTPException(502, f"Claim failed: {e}")

    set_config("simplefin_access_url", access_url)
    return {"ok": True, "access_url_saved": True}


@router.post("/connect")
def connect_direct(body: AccessURL):
    """Store an access URL directly (skip token claim step)."""
    if not body.access_url.startswith("http"):
        raise HTTPException(400, "Must be a full https:// URL")
    set_config("simplefin_access_url", body.access_url.strip())
    return {"ok": True}


@router.get("/preview")
def preview(days: int = 90):
    """Fetch raw SimpleFIN accounts + last N days of transactions."""
    url = get_config("simplefin_access_url")
    if not url:
        raise HTTPException(400, "SimpleFIN not connected")

    data = _fetch_simplefin(url, days)
    conn = get_db()

    # Persist raw accounts + transactions
    for acct in data.get("accounts", []):
        org_name = acct.get("org", {}).get("name") or acct.get("org", {}).get("domain") or ""
        bal = float(acct.get("balance") or 0)
        bal_date = acct.get("balance-date")
        conn.execute("""
            INSERT INTO simplefin_accounts(sfin_id, org_name, raw_name, currency, balance, balance_date)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(sfin_id) DO UPDATE SET
                org_name=excluded.org_name, raw_name=excluded.raw_name,
                balance=excluded.balance, balance_date=excluded.balance_date
        """, (acct["id"], org_name, acct["name"], acct.get("currency","USD"), bal, bal_date))

        for tx in acct.get("transactions", []):
            conn.execute("""
                INSERT OR IGNORE INTO transactions(id, sfin_account_id, posted, amount, description, memo, pending)
                VALUES(?,?,?,?,?,?,?)
            """, (tx["id"], acct["id"], tx.get("posted",0), float(tx.get("amount",0)),
                  tx.get("description",""), tx.get("memo",""), int(tx.get("pending", False))))

    conn.commit()

    # Return enriched view
    sfin_accts = [dict(r) for r in conn.execute(
        "SELECT * FROM simplefin_accounts ORDER BY org_name, raw_name").fetchall()]
    conn.close()

    for a in sfin_accts:
        if a["balance_date"]:
            a["balance_date_str"] = datetime.fromtimestamp(a["balance_date"],
                                                            tz=timezone.utc).strftime("%Y-%m-%d")

    return {
        "accounts": sfin_accts,
        "errors": data.get("errors", []),
    }


@router.get("/transactions/{sfin_id}")
def get_transactions(sfin_id: str):
    """Return stored transactions for a SimpleFIN account, sorted newest first."""
    conn = get_db()
    rows = conn.execute("""
        SELECT * FROM transactions
        WHERE sfin_account_id=?
        ORDER BY posted DESC LIMIT 200
    """, (sfin_id,)).fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d["date_str"] = datetime.fromtimestamp(d["posted"], tz=timezone.utc).strftime("%Y-%m-%d")
        result.append(d)
    return result


@router.get("/recurring-suggestions/{sfin_id}")
def recurring_suggestions(sfin_id: str):
    """
    Analyze transactions for a SimpleFIN account and surface likely recurring items.
    Groups by normalized description, looks for consistent monthly amounts.
    """
    conn = get_db()
    rows = conn.execute("""
        SELECT posted, amount, description FROM transactions
        WHERE sfin_account_id=? AND pending=0
        ORDER BY posted DESC
    """, (sfin_id,)).fetchall()
    conn.close()

    # Group by cleaned description
    groups = defaultdict(list)
    for r in rows:
        key = _normalize_desc(r["description"])
        groups[key].append({"posted": r["posted"], "amount": r["amount"],
                             "description": r["description"]})

    suggestions = []
    for key, txns in groups.items():
        if len(txns) < 2:
            continue
        amounts = [abs(t["amount"]) for t in txns]
        avg_amount = sum(amounts) / len(amounts)
        spread = max(amounts) - min(amounts)
        # Consistent amount = spread < 5% of avg or < $2
        if spread > max(0.05 * avg_amount, 2.0):
            continue

        # Check rough monthly cadence
        dates = sorted(t["posted"] for t in txns)
        gaps_days = [(dates[i+1] - dates[i]) / 86400 for i in range(len(dates)-1)]
        avg_gap = sum(gaps_days) / len(gaps_days) if gaps_days else 0

        if 25 <= avg_gap <= 35:
            freq = "monthly"
        elif 6 <= avg_gap <= 10:
            freq = "weekly"
        elif 12 <= avg_gap <= 18:
            freq = "biweekly"
        elif 340 <= avg_gap <= 390:
            freq = "annual"
        else:
            continue

        kind = "expense" if txns[0]["amount"] < 0 else "income"
        suggestions.append({
            "description": txns[0]["description"],
            "normalized": key,
            "kind": kind,
            "amount": round(avg_amount, 2),
            "frequency": freq,
            "occurrences": len(txns),
            "last_date": datetime.fromtimestamp(max(dates), tz=timezone.utc).strftime("%Y-%m-%d"),
        })

    suggestions.sort(key=lambda s: s["amount"], reverse=True)
    return suggestions


@router.post("/link")
def link_account(body: LinkAccount):
    """Map a SimpleFIN account to a local account (create or link existing), or ignore it."""
    conn = get_db()

    if body.ignore:
        conn.execute("UPDATE simplefin_accounts SET ignored=1 WHERE sfin_id=?", (body.sfin_id,))
        conn.commit()
        conn.close()
        return {"ok": True, "ignored": True}

    sfin = conn.execute("SELECT * FROM simplefin_accounts WHERE sfin_id=?",
                         (body.sfin_id,)).fetchone()
    if not sfin:
        conn.close()
        raise HTTPException(404, "SimpleFIN account not found")

    if body.account_id:
        # Link to existing account — update its balance
        conn.execute("UPDATE accounts SET balance=? WHERE id=?",
                     (sfin["balance"], body.account_id))
        linked_id = body.account_id
    else:
        # Create new account
        cur = conn.execute("""
            INSERT INTO accounts(name, type, balance, apy, institution)
            VALUES(?,?,?,?,?)
        """, (body.name or sfin["raw_name"], body.type or "checking",
              sfin["balance"] or 0, body.apy, body.institution or sfin["org_name"]))
        linked_id = cur.lastrowid

    conn.execute("UPDATE simplefin_accounts SET linked_account_id=?, ignored=0 WHERE sfin_id=?",
                 (linked_id, body.sfin_id))
    conn.commit()
    conn.close()
    return {"ok": True, "account_id": linked_id}


@router.post("/sync")
def sync_balances():
    """Pull latest balances from SimpleFIN and update all linked accounts."""
    url = get_config("simplefin_access_url")
    if not url:
        raise HTTPException(400, "SimpleFIN not connected")

    # Fetch balances only (no transactions) to save on rate limit
    match = re.match(r"(https?)://([^:]+):([^@]+)@(.+)", url)
    if not match:
        raise HTTPException(500, "Stored access URL is malformed")
    scheme, user, password, rest = match.groups()
    clean_url = f"{scheme}://{rest}".rstrip("/") + "/accounts?balances-only=1"
    creds = base64.b64encode(f"{user}:{password}".encode()).decode()
    req = urllib.request.Request(clean_url, headers={"Authorization": f"Basic {creds}"})

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        raise HTTPException(502, str(e))

    conn = get_db()
    updated = 0
    for acct in data.get("accounts", []):
        bal = float(acct.get("balance") or 0)
        bal_date = acct.get("balance-date")
        conn.execute("""
            UPDATE simplefin_accounts SET balance=?, balance_date=? WHERE sfin_id=?
        """, (bal, bal_date, acct["id"]))

        # Propagate to linked local account
        linked = conn.execute("""
            SELECT linked_account_id FROM simplefin_accounts WHERE sfin_id=? AND linked_account_id IS NOT NULL
        """, (acct["id"],)).fetchone()
        if linked:
            conn.execute("UPDATE accounts SET balance=? WHERE id=?",
                         (bal, linked["linked_account_id"]))
            updated += 1

    conn.commit()
    conn.close()
    return {"ok": True, "accounts_synced": updated}


def _normalize_desc(desc: str) -> str:
    if not desc:
        return ""
    d = desc.upper()
    # Strip trailing noise: dates, ref numbers, location suffixes
    d = re.sub(r"\d{4,}", "", d)
    d = re.sub(r"[*#]", " ", d)
    d = re.sub(r"\s+", " ", d).strip()
    # Keep first 3 words as key
    words = d.split()[:3]
    return " ".join(words)
