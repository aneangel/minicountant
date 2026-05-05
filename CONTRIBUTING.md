# Contributing

Thanks for your interest in contributing.

## Getting Started

```bash
git clone https://github.com/aneangel/minicountant.git
cd minicountant
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8765 --reload
```

The `--reload` flag restarts the server on Python file changes. Frontend changes (JS/CSS/HTML) are picked up immediately on browser refresh with no restart needed.

## Architecture

The app is intentionally simple:

- **One Python file per router** in `routers/`. Each router is a self-contained FastAPI `APIRouter` with its own models and DB queries — no ORM, just `sqlite3`.
- **One JS file** (`static/app.js`). All frontend logic lives here. No bundler, no framework — just plain functions and the `api()` helper which wraps `fetch`. Page navigation is handled by toggling a CSS `active` class.
- **Schema changes** go in `database.py`. Use the `_migrate()` function pattern for idempotent `ALTER TABLE` migrations so existing databases upgrade in place without data loss.

## Adding a Feature

**New backend route:**
1. Add a new router file in `routers/` or extend an existing one.
2. Register it in `main.py` with `app.include_router(...)`.
3. If you need a new table, add it to `init_db()` in `database.py`. If you're adding columns to an existing table, add an idempotent migration to `_migrate()`.

**New frontend page:**
1. Add a `<div class="page" id="page-yourname">` block in `templates/index.html`.
2. Add a nav link: `<a href="#" data-page="yourname">Label</a>`.
3. Add a `yourname: loadYourName` entry to the `loaders` object in `static/app.js`.
4. Implement `async function loadYourName()` in `app.js`.

## Guidelines

- **No build step.** Keep the frontend as plain HTML/CSS/JS. Don't introduce npm, webpack, TypeScript, or frontend frameworks.
- **No ORM.** Use raw `sqlite3` queries. Keep queries close to where they're used.
- **No breaking schema changes.** Add columns with defaults or use `_migrate()`. Never drop or rename columns.
- **Privacy first.** Don't add any analytics, telemetry, or calls to external services without explicit user configuration and action.
- **Keep it local.** The tool should work fully offline except for optional integrations (Alpha Vantage, SimpleFIN) that are user-configured.

## Reporting Issues

Open a GitHub issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Your Python version and OS
