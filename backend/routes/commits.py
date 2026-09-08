from fastapi import APIRouter, HTTPException

from services.duckdb_service import get_commits_for_ticket, get_ticket_credits
from services.credit_calculator import jira_validation_summary

router = APIRouter()


@router.get("/api/commits/{ticket_id}")
async def get_commits(ticket_id: str):
    """
    Served from the local DuckDB/Parquet cache (services/duckdb_service.py),
    NOT a live AWS CodeCommit call — every commit whose Kiro-Ticket trailer
    matches ticket_id, plus the ticket's total credits computed in SQL via
    the same max-per-episode-then-sum rule as
    services/credit_calculator.py (a straight port of the frontend's
    computeCreditsUsed(); both are proven to agree — see the DuckDB
    integration writeup).

    Data freshness: whenever scripts/refresh_data.py last ran for this
    ticket (manually, or via POST /api/refresh/{ticket_id} — see
    routes/refresh.py). There is no automatic background refresh yet
    (webhooks/Lambda are deferred to a later phase) — this is an explicit,
    honest trade-off for this phase, not a bug. If refresh_data.py has
    never run for this ticket, this returns an empty commit list rather
    than an error.
    """
    try:
        commits = get_commits_for_ticket(ticket_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    total = get_ticket_credits(ticket_id)
    jira_validated = jira_validation_summary(commits)

    return {
        "ticketId": ticket_id,
        "commits": commits,
        "totalCredits": total,
        "jiraValidated": jira_validated,
    }
