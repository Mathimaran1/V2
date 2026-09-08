from fastapi import APIRouter, HTTPException

from services.duckdb_service import get_pull_requests_for_ticket

router = APIRouter()


@router.get("/api/pullrequests/{ticket_id}")
async def get_pull_requests(ticket_id: str):
    """
    Served from the local DuckDB/Parquet cache (services/duckdb_service.py),
    NOT a live AWS CodeCommit call — PRs whose title follows this repo's
    "TICKET: subject" convention (filtered at refresh time by
    services/pullrequests_service.py's get_pull_requests_for_ticket()).

    Confirmed 2026-09-05: this repo has ZERO pull requests (open or
    closed) in reality — so a real, honest response for any ticket right
    now is an empty list, not an error. See services/pullrequests_service.py
    for what is/isn't verified against real PR data.

    Data freshness: whenever scripts/refresh_data.py last ran for this
    ticket (manually, or via POST /api/refresh/{ticket_id} — see
    routes/refresh.py). There is no automatic background refresh yet
    (webhooks/Lambda are deferred to a later phase) — this is an explicit,
    honest trade-off for this phase, not a bug.
    """
    try:
        pull_requests = get_pull_requests_for_ticket(ticket_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"ticketId": ticket_id, "pullRequests": pull_requests}
