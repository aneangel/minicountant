from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path
from database import init_db
from routers import accounts, recurring, loans, goals, dashboard, simplefin, ingest, rsus, transactions, budget

app = FastAPI(title="Wealth Manager")

init_db()

app.include_router(accounts.router)
app.include_router(recurring.router)
app.include_router(loans.router)
app.include_router(goals.router)
app.include_router(dashboard.router)
app.include_router(simplefin.router)
app.include_router(ingest.router)
app.include_router(rsus.router)
app.include_router(transactions.router)
app.include_router(budget.router)

app.mount("/static", StaticFiles(directory=Path(__file__).parent / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(Path(__file__).parent / "templates" / "index.html")
