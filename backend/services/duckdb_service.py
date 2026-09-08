"""
Local-only DuckDB queries against the Parquet files scripts/refresh_data.py
writes (data/commits.parquet, data/pullrequests.parquet).

Both files hold EVERY tracked ticket combined, not one file per ticket —
refresh_data.py merges each ticket's fresh rows in without disturbing any
other ticket's existing rows (see that script). Every function below
still takes a single ticket_id and filters down to just that ticket's
rows via a plain SQL WHERE clause, so this scales to more tracked
tickets over time with no change needed here at all — confirmed by
running two real tickets (ANG-123, ANG-4571) through the same combined
files and checking neither query leaks the other's rows.

No AWS/Jira credentials are imported, read, or referenced anywhere in this
module — it never talks to CodeCommit directly. It only ever reads the
Parquet files on local disk that a prior run of scripts/refresh_data.py
produced. See that script for the real CodeCommit calls.

Column names below (kiroTicket, kiroEpisode, kiroCredits, timestamp, ...)
were confirmed against the real Parquet schema written by refresh_data.py
(`duckdb.sql("DESCRIBE SELECT * FROM read_parquet(...)")` against real
ANG-123 data — see the PR/writeup for that output) — they match
services/codecommit_service.py's _normalize_commit() dict keys exactly,
not any placeholder/example names.

get_ticket_credits() is a direct SQL port of
services/credit_calculator.py's compute_credits_used(): group commits by
kiroEpisode, take the max kiroCredits seen within each episode (episodes
can restart their credit baseline — see that module's docstring), then
sum across episodes. A commit only counts if it has both a real episode
and a real numeric credits value, matching that module's null handling.
"""

from __future__ import annotations

import os

import duckdb
import pandas as pd

_SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_SERVICES_DIR)
_DATA_DIR = os.path.join(_BACKEND_DIR, "data")

COMMITS_PARQUET = os.path.join(_DATA_DIR, "commits.parquet")
PULLREQUESTS_PARQUET = os.path.join(_DATA_DIR, "pullrequests.parquet")
TRACKED_TICKETS_FILE = os.path.join(_DATA_DIR, "tracked_tickets.txt")


def list_tracked_tickets() -> list[str]:
    """
    Every ticket scripts/refresh_data.py has ever been asked to pull —
    i.e. every ticket that may have rows in the combined Parquet files.
    Reads data/tracked_tickets.txt directly (the same file
    refresh_data.py's --all flag reads), not the Parquet files
    themselves, since a ticket can be tracked with zero real commits/PRs
    and still belong in this list.
    """
    if not os.path.exists(TRACKED_TICKETS_FILE):
        return []
    with open(TRACKED_TICKETS_FILE) as f:
        return [line.strip() for line in f if line.strip()]


def get_ticket_credits(ticket_id: str) -> float:
    """
    Total credits for a ticket: MAX(kiroCredits) per kiroEpisode, summed
    across episodes. Mirrors credit_calculator.compute_credits_used()
    exactly (same max-per-episode-then-sum rule, same null exclusions).

    Freshness: reflects data/commits.parquet as of whenever
    scripts/refresh_data.py last ran for this ticket — not live.
    """
    con = duckdb.connect()
    try:
        result = con.execute(
            f"""
            SELECT SUM(episode_max_credits) AS total_credits
            FROM (
                SELECT
                    kiroEpisode,
                    MAX(kiroCredits) AS episode_max_credits
                FROM read_parquet('{COMMITS_PARQUET}')
                WHERE kiroTicket = ?
                  AND kiroEpisode IS NOT NULL
                  AND kiroCredits IS NOT NULL
                GROUP BY kiroEpisode
            )
            """,
            [ticket_id],
        ).fetchone()
    finally:
        con.close()

    total = result[0] if result and result[0] is not None else 0.0
    return round(total * 100) / 100


def get_commits_for_ticket(ticket_id: str) -> list[dict]:
    """
    All commits for a ticket, oldest-first — same ordering
    services/codecommit_service.get_commits_for_ticket() returned (it
    walks newest->oldest from HEAD then reverses).

    Freshness: reflects data/commits.parquet as of whenever
    scripts/refresh_data.py last ran for this ticket — not live.
    """
    con = duckdb.connect()
    try:
        df = con.execute(
            f"""
            SELECT *
            FROM read_parquet('{COMMITS_PARQUET}')
            WHERE kiroTicket = ?
            ORDER BY timestamp ASC
            """,
            [ticket_id],
        ).fetchdf()
    finally:
        con.close()

    # fetchdf() turns SQL NULLs in numeric columns (e.g. kiroCredits) into
    # NaN, not Python None/pandas.NA — round-tripping that straight into a
    # JSON response would emit a non-spec `NaN` token and silently differ
    # from the original CodeCommit-direct route's output (which used real
    # None for a missing Kiro-Credits trailer). Normalize back to None.
    df = df.astype(object).where(pd.notnull(df), None)
    return df.to_dict(orient="records")


def get_pull_requests_for_ticket(ticket_id: str) -> list[dict]:
    """
    All pull requests for a ticket, from data/pullrequests.parquet.

    Real CodeCommit PR objects carry no ticket-linkage field at all
    (confirmed against services/pullrequests_service.py's actual return
    shape) — ticket association only exists because
    scripts/refresh_data.py stamps a "ticketId" column onto each row at
    refresh time (it already knows which ticket it was asked to pull).
    So this filters on that stamped column, not anything CodeCommit
    itself returns.

    Freshness: reflects data/pullrequests.parquet as of whenever
    scripts/refresh_data.py last ran for this ticket specifically — not
    live, and not affected by when any OTHER tracked ticket was last
    refreshed (each ticket's rows are merged in independently).
    """
    con = duckdb.connect()
    try:
        df = con.execute(
            f"""
            SELECT *
            FROM read_parquet('{PULLREQUESTS_PARQUET}')
            WHERE ticketId = ?
            """,
            [ticket_id],
        ).fetchdf()
    finally:
        con.close()

    df = df.astype(object).where(pd.notnull(df), None)  # NaN -> None, see get_commits_for_ticket
    return df.to_dict(orient="records")
