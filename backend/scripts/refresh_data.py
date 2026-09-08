"""
Refreshes the local Parquet cache (data/commits.parquet,
data/pullrequests.parquet) for one or more tickets by pulling real data
straight from the same services the FastAPI routes used to call on every
request (services/codecommit_service.py, services/pullrequests_service.py
— real AWS CodeCommit calls, see those modules' docstrings).

This script is the ONLY thing that talks to CodeCommit now. Once it has
run, routes/commits.py, routes/pullrequests.py and
services/duckdb_service.py read exclusively from these local Parquet
files via DuckDB — no AWS credentials touched per-request.

Both Parquet files hold ALL tracked tickets combined, not one file per
ticket — refreshing a ticket replaces only that ticket's own rows,
leaving every other tracked ticket's rows untouched. data/tracked_tickets.txt
remembers which tickets have ever been refreshed, so a later run with no
--ticket at all (--all) can refresh everything without the caller having
to enumerate tickets by hand — this is how the set of tracked tickets is
meant to grow over time without re-architecting anything.

No webhooks/Lambda auto-trigger yet (deferred to a later phase) — this
is invoked manually or via POST /api/refresh/{ticket_id}
(routes/refresh.py), and freshness is only as good as "whenever this
last ran".

Run from the backend/ directory:
    python3 scripts/refresh_data.py --ticket ANG-123
    python3 scripts/refresh_data.py --ticket ANG-123 --ticket ANG-4571
    python3 scripts/refresh_data.py --all   # every tracked ticket
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

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

DATA_DIR = Path(_BACKEND_DIR) / "data"
COMMITS_FILE = DATA_DIR / "commits.parquet"
PRS_FILE = DATA_DIR / "pullrequests.parquet"
TRACKED_TICKETS_FILE = DATA_DIR / "tracked_tickets.txt"

# Matches services/codecommit_service.py's _normalize_commit() dict keys —
# confirmed against the real Parquet schema (see the DuckDB integration
# writeup), not assumed.
_COMMIT_COLUMNS = [
    "hash", "fullHash", "message", "subject", "author", "authorEmail",
    "timestamp", "kiroTicket", "kiroEpisode", "kiroCredits",
    "kiroConfidence", "kiroSession", "kiroSource", "kiroJiraValidated",
]

# Matches services/pullrequests_service.py's get_pull_request_detail()
# return shape, plus "ticketId" — real CodeCommit PR objects carry no
# ticket-linkage field at all, so this script stamps one on at refresh
# time (it already knows which ticket it was asked to pull); without it
# there'd be no column to filter or merge PR rows by per ticket, the same
# gap "kiroTicket" fills for commits.
_PR_COLUMNS = [
    "ticketId", "id", "title", "description", "status", "sourceBranch",
    "targetBranch", "author", "reviewers", "commitCount", "filesChanged",
    "checks", "kiroCredits", "opened", "codeCommitUrl",
]


def load_tracked_tickets() -> list[str]:
    if not TRACKED_TICKETS_FILE.exists():
        return []
    return [line.strip() for line in TRACKED_TICKETS_FILE.read_text().splitlines() if line.strip()]


def save_tracked_tickets(tickets: list[str]) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    TRACKED_TICKETS_FILE.write_text("\n".join(sorted(set(tickets))) + "\n")


def _merge_and_write(
    path: Path,
    columns: list[str],
    ticket_column: str,
    tickets: list[str],
    new_rows: list[dict],
) -> pd.DataFrame:
    """
    Replace `tickets`' own rows in the Parquet file at `path` with
    `new_rows`, leaving every other ticket's existing rows untouched, then
    write the combined result back. Returns the combined DataFrame.
    """
    new_df = pd.DataFrame(new_rows, columns=columns) if new_rows else pd.DataFrame(columns=columns)

    existing = pd.DataFrame(columns=columns)
    if path.exists():
        existing = pd.read_parquet(path)
        existing = existing[~existing[ticket_column].isin(tickets)]

    # Skip empty frames rather than concat-ing them in — avoids pandas'
    # empty/all-NA concat dtype warning, and matters for real correctness
    # here too: an empty `existing` on the very first run has no real
    # dtypes yet (no file existed to infer them from), so letting it into
    # the concat can coerce columns away from the types the real data
    # actually has.
    frames = [df for df in (existing, new_df) if not df.empty]
    combined = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=columns)
    combined.to_parquet(path, index=False)
    return combined


def refresh(tickets: list[str]) -> None:
    DATA_DIR.mkdir(exist_ok=True)

    all_commits: list[dict] = []
    all_prs: list[dict] = []

    for ticket_id in tickets:
        commits = get_commits_for_ticket(ticket_id)
        prs = get_pull_requests_for_ticket(ticket_id)
        for pr in prs:
            pr["ticketId"] = ticket_id  # see _PR_COLUMNS comment above

        all_commits.extend(commits)
        all_prs.extend(prs)

        print(f"Pulled {len(commits)} real commits for {ticket_id}")
        print(f"Pulled {len(prs)} real pull requests for {ticket_id}")

    # Merge these tickets' fresh rows into the combined files — this
    # replaces ONLY the refreshed tickets' rows; every other tracked
    # ticket's existing rows are carried over untouched.
    combined_commits = _merge_and_write(COMMITS_FILE, _COMMIT_COLUMNS, "kiroTicket", tickets, all_commits)
    combined_prs = _merge_and_write(PRS_FILE, _PR_COLUMNS, "ticketId", tickets, all_prs)

    save_tracked_tickets(load_tracked_tickets() + tickets)

    print(f"Wrote {COMMITS_FILE} ({len(combined_commits)} rows total, {len(all_commits)} refreshed)")
    print(f"Wrote {PRS_FILE} ({len(combined_prs)} rows total, {len(all_prs)} refreshed)")
    print(f"Tracked tickets: {', '.join(load_tracked_tickets())}")
    print(f"Refresh completed at {datetime.now(timezone.utc).isoformat()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--ticket", action="append", dest="tickets", metavar="TICKET_ID",
        help="Ticket to refresh. Repeatable: --ticket ANG-123 --ticket ANG-4571",
    )
    group.add_argument(
        "--all", action="store_true",
        help="Refresh every ticket already in data/tracked_tickets.txt",
    )
    args = parser.parse_args()

    if args.all:
        tracked = load_tracked_tickets()
        if not tracked:
            parser.error("--all was given but data/tracked_tickets.txt has no tickets yet — refresh at least one with --ticket first")
        refresh(tracked)
    else:
        refresh(args.tickets)
