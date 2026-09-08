from fastapi import APIRouter, HTTPException

from services.duckdb_service import (
    get_commits_for_ticket,
    get_pull_requests_for_ticket,
    get_ticket_credits,
    list_tracked_tickets,
)
from services.credit_calculator import jira_validation_summary

router = APIRouter()


def _ticket_summary(ticket_id: str) -> dict:
    commits = get_commits_for_ticket(ticket_id)
    pull_requests = get_pull_requests_for_ticket(ticket_id)
    last_commit_at = commits[-1]["timestamp"] if commits else None  # commits are oldest-first

    return {
        "ticketId": ticket_id,
        "commitCount": len(commits),
        "prCount": len(pull_requests),
        "creditsUsed": get_ticket_credits(ticket_id),
        "jiraValidated": jira_validation_summary(commits),
        "lastCommitAt": last_commit_at,
    }


@router.get("/api/tickets")
async def get_tickets():
    """
    Every ticket scripts/refresh_data.py has ever tracked, with data
    derived ENTIRELY from the local DuckDB/Parquet cache (commit count,
    PR count, credits used, last real commit timestamp) — no Jira fields
    (summary, assignee, status, priority, sprint) at all. Jira isn't
    wired yet (see Step 2 of the integration plan: Atlassian OAuth PKCE,
    blocked on a real client ID); those fields simply don't exist on
    this response's shape rather than being filled with placeholder or
    invented values.

    Data freshness: whenever scripts/refresh_data.py last ran for each
    ticket (see routes/refresh.py) — not live.
    """
    tickets = [_ticket_summary(t) for t in list_tracked_tickets()]
    return {"tickets": tickets}


@router.get("/api/tickets/{ticket_id}")
async def get_ticket(ticket_id: str):
    """
    Same CodeCommit-derived-only summary as GET /api/tickets, for one
    ticket. 404s if ticket_id has never been tracked (i.e.
    scripts/refresh_data.py has never pulled it) — that's a real,
    honest "we don't know this ticket" response, not a 500 or an empty
    fabricated summary.
    """
    if ticket_id not in list_tracked_tickets():
        raise HTTPException(status_code=404, detail=f"Ticket {ticket_id} is not tracked — run scripts/refresh_data.py --ticket {ticket_id} first")

    return _ticket_summary(ticket_id)
