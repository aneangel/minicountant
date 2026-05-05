import sqlite3
from pathlib import Path

DB_PATH = Path.home() / ".wealth" / "wealth.db"


def get_db():
    DB_PATH.parent.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _migrate(conn):
    """Run idempotent schema migrations."""
    # rsu_grants: add new columns if missing
    rsu_cols = {row[1] for row in conn.execute("PRAGMA table_info(rsu_grants)").fetchall()}
    for col, defn in [
        ("broker",           "TEXT"),
        ("federal_tax_rate", "REAL DEFAULT 22.0"),
        ("current_price",    "REAL"),
        ("active",           "INTEGER NOT NULL DEFAULT 1"),
    ]:
        if col not in rsu_cols:
            conn.execute(f"ALTER TABLE rsu_grants ADD COLUMN {col} {defn}")
    conn.commit()

    cols = {row[1] for row in conn.execute("PRAGMA table_info(recurring)").fetchall()}

    # Migration: add active flag + fix frequency CHECK (which blocked 'semimonthly')
    if "active" not in cols or _recurring_blocks_semimonthly(conn):
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS recurring_new (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                name      TEXT NOT NULL,
                kind      TEXT NOT NULL CHECK(kind IN ('income','expense')),
                amount    REAL NOT NULL,
                category  TEXT,
                frequency TEXT NOT NULL DEFAULT 'monthly',
                notes     TEXT,
                active    INTEGER NOT NULL DEFAULT 1
            );
            INSERT OR IGNORE INTO recurring_new(id,name,kind,amount,category,frequency,notes,active)
                SELECT id, name, kind, amount, category, frequency, notes, 1
                FROM recurring;
            DROP TABLE recurring;
            ALTER TABLE recurring_new RENAME TO recurring;
        """)
        conn.commit()


def _recurring_blocks_semimonthly(conn) -> bool:
    try:
        conn.execute("SAVEPOINT smtest")
        conn.execute(
            "INSERT INTO recurring(name,kind,amount,frequency) VALUES('__smtest__','expense',0,'semimonthly')"
        )
        conn.execute("DELETE FROM recurring WHERE name='__smtest__'")
        conn.execute("RELEASE SAVEPOINT smtest")
        return False
    except Exception:
        try:
            conn.execute("ROLLBACK TO SAVEPOINT smtest")
            conn.execute("RELEASE SAVEPOINT smtest")
        except Exception:
            pass
        return True


def init_db():
    conn = get_db()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('checking','savings','investment','other')),
            balance REAL NOT NULL DEFAULT 0,
            apy REAL NOT NULL DEFAULT 0,
            institution TEXT,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS recurring (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            name      TEXT NOT NULL,
            kind      TEXT NOT NULL CHECK(kind IN ('income','expense')),
            amount    REAL NOT NULL,
            category  TEXT,
            frequency TEXT NOT NULL DEFAULT 'monthly',
            notes     TEXT,
            active    INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS loans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            balance REAL NOT NULL,
            original_balance REAL NOT NULL,
            rate REAL NOT NULL,
            term_months INTEGER NOT NULL,
            start_date TEXT NOT NULL,
            monthly_payment REAL,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS goals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            target REAL NOT NULL,
            current REAL NOT NULL DEFAULT 0,
            target_date TEXT,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS config (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS simplefin_accounts (
            sfin_id TEXT PRIMARY KEY,
            org_name TEXT,
            raw_name TEXT NOT NULL,
            currency TEXT DEFAULT 'USD',
            balance REAL,
            balance_date INTEGER,
            linked_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
            ignored INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS transactions (
            id TEXT PRIMARY KEY,
            sfin_account_id TEXT NOT NULL,
            posted INTEGER NOT NULL,
            amount REAL NOT NULL,
            description TEXT,
            memo TEXT,
            pending INTEGER DEFAULT 0
        );
    """)
    conn.commit()
    _migrate(conn)
    conn.close()
