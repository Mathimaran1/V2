from fastapi import APIRouter
import subprocess
import sys
import os

router = APIRouter()

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_REFRESH_SCRIPT = os.path.join(_BACKEND_DIR, "scripts", "refresh_data.py")


@router.post("/api/refresh/{ticket_id}")
async def refresh_ticket(ticket_id: str):
    """
    Re-runs scripts/refresh_data.py for ticket_id: real AWS CodeCommit
    calls (via services/codecommit_service.py and
    services/pullrequests_service.py), overwriting data/commits.parquet
    and data/pullrequests.parquet with that ticket's current data.

    This is the only way the DuckDB-backed routes (GET /api/commits/{id},
    GET /api/pullrequests/{id}) pick up new commits/PRs — there is no
    automatic background refresh yet (no webhooks/Lambda; deferred to a
    later phase). Data freshness for those routes is exactly "whenever
    this endpoint (or the script directly) last ran" — an explicit,
    honest trade-off for this phase, not a bug.
    """
    result = subprocess.run(
        [sys.executable, _REFRESH_SCRIPT, "--ticket", ticket_id],
        capture_output=True, text=True, cwd=_BACKEND_DIR,
    )
    return {
        "ticketId": ticket_id,
        "success": result.returncode == 0,
        "output": result.stdout,
        "error": result.stderr if result.returncode != 0 else None,
    }
