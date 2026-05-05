# Minicountant

A self-hosted personal finance dashboard. All data stays on your machine — no cloud accounts, no subscriptions, no telemetry.

> **⚠ Disclaimer:** This software is for informational and organizational purposes only. It is **not** financial, investment, legal, or tax advice. The contributors are not liable for any financial losses or decisions made based on this software. See [DISCLAIMER.md](DISCLAIMER.md) for the full disclaimer. Consult a licensed financial professional before making financial decisions.

![Screenshot of the dashboard showing net worth, income, expenses, and advisor recommendations]

## Features

- **Dashboard** — net worth snapshot, monthly income vs. outflow, cash flow, savings rate, emergency fund coverage, debt-to-income ratio, goals progress, and advisor recommendations
- **Household Budget** — Bogleheads-style two-adult budget calculator with category guidelines (housing ≤28%, transport ≤15%, savings ≥20%), Bogleheads investment priority checklist, auto-save to backend, and a live summary card on the dashboard
- **Accounts** — track checking, savings, investment, and other accounts
- **Recurring Income & Expenses** — model your monthly cash flow; auto-detect recurring patterns from imported transactions
- **Loans** — amortization schedules, interest remaining, and a debt payoff calculator (avalanche / snowball) that models paying off debt with RSU proceeds
- **Goals** — savings goals with progress bars and template suggestions (emergency fund, FIRE number, individual loan payoffs)
- **RSU Grants** — vesting schedule tracking, upcoming vest calendar, live price quotes via Alpha Vantage, after-tax value estimates
- **PDF & CSV Ingest** — drop in a bank statement, credit card statement, brokerage statement, or equity awards CSV to auto-import accounts and transactions
- **SimpleFIN** — connect your bank via [SimpleFIN Bridge](https://www.simplefin.org/) for automatic balance and transaction sync
- **Transactions** — searchable, filterable transaction history

## Tech Stack

| Layer    | Technology |
|----------|-----------|
| Backend  | Python · FastAPI · SQLite |
| Frontend | Vanilla JS · HTML · CSS (no frameworks, no build step) |
| Storage  | Single SQLite file at `~/.wealth/wealth.db` |

## Quick Start

**Requirements:** Python 3.10+

```bash
# 1. Clone
git clone https://github.com/aneangel/minicountant.git
cd minicountant
# 2. Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Run
./run.sh                        # or: uvicorn main:app --host 127.0.0.1 --port 8765 --reload
```

Open [http://localhost:8765](http://localhost:8765) in your browser.

The SQLite database is created automatically at `~/.wealth/wealth.db` on first run. No migrations or setup scripts needed.

## Configuration

All configuration is stored in the database `config` table — no config files or environment variables required for basic use.

### Optional: Live RSU price quotes

To enable live stock price fetching (used by the RSU page), get a free API key from [Alpha Vantage](https://www.alphavantage.co/support/#api-key) and add it through the RSU page UI, or set it directly:

```bash
sqlite3 ~/.wealth/wealth.db "INSERT OR REPLACE INTO config(key,value) VALUES('alphavantage_key','YOUR_KEY_HERE');"
```

### Optional: SimpleFIN bank connection

[SimpleFIN Bridge](https://www.simplefin.org/) lets you pull real bank balances and transactions. Sign up, generate a setup token, and paste it on the SimpleFIN page in the app.

## Project Structure

```
wealth/
├── main.py                  # FastAPI app entry point
├── database.py              # SQLite schema + migrations
├── run.sh                   # Dev server launcher
├── requirements.txt
├── routers/
│   ├── accounts.py          # Account CRUD
│   ├── budget.py            # Budget persistence (save/load)
│   ├── dashboard.py         # Aggregated dashboard metrics
│   ├── goals.py             # Goal CRUD + templates
│   ├── ingest.py            # PDF/CSV parsing and import
│   ├── loans.py             # Loan CRUD + amortization
│   ├── recurring.py         # Recurring income/expense CRUD
│   ├── rsus.py              # RSU grant CRUD + equity summary
│   ├── simplefin.py         # SimpleFIN bank sync
│   └── transactions.py      # Transaction search + edit
├── static/
│   ├── app.js               # All frontend logic (single file, no build)
│   └── style.css            # Early-2000s plain-web aesthetic
└── templates/
    └── index.html           # Single-page app shell
```

## Data & Privacy

- **Everything is local.** The SQLite database lives at `~/.wealth/wealth.db` on your machine.
- The only outbound network calls are:
  - Alpha Vantage (stock quotes) — only when you click "Refresh Price" or configure a key
  - SimpleFIN Bridge — only when you explicitly connect and sync
- No analytics, no tracking, no third-party scripts.

## Recurring Income Categories

The dashboard separates income into **primary** (marked `category = "primary"` in the recurring table) and supplemental. When you add a recurring income item, set its category to `primary` to have it drive the main cash-flow and savings-rate metrics.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
