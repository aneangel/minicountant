from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
import json
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from database import get_db

ALPHA_VANTAGE_BASE = "https://www.alphavantage.co/query"
QUOTE_CACHE_MINUTES = 15

router = APIRouter(prefix="/api/rsus", tags=["rsus"])


class VestEvent(BaseModel):
    date: str
    shares: int
    vested: bool = False
    price_at_vest: Optional[float] = None
    notes: Optional[str] = None


class RSUGrant(BaseModel):
    company: str
    ticker: Optional[str] = None
    broker: Optional[str] = None
    grant_number: Optional[str] = None
    grant_date: Optional[str] = None
    grant_price: Optional[float] = None
    shares_granted: int
    federal_tax_rate: float = 22.0
    current_price: Optional[float] = None
    vesting_schedule: List[VestEvent] = []
    notes: Optional[str] = None


def _enrich(d: dict) -> dict:
    sched = json.loads(d.get("vesting_json") or "[]")
    d["vesting_schedule"] = sched
    d.pop("vesting_json", None)

    vested_events  = [e for e in sched if e.get("vested")]
    pending_events = [e for e in sched if not e.get("vested")]

    d["shares_vested"]  = sum(e["shares"] for e in vested_events)
    d["shares_pending"] = sum(e["shares"] for e in pending_events)
    d["total_vests"]    = len(sched)

    cp  = d.get("current_price")
    ftr = (d.get("federal_tax_rate") or 22.0) / 100

    # Vested value (using price_at_vest per event when available, else current price)
    vested_value = 0.0
    for e in vested_events:
        price = e.get("price_at_vest") or cp or 0
        vested_value += e["shares"] * price
    d["vested_value"] = round(vested_value, 2) if vested_value else None

    # Pending value at current price
    d["pending_value"] = round(cp * d["shares_pending"], 2) if cp and d["shares_pending"] else None

    # Next upcoming vest
    upcoming = sorted(pending_events, key=lambda e: e["date"])
    if upcoming:
        nv = upcoming[0]
        d["next_vest_date"]   = nv["date"]
        d["next_vest_shares"] = nv["shares"]
        if cp:
            gross = nv["shares"] * cp
            tax   = gross * ftr
            d["next_vest_gross"] = round(gross, 2)
            d["next_vest_tax"]   = round(tax, 2)
            d["next_vest_net"]   = round(gross - tax, 2)
            # Shares withheld for tax (sell-to-cover)
            d["next_vest_shares_withheld"]  = int(tax // cp)
            d["next_vest_shares_delivered"] = nv["shares"] - int(tax // cp)
        else:
            d["next_vest_gross"] = d["next_vest_tax"] = d["next_vest_net"] = None
    else:
        d["next_vest_date"] = d["next_vest_shares"] = None

    return d


@router.get("")
def list_grants():
    conn = get_db()
    rows = conn.execute(
        "SELECT * FROM rsu_grants WHERE active=1 ORDER BY grant_date DESC"
    ).fetchall()
    conn.close()
    return [_enrich(dict(r)) for r in rows]


@router.get("/upcoming")
def upcoming_vests(limit: int = 10):
    """Return next N vest events across all active grants."""
    conn = get_db()
    rows = conn.execute(
        "SELECT id, company, ticker, federal_tax_rate, current_price, vesting_json "
        "FROM rsu_grants WHERE active=1"
    ).fetchall()
    conn.close()

    from datetime import date
    today = date.today().isoformat()
    events = []
    for r in rows:
        sched = json.loads(r["vesting_json"] or "[]")
        cp  = r["current_price"]
        ftr = (r["federal_tax_rate"] or 22.0) / 100
        for e in sched:
            if not e.get("vested") and e.get("date", "") >= today:
                ev = {
                    "grant_id":   r["id"],
                    "company":    r["company"],
                    "ticker":     r["ticker"],
                    "date":       e["date"],
                    "shares":     e["shares"],
                }
                if cp:
                    gross = e["shares"] * cp
                    ev["gross_value"] = round(gross, 2)
                    ev["tax_withheld"] = round(gross * ftr, 2)
                    ev["net_value"]    = round(gross * (1 - ftr), 2)
                events.append(ev)

    events.sort(key=lambda e: e["date"])
    return events[:limit]


@router.post("")
def create_grant(g: RSUGrant):
    conn = get_db()
    sched = [e.model_dump() for e in g.vesting_schedule]
    cur = conn.execute("""
        INSERT INTO rsu_grants(
            company, ticker, broker, grant_number, grant_date, grant_price,
            shares_granted, shares_vested, shares_pending,
            federal_tax_rate, current_price, vesting_json, notes, active
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)
    """, (
        g.company, g.ticker, g.broker, g.grant_number, g.grant_date, g.grant_price,
        g.shares_granted,
        sum(e["shares"] for e in sched if e.get("vested")),
        sum(e["shares"] for e in sched if not e.get("vested")),
        g.federal_tax_rate, g.current_price, json.dumps(sched), g.notes,
    ))
    conn.commit()
    row = conn.execute("SELECT * FROM rsu_grants WHERE id=?", (cur.lastrowid,)).fetchone()
    conn.close()
    return _enrich(dict(row))


@router.put("/{id}")
def update_grant(id: int, g: RSUGrant):
    conn = get_db()
    sched = [e.model_dump() for e in g.vesting_schedule]
    conn.execute("""
        UPDATE rsu_grants SET
            company=?, ticker=?, broker=?, grant_number=?, grant_date=?, grant_price=?,
            shares_granted=?, shares_vested=?, shares_pending=?,
            federal_tax_rate=?, current_price=?, vesting_json=?, notes=?
        WHERE id=?
    """, (
        g.company, g.ticker, g.broker, g.grant_number, g.grant_date, g.grant_price,
        g.shares_granted,
        sum(e["shares"] for e in sched if e.get("vested")),
        sum(e["shares"] for e in sched if not e.get("vested")),
        g.federal_tax_rate, g.current_price, json.dumps(sched), g.notes, id,
    ))
    conn.commit()
    row = conn.execute("SELECT * FROM rsu_grants WHERE id=?", (id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Not found")
    return _enrich(dict(row))


@router.delete("/{id}")
def delete_grant(id: int):
    conn = get_db()
    conn.execute("UPDATE rsu_grants SET active=0 WHERE id=?", (id,))
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Live quote ───────────────────────────────────────────────────────

def _av_fetch(ticker: str, api_key: str) -> dict:
    params = urllib.parse.urlencode({
        "function": "GLOBAL_QUOTE",
        "symbol":   ticker,
        "apikey":   api_key,
    })
    url = f"{ALPHA_VANTAGE_BASE}?{params}"
    with urllib.request.urlopen(url, timeout=10) as resp:
        data = json.loads(resp.read())
    gq = data.get("Global Quote", {})
    if not gq or not gq.get("05. price"):
        raise ValueError("Empty quote response — market may be closed or symbol invalid")
    pct_raw = gq.get("10. change percent", "0%").replace("%", "").strip()
    return {
        "ticker":     ticker.upper(),
        "price":      float(gq["05. price"]),
        "change":     float(gq.get("09. change", 0)),
        "change_pct": round(float(pct_raw), 4),
        "prev_close": float(gq.get("08. previous close", 0)),
        "volume":     int(gq.get("06. volume", 0)),
        "trade_date": gq.get("07. latest trading day", ""),
    }


@router.get("/quote/{ticker}")
def get_quote(ticker: str):
    ticker = ticker.upper()
    conn   = get_db()

    key_row = conn.execute("SELECT value FROM config WHERE key='alphavantage_key'").fetchone()
    if not key_row:
        conn.close()
        raise HTTPException(400, "Alpha Vantage API key not configured")
    api_key = key_row["value"]

    # Return cached quote if still fresh
    cache_key = f"av_quote_{ticker}"
    cached_row = conn.execute("SELECT value FROM config WHERE key=?", (cache_key,)).fetchone()
    if cached_row:
        cached = json.loads(cached_row["value"])
        cached_at = datetime.fromisoformat(cached.get("fetched_at", "2000-01-01T00:00:00"))
        if datetime.now() - cached_at < timedelta(minutes=QUOTE_CACHE_MINUTES):
            conn.close()
            return cached

    # Fetch fresh
    try:
        quote = _av_fetch(ticker, api_key)
    except Exception as e:
        conn.close()
        raise HTTPException(502, f"Alpha Vantage: {e}")

    quote["fetched_at"] = datetime.now().isoformat()

    # Persist cache + update all matching grants' current_price
    conn.execute("INSERT OR REPLACE INTO config(key,value) VALUES(?,?)",
                 (cache_key, json.dumps(quote)))
    conn.execute("UPDATE rsu_grants SET current_price=? WHERE ticker=? AND active=1",
                 (quote["price"], ticker))
    conn.commit()
    conn.close()
    return quote


@router.get("/equity-summary")
def equity_summary():
    """Total unvested value, vested value, and upcoming 90-day vests at current prices."""
    conn  = get_db()
    rows  = conn.execute(
        "SELECT * FROM rsu_grants WHERE active=1"
    ).fetchall()
    conn.close()

    from datetime import date
    today     = date.today().isoformat()
    cutoff_90 = (date.today() + timedelta(days=90)).isoformat()

    total_pending_value = 0.0
    total_vested_value  = 0.0
    next_90_gross       = 0.0
    next_90_net         = 0.0
    next_90_shares      = 0

    for r in rows:
        d    = _enrich(dict(r))
        cp   = d.get("current_price") or 0
        ftr  = (d.get("federal_tax_rate") or 22) / 100
        sched = d["vesting_schedule"]

        if cp:
            total_pending_value += cp * d["shares_pending"]
            total_vested_value  += sum(
                e["shares"] * (e.get("price_at_vest") or cp)
                for e in sched if e.get("vested")
            )
            for e in sched:
                if not e.get("vested") and today <= e["date"] <= cutoff_90:
                    gross = e["shares"] * cp
                    next_90_gross  += gross
                    next_90_net    += gross * (1 - ftr)
                    next_90_shares += e["shares"]

    return {
        "pending_value":   round(total_pending_value, 2),
        "vested_value":    round(total_vested_value,  2),
        "next_90_gross":   round(next_90_gross,  2),
        "next_90_net":     round(next_90_net,    2),
        "next_90_shares":  next_90_shares,
    }
