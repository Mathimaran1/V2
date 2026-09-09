"""
Vantage backend — FastAPI app matching vite.config.ts's proxy target
(http://localhost:8000). Routes are added incrementally; see the chat
writeup for which are real vs. not-yet-configured.
"""

from dotenv import load_dotenv

load_dotenv()  # must run before any service module reads os.environ

from fastapi import FastAPI

from routes import commits, developers, jira, pullrequests, refresh, tickets

app = FastAPI(title="Vantage backend")

app.include_router(tickets.router)
app.include_router(commits.router)
app.include_router(pullrequests.router)
app.include_router(refresh.router)
app.include_router(jira.router)
app.include_router(developers.router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}
