"""
Refreshes the local Parquet cache (data/commits.parquet,
data/pullrequests.parquet) for one ticket by pulling real data straight
from the same services the FastAPI routes used to call on every request
(services/codecommit_service.py, services/pullrequests_service.py — real
AWS CodeCommit calls, see those modules' docstrings).

This script is the ONLY thing that talks to CodeCommit now. Once it has
run, routes/commits.py and services/duckdb_service.py read exclusively
from these local Parquet files via DuckDB — no AWS credentials touched
per-request.

No webhooks/Lambda auto-trigger yet (deferred to a later phase) — this
is invoked manually or via POST /api/refresh/{ticket_id}
(routes/refresh.py), and freshness is only as good as "whenever this
last ran".

Run from the backend/ directory:
    python3 scripts/refresh_data.py --ticket ANG-123
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone

import pandas as pd
from dotenv import load_dotenv

# Make `services.*` importable regardless of cwd — this script is run both
# directly (`python3 scripts/refresh_data.py`, cwd may be backend/ or
# scripts/) and as a subprocess from routes/refresh.py.
_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

load_dotenv(os.path.join(_BACKEND_DIR, ".env"))  # AWS creds must be present before the service modules are used

from services.codecommit_service import get_commits_for_ticket
from services.pullrequests_service import get_pull_requests_for_ticket

DATA_DIR = os.path.join(_BACKEND_DIR, "data")

# Matches the dict shape services/pullrequests_service.py's
# get_pull_request_detail() actually returns (see that module), plus a
# "ticketId" column this script adds itself (below) — real PR objects
# from CodeCommit carry no ticket linkage field at all, so without it
# duckdb_service.get_pull_requests_for_ticket() would have no column to
# filter on. Included so an empty PR result still writes a parquet file
# with the real column names/types instead of zero columns.
_PR_COLUMNS = [
    "ticketId", "id", "title", "description", "status", "sourceBranch",
    "targetBranch", "author", "reviewers", "commitCount", "filesChanged",
    "checks", "kiroCredits", "opened", "codeCommitUrl",
]

_COMMIT_COLUMNS = [
    "hash", "fullHash", "message", "subject", "author", "authorEmail",
    "timestamp", "kiroTicket", "kiroEpisode", "kiroCredits",
    "kiroConfidence", "kiroSession", "kiroSource", "kiroJiraValidated",
]


def refresh(ticket_id: str) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)

    commits = get_commits_for_ticket(ticket_id)
    prs = get_pull_requests_for_ticket(ticket_id)
    for pr in prs:
        pr["ticketId"] = ticket_id  # CodeCommit PRs carry no ticket field; record it ourselves

    commits_df = pd.DataFrame(commits, columns=_COMMIT_COLUMNS) if commits else pd.DataFrame(columns=_COMMIT_COLUMNS)
    prs_df = pd.DataFrame(prs, columns=_PR_COLUMNS) if prs else pd.DataFrame(columns=_PR_COLUMNS)

    commits_path = os.path.join(DATA_DIR, "commits.parquet")
    prs_path = os.path.join(DATA_DIR, "pullrequests.parquet")

    commits_df.to_parquet(commits_path, index=False)
    prs_df.to_parquet(prs_path, index=False)

    print(f"Pulled {len(commits)} real commits for {ticket_id}")
    print(f"Pulled {len(prs)} real pull requests for {ticket_id}")
    print(f"Wrote {commits_path} ({len(commits_df)} rows)")
    print(f"Wrote {prs_path} ({len(prs_df)} rows)")
    print(f"Refresh completed at {datetime.now(timezone.utc).isoformat()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--ticket", required=True)
    args = parser.parse_args()
    refresh(args.ticket)
