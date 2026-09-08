from fastapi import APIRouter
import subprocess
import sys
import os

router = APIRouter()

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REFRESH_SCRIPT = os.path.join(_BACKEND_DIR, "scripts", "refresh_data.py")


def _run_refresh(*script_args: str) -> dict:
    result = subprocess.run(
        [sys.executable, _REFRESH_SCRIPT, *script_args],
        capture_output=True, text=True, cwd=_BACKEND_DIR,
    )
    return {
        "success": result.returncode == 0,
        "output": result.stdout,
        "error": result.stderr if result.returncode != 0 else None,
    }


@router.post("/api/refresh/{ticket_id}")
async def refresh_ticket(ticket_id: str):
    """
    Re-runs scripts/refresh_data.py for ticket_id: real AWS CodeCommit
    calls (via services/codecommit_service.py and
    services/pullrequests_service.py), merging that ticket's current
    commits/PRs into the combined data/commits.parquet and
    data/pullrequests.parquet files — those files hold every tracked
    ticket, so this replaces only ticket_id's own rows and leaves every
    other ticket's rows untouched (see scripts/refresh_data.py). ticket_id
    is also added to data/tracked_tickets.txt if it wasn't already there,
    so a later POST /api/refresh (no ticket_id) will include it too.

    This is the only way the DuckDB-backed routes (GET /api/commits/{id},
    GET /api/pullrequests/{id}) pick up new commits/PRs — there is no
    automatic background refresh yet (no webhooks/Lambda; deferred to a
    later phase). Data freshness for those routes is exactly "whenever
    this endpoint (or the script directly) last ran for that ticket" — an
    explicit, honest trade-off for this phase, not a bug.
    """
    result = _run_refresh("--ticket", ticket_id)
    return {"ticketId": ticket_id, **result}


@router.post("/api/refresh")
async def refresh_all_tracked():
    """
    Re-runs scripts/refresh_data.py --all: refreshes every ticket already
    in data/tracked_tickets.txt (every ticket ever refreshed via
    POST /api/refresh/{ticket_id} or the script's --ticket flag), in one
    combined merge into data/commits.parquet / data/pullrequests.parquet.

    This is how the whole tracked set stays current as more tickets get
    added over time, without the caller having to enumerate them — e.g.
    a periodic cron/manual run of just this one endpoint. Fails with a
    real script error (success: false) if no ticket has ever been
    tracked yet — there's nothing to refresh.
    """
    result = _run_refresh("--all")
    return result
