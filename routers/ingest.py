import csv
import io
import json
import re
from collections import defaultdict
from datetime import datetime
from fastapi import APIRouter, UploadFile, File, HTTPException
from pydantic import BaseModel
from typing import Optional
from database import get_db

router = APIRouter(prefix="/api/ingest", tags=["ingest"])


# ── PDF extraction ───────────────────────────────────────────────────

def _extract_pdf_text(pdf_bytes: bytes) -> str:
    import pdfplumber
    parts = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=2, y_tolerance=2)
            if text:
                parts.append(text)
            for table in page.extract_tables():
                for row in table:
                    if row:
                        parts.append(" | ".join(str(c or "").strip() for c in row))
    return "\n".join(parts)


# ── Shared utilities ─────────────────────────────────────────────────

_DATE_FMTS = ["%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%d-%b-%Y",
              "%b %d, %Y", "%B %d, %Y", "%m-%d-%Y", "%d/%m/%Y"]

def _parse_date(s: str) -> Optional[str]:
    if not s:
        return None
    s = s.strip()
    for fmt in _DATE_FMTS:
        try:
            return datetime.strptime(s, fmt).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None

def _parse_amount(s: str) -> Optional[float]:
    if s is None:
        return None
    s = str(s).strip().replace(",", "").replace("$", "").replace(" ", "")
    if s in ("", "-", "--"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()")
    try:
        v = float(s)
        return -v if neg else v
    except ValueError:
        return None

def _re_amount(text: str, pattern: str) -> Optional[float]:
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        return _parse_amount(m.group(1))
    return None

def _re_str(text: str, pattern: str) -> Optional[str]:
    m = re.search(pattern, text, re.IGNORECASE)
    return m.group(1).strip() if m else None

def _re_date(text: str, pattern: str) -> Optional[str]:
    m = re.search(pattern, text, re.IGNORECASE)
    return _parse_date(m.group(1).strip()) if m else None


# ── PDF heuristic parser ─────────────────────────────────────────────

def _score_doc_type(text: str) -> str:
    tl = text.lower()
    scores = {
        "bank_statement": 0,
        "credit_card":    0,
        "rsu_letter":     0,
        "brokerage":      0,
    }
    bank_kw    = ["checking account", "savings account", "beginning balance",
                  "ending balance", "available balance", "routing number",
                  "direct deposit", "overdraft"]
    cc_kw      = ["credit card", "minimum payment", "payment due", "new balance",
                  "statement balance", "annual percentage rate", "credit limit",
                  "revolving credit", "purchases", "cash advances"]
    rsu_kw     = ["restricted stock", "rsu", "grant date", "shares granted",
                  "vesting schedule", "vest date", "grant number", "equity award",
                  "stock award", "unvested"]
    broker_kw  = ["brokerage", "portfolio", "holdings", "shares", "symbol",
                  "market value", "cost basis", "dividend", "mutual fund", "etf",
                  "account value", "total portfolio"]
    for kw in bank_kw:
        if kw in tl: scores["bank_statement"] += 1
    for kw in cc_kw:
        if kw in tl: scores["credit_card"]    += 1
    for kw in rsu_kw:
        if kw in tl: scores["rsu_letter"]     += 1
    for kw in broker_kw:
        if kw in tl: scores["brokerage"]      += 1
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "unknown"


def _parse_pdf(text: str) -> dict:
    doc_type   = _score_doc_type(text)
    institution = _re_str(text, r"(?:bank|institution|issuer)[:\s]+([A-Za-z &,.']+?)(?:\n|$)")
    data: dict = {}

    if doc_type == "bank_statement":
        data = {
            "account_name":   _re_str(text,   r"account\s+(?:name|owner)[:\s]+(.+?)(?:\n|$)"),
            "account_number": _re_str(text,   r"account\s+(?:number|#|no\.?)[:\s]+([\dX*\-]+)"),
            "account_type":   "savings" if re.search(r"savings", text, re.I) else "checking",
            "statement_date": _re_date(text,  r"statement\s+(?:date|period)[:\s]+(.+?)(?:\n|$)"),
            "ending_balance": _re_amount(text, r"ending\s+balance[:\s]*\$?([\d,]+\.?\d*)"),
            "transactions":   _extract_pdf_transactions(text),
        }
        if not data["ending_balance"]:
            data["ending_balance"] = _re_amount(text, r"available\s+balance[:\s]*\$?([\d,]+\.?\d*)")

    elif doc_type == "credit_card":
        data = {
            "account_number":  _re_str(text,   r"account\s*(?:number|#|no\.?)[:\s]+([\dX*\- ]+)"),
            "statement_date":  _re_date(text,  r"(?:statement|closing)\s+date[:\s]+(.+?)(?:\n|$)"),
            "statement_balance": _re_amount(text, r"(?:new|statement|current)\s+balance[:\s]*\$?([\d,]+\.?\d*)"),
            "minimum_payment": _re_amount(text, r"minimum\s+(?:payment|payment\s+due)[:\s]*\$?([\d,]+\.?\d*)"),
            "apr":             _re_amount(text, r"(?:annual\s+percentage\s+rate|apr)[:\s]*([\d.]+)\s*%"),
            "credit_limit":    _re_amount(text, r"credit\s+limit[:\s]*\$?([\d,]+\.?\d*)"),
            "transactions":    _extract_pdf_transactions(text),
        }

    elif doc_type == "rsu_letter":
        data = {
            "company":        _re_str(text,   r"(?:company|employer|issued\s+by)[:\s]+(.+?)(?:\n|$)"),
            "ticker":         _re_str(text,   r"\b([A-Z]{1,5})\b.*?(?:stock|shares|nasdaq|nyse)"),
            "grant_number":   _re_str(text,   r"grant\s*(?:number|#|id)[:\s]+([\w\-]+)"),
            "grant_date":     _re_date(text,  r"grant\s+date[:\s]+(.+?)(?:\n|$)"),
            "grant_price":    _re_amount(text, r"(?:grant|fair\s+market)\s+(?:price|value)[:\s]*\$?([\d,]+\.?\d*)"),
            "shares_granted": _parse_amount(_re_str(text, r"(?:shares?\s+granted|total\s+shares?)[:\s]+([\d,]+)")),
            "shares_vested":  _parse_amount(_re_str(text, r"shares?\s+vested[:\s]+([\d,]+)")),
            "shares_pending": _parse_amount(_re_str(text, r"(?:unvested|shares?\s+pending)[:\s]+([\d,]+)")),
            "vesting_schedule": _extract_vesting_schedule(text),
        }

    elif doc_type == "brokerage":
        data = {
            "account_number": _re_str(text,   r"account\s*(?:number|#|no\.?)[:\s]+([\dX*\- ]+)"),
            "statement_date": _re_date(text,  r"(?:statement|as\s+of)\s+date[:\s]+(.+?)(?:\n|$)"),
            "total_value":    _re_amount(text, r"(?:total\s+(?:account\s+)?value|portfolio\s+value)[:\s]*\$?([\d,]+\.?\d*)"),
            "cash_balance":   _re_amount(text, r"cash\s+(?:balance|&\s+cash\s+equivalents)[:\s]*\$?([\d,]+\.?\d*)"),
            "holdings":       _extract_holdings(text),
        }

    summary = f"{doc_type.replace('_',' ').title()} — {institution or 'unknown institution'}"
    return {
        "doc_type":    doc_type,
        "confidence":  None,
        "institution": institution,
        "summary":     summary,
        "data":        data,
    }


def _extract_pdf_transactions(text: str) -> list:
    """Pull date + description + amount triples from free-form statement text."""
    date_pat = r"(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\w{3}\s+\d{1,2})"
    amount_pat = r"(-?\$?[\d,]+\.\d{2})"
    pattern = re.compile(
        rf"{date_pat}\s+(.{{4,60}}?)\s+{amount_pat}(?:\s|$)", re.MULTILINE
    )
    txns = []
    for m in pattern.finditer(text):
        date_str, desc, amt_str = m.group(1), m.group(2).strip(), m.group(3)
        amt = _parse_amount(amt_str)
        date = _parse_date(date_str)
        if amt is not None and desc and len(txns) < 100:
            txns.append({"date": date, "description": desc, "amount": amt})
    return txns


def _extract_vesting_schedule(text: str) -> list:
    date_pat = r"(\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\w+ \d{1,2},?\s+\d{4})"
    shares_pat = r"([\d,]+)"
    pattern = re.compile(
        rf"{date_pat}\s+{shares_pat}(?:\s+(vested|unvested|pending))?", re.IGNORECASE
    )
    events = []
    for m in pattern.finditer(text):
        date = _parse_date(m.group(1))
        shares = _parse_amount(m.group(2))
        status = (m.group(3) or "").lower()
        if date and shares and len(events) < 60:
            events.append({
                "date": date,
                "shares": int(shares),
                "vested": status == "vested",
            })
    return events


def _extract_holdings(text: str) -> list:
    ticker_pat = r"\b([A-Z]{1,5})\b"
    # Look for lines with a ticker + shares + price pattern
    pattern = re.compile(
        r"([A-Z]{1,5})\s+.{0,40}?\s+([\d,]+\.?\d*)\s+\$?([\d,]+\.\d{2})\s+\$?([\d,]+\.\d{2})"
    )
    holdings = []
    seen = set()
    for m in pattern.finditer(text):
        sym = m.group(1)
        if sym in seen or len(holdings) >= 50:
            continue
        seen.add(sym)
        holdings.append({
            "symbol": sym,
            "shares": _parse_amount(m.group(2)),
            "price":  _parse_amount(m.group(3)),
            "value":  _parse_amount(m.group(4)),
        })
    return holdings


# ── CSV parser ───────────────────────────────────────────────────────

def _normalize_header(h) -> str:
    if not h:
        return "_empty"
    return re.sub(r"[^a-z0-9]", "_", str(h).strip().strip('"').lower())


def _find_col(headers: list[str], candidates: list[str]) -> Optional[str]:
    """Return the first header that fuzzy-matches any candidate."""
    for c in candidates:
        for h in headers:
            if h == "_empty":
                continue
            if c in h or h in c:
                return h
    return None


def _parse_csv_line(line: str) -> list:
    """Parse a single CSV line respecting quoted fields."""
    try:
        return next(csv.reader([line]))
    except StopIteration:
        return []


def _parse_schwab_equity_csv(content: str) -> dict:
    """Parse Charles Schwab Equity Awards Center multi-section CSV."""
    lines = content.splitlines()

    grants: list         = []
    vested_records: dict = {}   # award_id -> [{date, shares, price}]
    current_grant        = None
    section              = None
    reading_vest_sched   = False
    reading_award_id     = False

    for raw_line in lines:
        line = raw_line.strip()

        # ── section markers ──
        if "*** RESTRICTED STOCK UNITS ***" in line.upper():
            section = "RSU"; current_grant = None
            reading_vest_sched = reading_award_id = False
            continue
        if "*** EMPLOYEE STOCK PURCHASE PLAN" in line.upper():
            section = "ESPP"; continue
        if "*** EQUITY AWARD SHARES ***" in line.upper():
            section = "EQUITY_SHARES"; continue

        if not line:
            reading_vest_sched = False
            reading_award_id   = False
            continue

        parts = _parse_csv_line(line)
        if not parts:
            continue

        # ── RSU section ──
        if section == "RSU":
            # Grant row: first col is a parseable date, not a header keyword
            if (parts[0] and _parse_date(parts[0]) and
                    parts[0] not in ("Award Date",) and len(parts) >= 5):
                if current_grant:
                    grants.append(current_grant)
                current_grant = {
                    "grant_date":       _parse_date(parts[0]),
                    "ticker":           parts[1] if len(parts) > 1 else None,
                    "company":          "",
                    "broker":           "Charles Schwab",
                    "grant_price":      _parse_amount(parts[3]) if len(parts) > 3 else None,
                    "shares_granted":   int(_parse_amount(parts[4]) or 0) if len(parts) > 4 else 0,
                    "tax_election":     parts[6] if len(parts) > 6 else "",
                    "grant_number":     None,
                    "shares_vested":    0,
                    "shares_pending":   0,
                    "vesting_schedule": [],
                }
                reading_vest_sched = reading_award_id = False

            elif parts[0] == "Award ID":
                reading_award_id   = True
                reading_vest_sched = False

            elif reading_award_id and current_grant and parts[0]:
                current_grant["grant_number"]  = parts[0]
                current_grant["shares_vested"] = int(_parse_amount(parts[1]) or 0) if len(parts) > 1 else 0
                current_grant["shares_pending"]= int(_parse_amount(parts[2]) or 0) if len(parts) > 2 else 0
                reading_award_id = False

            elif "Vest Date" in line and "# of Shares" in line:
                reading_vest_sched = True

            elif reading_vest_sched and current_grant and len(parts) >= 3:
                date   = _parse_date(parts[1])
                shares = int(_parse_amount(parts[2]) or 0)
                if date and shares:
                    current_grant["vesting_schedule"].append({
                        "date": date, "shares": shares,
                        "vested": False, "price_at_vest": None,
                    })

        # ── Equity Award Shares section (actual vest records with prices) ──
        elif section == "EQUITY_SHARES":
            if parts[0] in ("Award Date", "Date Holding Period Met", "Totals", ""):
                continue
            if _parse_date(parts[0]) and len(parts) >= 10:
                award_id     = parts[2]
                deposit_date = _parse_date(parts[6]) if len(parts) > 6 else None
                acquired_date= _parse_date(parts[7]) if len(parts) > 7 else None
                price        = _parse_amount(parts[8]) if len(parts) > 8 else None
                shares       = int(_parse_amount(parts[9]) or 0) if len(parts) > 9 else 0
                vest_date    = deposit_date or acquired_date
                if award_id and vest_date and shares:
                    vested_records.setdefault(award_id, []).append(
                        {"date": vest_date, "shares": shares, "price": price}
                    )

    if current_grant:
        grants.append(current_grant)

    # ── Match vested records to vesting schedule events ──
    today = datetime.now().strftime("%Y-%m-%d")
    for grant in grants:
        records = vested_records.get(str(grant.get("grant_number", "")), [])

        def _find_record(vest_date: str):
            vd = datetime.strptime(vest_date, "%Y-%m-%d")
            for r in records:
                if abs((vd - datetime.strptime(r["date"], "%Y-%m-%d")).days) <= 3:
                    return r
            return None

        for event in grant["vesting_schedule"]:
            rec = _find_record(event["date"])
            if rec:
                event["vested"]        = True
                event["price_at_vest"] = rec.get("price")
            elif event["date"] <= today:
                event["vested"] = True   # past date, no price record found

    total_granted = sum(g["shares_granted"] for g in grants)
    total_vested  = sum(g["shares_vested"]  for g in grants)
    total_pending = sum(g["shares_pending"] for g in grants)

    return {
        "doc_type":    "rsu_letter",
        "confidence":  0.98,
        "institution": "Charles Schwab",
        "summary": (
            f"Equity Awards — {len(grants)} RSU grants | "
            f"{total_granted} shares granted | {total_vested} vested | {total_pending} pending"
        ),
        "data": {
            "company":      grants[0].get("company", "") if grants else "",
            "ticker":       grants[0].get("ticker", "") if grants else "",
            "broker":       "Charles Schwab",
            "grants":       grants,
            "total_grants": len(grants),
            "total_shares": total_granted,
            "shares_vested":  total_vested,
            "shares_pending": total_pending,
        },
    }


def parse_csv(content: str, filename: str) -> dict:
    # Strip BOM
    content = content.lstrip("﻿")
    # Drop leading blank lines (some exporters prepend \r-only lines)
    lines = content.splitlines()
    while lines and not lines[0].strip():
        lines.pop(0)
    # Strip leading tab characters from data rows (common in some bank exports)
    lines = [l.lstrip("\t") for l in lines]
    content = "\n".join(lines)

    # Schwab Equity Awards Center — detected before standard CSV header parsing
    if "*** RESTRICTED STOCK UNITS ***" in content.upper():
        return _parse_schwab_equity_csv(content)

    # Headerless CSV: if first non-empty line starts with a parseable date, inject headers
    first_line = lines[0] if lines else ""
    first_parts = _parse_csv_line(first_line)
    if first_parts and _parse_date(first_parts[0]):
        n_cols = max((len(_parse_csv_line(l)) for l in lines[:10] if l.strip()), default=3)
        synth = ["date", "description", "amount"] + [f"col{i}" for i in range(3, n_cols)]
        content = ",".join(synth[:n_cols]) + "\n" + content

    reader = csv.DictReader(io.StringIO(content))
    raw_headers = list(reader.fieldnames or [])
    headers = [_normalize_header(h) for h in raw_headers]
    header_map = dict(zip(headers, raw_headers))

    rows = list(reader)
    if not rows:
        return {"doc_type": "unknown", "confidence": None, "institution": None,
                "summary": "Empty CSV", "data": {}}

    doc_type = _detect_csv_type(headers, filename.lower())

    if doc_type in ("bank_statement", "credit_card"):
        return _parse_transaction_csv(rows, headers, header_map, doc_type)
    elif doc_type == "brokerage":
        return _parse_brokerage_csv(rows, headers, header_map)
    elif doc_type == "rsu_letter":
        return _parse_rsu_csv(rows, headers, header_map)
    else:
        # Best-effort: try transaction parsing
        result = _parse_transaction_csv(rows, headers, header_map, "bank_statement")
        result["doc_type"] = "unknown"
        result["summary"] = "Unrecognized CSV — parsed as transactions"
        return result


def _detect_csv_type(headers: list[str], filename: str) -> str:
    hset = set(headers)  # exact normalized header names

    def match(keywords):
        return any(k in hset for k in keywords)

    # RSU / equity (check first — most specific)
    if match({"grant_date", "vest_date", "vesting_date", "shares_granted",
              "grant_number", "award_date", "unvested"}):
        return "rsu_letter"

    # Brokerage (exact column names, not substrings)
    if match({"symbol", "ticker", "quantity", "cost_basis", "market_value",
              "holdings", "shares_owned"}):
        return "brokerage"

    # Amex CC — unique columns not present in bank statements
    if "extended_details" in hset or "appears_on_your_statement_as" in hset:
        return "credit_card"

    # Credit card
    if match({"card_no", "card_number", "credit_limit"}) or "credit" in filename:
        return "credit_card"

    # Bank / generic transaction
    if match({"date", "description", "payee", "amount", "debit", "credit",
              "balance", "transaction_date", "post_date", "posted_date"}):
        return "bank_statement"

    return "unknown"


def _parse_transaction_csv(rows, headers, header_map, doc_type) -> dict:
    date_col  = _find_col(headers, ["transaction_date", "date", "posted_date", "post_date"])
    desc_col  = _find_col(headers, ["description", "payee", "merchant", "details",
                                     "original_description", "memo", "name"])
    amt_col   = _find_col(headers, ["amount"])
    debit_col = _find_col(headers, ["debit", "withdrawal", "charges"])
    cred_col  = _find_col(headers, ["credit", "deposit", "payments"])
    bal_col   = _find_col(headers, ["balance", "running_bal", "running_balance"])
    cat_col   = _find_col(headers, ["category", "type"])

    # Amex CC exports: positive = charge (expense), negative = payment/credit
    # Negate so our convention (negative = expense) is consistent
    hset = set(headers)
    is_amex_cc = "extended_details" in hset or "appears_on_your_statement_as" in hset

    transactions = []
    last_balance = None

    for row in rows:
        raw = {_normalize_header(k): v for k, v in row.items()}

        date_str = raw.get(date_col, "")
        desc     = raw.get(desc_col, "").strip() if desc_col else ""
        date     = _parse_date(date_str) if date_str else None

        # Resolve amount
        if amt_col:
            amt = _parse_amount(raw.get(amt_col))
            if is_amex_cc and amt is not None:
                amt = -amt
        elif debit_col or cred_col:
            d = _parse_amount(raw.get(debit_col)) if debit_col else None
            c = _parse_amount(raw.get(cred_col))  if cred_col  else None
            if d and d != 0:
                amt = -abs(d)
            elif c and c != 0:
                amt = abs(c)
            else:
                amt = None
        else:
            amt = None

        if bal_col:
            b = _parse_amount(raw.get(bal_col))
            if b is not None:
                last_balance = b

        if date and desc and amt is not None:
            transactions.append({
                "date": date, "description": desc, "amount": amt,
                "category": raw.get(cat_col, "") if cat_col else None,
            })

    # Best-guess ending balance from last balance column or last row amount
    ending_balance = last_balance

    # Detect institution — Amex CC is unambiguous from its column signature
    inst = "American Express" if is_amex_cc else _institution_from_filename(header_map, rows)

    data = {
        "account_type": "checking",
        "statement_date": transactions[0]["date"] if transactions else None,
        "ending_balance": ending_balance,
        "transactions": transactions,
    }
    if doc_type == "credit_card":
        # Find statement balance — sum of credits - debits, or last balance
        data["statement_balance"] = ending_balance
        data.pop("ending_balance", None)
        data.pop("account_type", None)

    return {
        "doc_type": doc_type,
        "confidence": None,
        "institution": inst,
        "summary": f"{doc_type.replace('_',' ').title()} — {len(transactions)} transactions",
        "data": data,
    }


def _parse_brokerage_csv(rows, headers, header_map) -> dict:
    sym_col   = _find_col(headers, ["symbol", "ticker"])
    name_col  = _find_col(headers, ["description", "security_description", "name", "security"])
    qty_col   = _find_col(headers, ["quantity", "shares", "qty"])
    price_col = _find_col(headers, ["price", "last_price", "market_price"])
    val_col   = _find_col(headers, ["market_value", "value", "total_value", "amount"])

    holdings = []
    total = 0.0
    for row in rows:
        raw = {_normalize_header(k): v for k, v in row.items()}
        sym   = raw.get(sym_col,   "").strip() if sym_col   else ""
        name  = raw.get(name_col,  "").strip() if name_col  else ""
        qty   = _parse_amount(raw.get(qty_col))   if qty_col   else None
        price = _parse_amount(raw.get(price_col)) if price_col else None
        val   = _parse_amount(raw.get(val_col))   if val_col   else None
        if val is None and qty and price:
            val = round(qty * price, 2)
        if (sym or name) and qty is not None:
            holdings.append({"symbol": sym, "name": name,
                             "shares": qty, "price": price, "value": val})
            if val:
                total += val

    return {
        "doc_type": "brokerage",
        "confidence": None,
        "institution": _institution_from_filename(header_map, rows),
        "summary": f"Brokerage — {len(holdings)} holdings, total ${total:,.2f}",
        "data": {
            "total_value": round(total, 2),
            "cash_balance": None,
            "statement_date": None,
            "holdings": holdings,
        },
    }


def _parse_rsu_csv(rows, headers, header_map) -> dict:
    grant_date_col  = _find_col(headers, ["grant_date", "award_date", "issue_date"])
    vest_date_col   = _find_col(headers, ["vest_date", "vesting_date", "release_date"])
    shares_col      = _find_col(headers, ["shares", "quantity", "units"])
    price_col       = _find_col(headers, ["grant_price", "fmv", "price", "fair_market_value"])
    status_col      = _find_col(headers, ["status", "vested", "state"])
    grant_num_col   = _find_col(headers, ["grant_number", "grant_id", "award_number"])

    vesting = []
    total_granted = 0
    total_vested  = 0
    grant_date    = None
    grant_price   = None
    grant_number  = None

    for row in rows:
        raw    = {_normalize_header(k): v for k, v in row.items()}
        date   = _parse_date(raw.get(vest_date_col or grant_date_col, ""))
        shares = _parse_amount(raw.get(shares_col, "")) if shares_col else None
        price  = _parse_amount(raw.get(price_col, ""))  if price_col  else None
        status = (raw.get(status_col, "") or "").lower() if status_col else ""
        gnum   = raw.get(grant_num_col, "") if grant_num_col else ""
        gdate  = _parse_date(raw.get(grant_date_col, "")) if grant_date_col else None

        if not grant_date and gdate:
            grant_date = gdate
        if not grant_price and price:
            grant_price = price
        if not grant_number and gnum:
            grant_number = gnum

        if shares and date:
            vested = status in ("vested", "released", "delivered", "yes", "true", "1")
            vesting.append({"date": date, "shares": int(shares), "vested": vested})
            total_granted += int(shares)
            if vested:
                total_vested += int(shares)

    return {
        "doc_type": "rsu_letter",
        "confidence": None,
        "institution": None,
        "summary": f"RSU Grant — {total_granted} shares, {total_vested} vested",
        "data": {
            "company": None,
            "grant_number": grant_number,
            "grant_date": grant_date,
            "grant_price": grant_price,
            "shares_granted": total_granted,
            "shares_vested": total_vested,
            "shares_pending": total_granted - total_vested,
            "vesting_schedule": vesting,
        },
    }


def _institution_from_filename(header_map, rows) -> Optional[str]:
    banks = ["chase", "bank of america", "wells fargo", "citi", "capital one",
             "schwab", "fidelity", "vanguard", "td ameritrade", "ally",
             "usaa", "discover", "amex", "american express", "navy federal",
             "sofi", "synchrony", "barclays"]
    combined = " ".join(str(v) for v in header_map.values()).lower()
    for b in banks:
        if b in combined:
            return b.title()
    # Scan description values from first 30 rows for institution clues
    desc_sample = " ".join(
        str(v).lower()
        for row in rows[:30]
        for v in row.values()
        if v and len(str(v)) > 4
    )
    for b in banks:
        if b in desc_sample:
            return b.title()
    return None


# ── DB helpers ───────────────────────────────────────────────────────

def _ensure_tables():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS pdf_imports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            filename TEXT NOT NULL,
            doc_type TEXT,
            imported_at TEXT DEFAULT CURRENT_TIMESTAMP,
            raw_text TEXT,
            parsed_json TEXT,
            status TEXT DEFAULT 'pending'
        );
        CREATE TABLE IF NOT EXISTS rsu_grants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company TEXT NOT NULL,
            ticker TEXT,
            grant_number TEXT,
            grant_date TEXT,
            grant_price REAL,
            shares_granted INTEGER NOT NULL DEFAULT 0,
            shares_vested INTEGER NOT NULL DEFAULT 0,
            shares_pending INTEGER NOT NULL DEFAULT 0,
            vesting_json TEXT,
            import_id INTEGER REFERENCES pdf_imports(id),
            notes TEXT
        );
        CREATE TABLE IF NOT EXISTS imported_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            import_id INTEGER REFERENCES pdf_imports(id),
            account_id INTEGER,
            date TEXT,
            description TEXT,
            amount REAL,
            category TEXT
        );
    """)
    conn.commit()
    conn.close()


_ensure_tables()


# ── Dedup helpers ───────────────────────────────────────────────────

def _annotate_duplicates(conn, parsed: dict) -> tuple[int, int]:
    """Flag each transaction with is_duplicate. Returns (new_count, dupe_count)."""
    data = parsed.get("data", {})
    txns = data.get("transactions", [])
    if not txns:
        return 0, 0
    new_count = dupe_count = 0
    for tx in txns:
        if not tx.get("date") or tx.get("amount") is None:
            tx["is_duplicate"] = False
            new_count += 1
            continue
        row = conn.execute(
            "SELECT id FROM imported_transactions WHERE date=? AND ABS(amount - ?) < 0.01",
            (tx["date"], float(tx["amount"])),
        ).fetchone()
        if row:
            tx["is_duplicate"] = True
            dupe_count += 1
        else:
            tx["is_duplicate"] = False
            new_count += 1
    data["new_count"]       = new_count
    data["duplicate_count"] = dupe_count
    return new_count, dupe_count


def _store_transactions(conn, import_id: int, account_id: Optional[int], transactions: list) -> tuple[int, int]:
    """Persist non-duplicate transactions. Returns (stored_count, skipped_count)."""
    stored = skipped = 0
    for tx in transactions:
        if tx.get("is_duplicate"):
            skipped += 1
            continue
        conn.execute(
            "INSERT INTO imported_transactions(import_id,account_id,date,description,amount,category) "
            "VALUES(?,?,?,?,?,?)",
            (import_id, account_id, tx.get("date"), tx.get("description"),
             tx.get("amount"), tx.get("category")),
        )
        stored += 1
    return stored, skipped


# ── Endpoints ────────────────────────────────────────────────────────

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    fname = file.filename.lower()
    if not (fname.endswith(".pdf") or fname.endswith(".csv")):
        raise HTTPException(400, "Only PDF and CSV files are supported")

    raw_bytes = await file.read()

    if fname.endswith(".pdf"):
        try:
            text = _extract_pdf_text(raw_bytes)
        except Exception as e:
            raise HTTPException(422, f"PDF extraction failed: {e}")
        if len(text.strip()) < 50:
            raise HTTPException(422, "Could not extract readable text (may be scanned/image-only PDF)")
        parsed = _parse_pdf(text)
        stored_text = text[:50000]

    else:  # CSV
        try:
            text = raw_bytes.decode("utf-8-sig", errors="replace")
        except Exception as e:
            raise HTTPException(422, f"Could not read CSV: {e}")
        parsed = parse_csv(text, file.filename)
        stored_text = text[:50000]

    conn = get_db()
    _annotate_duplicates(conn, parsed)
    cur = conn.execute(
        "INSERT INTO pdf_imports(filename, doc_type, raw_text, parsed_json, status) VALUES(?,?,?,?,?)",
        (file.filename, parsed.get("doc_type", "unknown"),
         stored_text, json.dumps(parsed), "pending"),
    )
    import_id = cur.lastrowid
    conn.commit()
    conn.close()

    return {"import_id": import_id, "parsed": parsed}


class PatchBody(BaseModel):
    institution: Optional[str] = None
    doc_type: Optional[str] = None
    account_name: Optional[str] = None
    account_type: Optional[str] = None
    company: Optional[str] = None
    ticker: Optional[str] = None


@router.post("/{import_id}/patch")
def patch_import(import_id: int, body: PatchBody):
    """Merge user-supplied corrections into the stored parsed JSON."""
    conn = get_db()
    row = conn.execute("SELECT * FROM pdf_imports WHERE id=?", (import_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Not found")

    parsed = json.loads(row["parsed_json"])
    data   = parsed.setdefault("data", {})

    if body.institution is not None:
        parsed["institution"] = body.institution
    if body.doc_type is not None:
        parsed["doc_type"] = body.doc_type
    if body.account_name is not None:
        data["account_name"] = body.account_name
    if body.account_type is not None:
        data["account_type"] = body.account_type
    if body.company is not None:
        data["company"] = body.company
    if body.ticker is not None:
        data["ticker"] = body.ticker

    conn.execute(
        "UPDATE pdf_imports SET doc_type=?, parsed_json=? WHERE id=?",
        (parsed["doc_type"], json.dumps(parsed), import_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True, "parsed": parsed}


@router.get("/scan-recurring")
def scan_recurring():
    """Analyze all imported transactions and return recurring candidates."""
    conn = get_db()
    rows = conn.execute(
        "SELECT date, description, amount FROM imported_transactions ORDER BY date"
    ).fetchall()
    conn.close()
    if not rows:
        return {"suggestions": []}
    suggestions = _suggestions_from_txns([dict(r) for r in rows])
    return {"suggestions": suggestions}


@router.get("/history")
def get_history():
    conn = get_db()
    rows = conn.execute(
        "SELECT id, filename, doc_type, imported_at, status FROM pdf_imports ORDER BY imported_at DESC LIMIT 50"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.get("/{import_id}")
def get_import(import_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM pdf_imports WHERE id=?", (import_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Not found")
    d = dict(row)
    d["parsed"] = json.loads(d["parsed_json"]) if d["parsed_json"] else {}
    return d


@router.delete("/{import_id}")
def delete_import(import_id: int):
    conn = get_db()
    conn.execute("DELETE FROM imported_transactions WHERE import_id=?", (import_id,))
    conn.execute("DELETE FROM pdf_imports WHERE id=?", (import_id,))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/{import_id}/confirm")
def confirm_import(import_id: int):
    conn = get_db()
    row = conn.execute("SELECT * FROM pdf_imports WHERE id=?", (import_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Not found")

    parsed   = json.loads(row["parsed_json"])
    doc_type = parsed.get("doc_type")
    data     = parsed.get("data", {})
    inst     = parsed.get("institution") or ""
    imported = []

    if doc_type == "bank_statement":
        bal  = data.get("ending_balance") or 0
        name = data.get("account_name") or inst or "Imported Account"
        cur2 = conn.execute(
            "INSERT INTO accounts(name,type,balance,apy,institution) VALUES(?,?,?,?,?)",
            (name, data.get("account_type", "checking"), bal, 0, inst),
        )
        account_id = cur2.lastrowid
        imported.append(f"Account: {name} — ${bal:,.2f}")
        txns = data.get("transactions", [])
        stored, skipped = _store_transactions(conn, import_id, account_id, txns)
        if txns:
            imported.append(f"{stored} new transactions" + (f", {skipped} duplicates skipped" if skipped else ""))
        _auto_recurring(conn, [tx for tx in txns if not tx.get("is_duplicate")])

    elif doc_type == "credit_card":
        bal  = abs(data.get("statement_balance") or 0)
        name = f"{inst} Credit Card" if inst else "Credit Card"
        num  = data.get("account_number", "")
        if num:
            name += f" ...{str(num).replace(' ','')[-4:]}"
        cur2 = conn.execute(
            "INSERT INTO accounts(name,type,balance,apy,institution) VALUES(?,?,?,?,?)",
            (name, "other", -bal, 0, inst),
        )
        account_id = cur2.lastrowid
        imported.append(f"Account: {name} — balance ${bal:,.2f}")
        txns = data.get("transactions", [])
        stored, skipped = _store_transactions(conn, import_id, account_id, txns)
        if txns:
            imported.append(f"{stored} new transactions" + (f", {skipped} duplicates skipped" if skipped else ""))
        _auto_recurring(conn, [tx for tx in txns if not tx.get("is_duplicate")])

    elif doc_type == "rsu_letter":
        grants_list = data.get("grants")
        if grants_list:
            # Multi-grant from Schwab Equity Awards Center
            for gd in grants_list:
                sched = gd.get("vesting_schedule", [])
                conn.execute("""
                    INSERT INTO rsu_grants(
                        company, ticker, broker, grant_number, grant_date, grant_price,
                        shares_granted, shares_vested, shares_pending,
                        federal_tax_rate, current_price, vesting_json, import_id, active
                    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)
                """, (
                    gd.get("company") or "",
                    gd.get("ticker"),
                    gd.get("broker"),
                    gd.get("grant_number"),
                    gd.get("grant_date"),
                    gd.get("grant_price"),
                    gd.get("shares_granted", 0),
                    gd.get("shares_vested", 0),
                    gd.get("shares_pending", 0),
                    22.0,
                    None,
                    json.dumps(sched),
                    import_id,
                ))
                imported.append(
                    f"RSU Grant #{gd.get('grant_number')} ({gd.get('grant_date')}) — "
                    f"{gd.get('shares_granted', 0)} shares, {gd.get('shares_pending', 0)} pending"
                )
        else:
            # Single-grant path (PDF or manual)
            company = data.get("company") or inst or "Unknown"
            conn.execute("""
                INSERT INTO rsu_grants(
                    company, ticker, broker, grant_number, grant_date, grant_price,
                    shares_granted, shares_vested, shares_pending,
                    federal_tax_rate, vesting_json, import_id, active
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1)
            """, (
                company, data.get("ticker"), data.get("broker"),
                data.get("grant_number"), data.get("grant_date"),
                data.get("grant_price"), data.get("shares_granted", 0),
                data.get("shares_vested", 0), data.get("shares_pending", 0),
                22.0, json.dumps(data.get("vesting_schedule", [])), import_id,
            ))
            imported.append(f"RSU Grant: {company} — {data.get('shares_granted', 0)} shares")

    elif doc_type == "brokerage":
        total = data.get("total_value") or 0
        name  = f"{inst} Brokerage" if inst else "Brokerage Account"
        conn.execute(
            "INSERT INTO accounts(name,type,balance,apy,institution) VALUES(?,?,?,?,?)",
            (name, "investment", total, 0, inst),
        )
        imported.append(f"Account: {name} — ${total:,.2f}")

    conn.execute("UPDATE pdf_imports SET status='imported' WHERE id=?", (import_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "imported": imported}


@router.get("/rsus/all")
def list_rsus():
    conn = get_db()
    rows = conn.execute("SELECT * FROM rsu_grants ORDER BY grant_date DESC").fetchall()
    conn.close()
    result = []
    for r in rows:
        d = dict(r)
        d["vesting_schedule"] = json.loads(d["vesting_json"] or "[]")
        result.append(d)
    return result


INCOME_KEYWORDS = frozenset([
    "payroll", "direct dep", "direct deposit", "ach credit", "salary",
    "wages", "gusto", "adp", "paychex", "intuit payroll", "hr direct",
    "compensation", "employer", "pay period",
])

def _normalize_desc(desc: str) -> str:
    """Strip variable tokens (dates, ref IDs, amounts) to get a stable grouping key."""
    s = str(desc).strip().upper()
    s = re.sub(r"\$[\d,]+\.?\d*", "", s)           # dollar amounts
    s = re.sub(r"\b\d{4,}\b", "", s)               # long IDs / card digits
    s = re.sub(r"\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b", "", s)  # inline dates
    s = re.sub(r"\s+", " ", s).strip()
    return s[:50]


def _detect_frequency(dates: list) -> Optional[str]:
    """Infer payment frequency from a list of ISO date strings."""
    parsed = sorted([datetime.strptime(d, "%Y-%m-%d") for d in dates if d])
    if len(parsed) < 2:
        return None
    intervals = [(parsed[i + 1] - parsed[i]).days for i in range(len(parsed) - 1)]
    avg    = sum(intervals) / len(intervals)
    spread = max(intervals) - min(intervals)

    if avg < 4:
        return None
    if 5 <= avg <= 9:
        return "weekly"
    if 12 <= avg <= 17:
        if spread <= 3:
            return "biweekly"         # consistent 14-day cadence
        # Alternating short/long gaps (e.g. 13/17) → semimonthly
        distinct_days = len(set(p.day for p in parsed))
        return "semimonthly" if distinct_days <= 4 else "biweekly"
    if 25 <= avg <= 35:
        return "monthly"
    if 350 <= avg <= 380:
        return "annual"
    return None


def _suggestions_from_txns(transactions: list) -> list:
    """Group transactions into recurring candidates. Returns list of suggestion dicts."""
    groups: dict = defaultdict(list)
    for tx in transactions:
        key = _normalize_desc(str(tx.get("description", "")))
        if key and len(key) >= 3:
            groups[key].append(tx)

    suggestions = []
    for key, txs in groups.items():
        if len(txs) < 2:
            continue
        amounts = [abs(float(tx.get("amount") or 0)) for tx in txs]
        avg    = sum(amounts) / len(amounts)
        spread = max(amounts) - min(amounts)
        if avg < 1 or spread > max(0.05 * avg, 2):
            continue

        dates = [tx.get("date") for tx in txs if tx.get("date")]
        freq  = _detect_frequency(dates) or "monthly"

        raw   = [float(tx.get("amount") or 0) for tx in txs]
        pos   = sum(1 for a in raw if a > 0)
        is_income = pos > len(raw) / 2 or any(kw in key.lower() for kw in INCOME_KEYWORDS)
        kind  = "income" if is_income else "expense"

        suggestions.append({
            "name":        key[:60].title(),
            "kind":        kind,
            "amount":      round(avg, 2),
            "frequency":   freq,
            "occurrences": len(txs),
            "dates":       sorted(d for d in dates if d)[:6],
        })

    suggestions.sort(key=lambda s: (-s["occurrences"], s["name"]))
    return suggestions


def _auto_recurring(conn, transactions: list):
    """Insert high-confidence recurring items discovered in a transaction list."""
    for s in _suggestions_from_txns(transactions):
        existing = conn.execute(
            "SELECT id FROM recurring WHERE name LIKE ? AND active=1", (f"%{s['name'][:20]}%",)
        ).fetchone()
        if not existing:
            conn.execute(
                "INSERT INTO recurring(name,kind,amount,category,frequency) VALUES(?,?,?,?,?)",
                (s["name"], s["kind"], s["amount"], "Auto-detected", s["frequency"]),
            )
