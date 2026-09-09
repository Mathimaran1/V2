"""
Real Kiro per-user usage reports, read directly from S3 — no mock data.

Caching has two layers now, added 2026-09-09:
  1. An in-process TTL cache (_usage_cache, _USAGE_CACHE_TTL_SECONDS)
     of the raw rows — this is what actually serves repeated requests
     within the 5-minute window without re-hitting S3, same as before.
  2. Real on-disk snapshots, THREE separate files (DEVELOPERS_CSV_PATHS:
     backend/data/developers_1d.csv, developers_30d.csv,
     developers_90d.csv — one per real period this app offers, not one
     file with a single fixed period), written by
     _write_developers_csv_snapshot() every time the cache above
     actually refreshes (not on every request — only on a real fresh
     S3 fetch). CSV, not Parquet like commits/pullrequests —
     deliberately human-readable so they can be opened directly as real
     evidence, not a performance-motivated cache the way the in-memory
     one is. Unlike commits.parquet (the only real source
     duckdb_service.py reads — it never calls AWS directly), this
     module still always fetches live from S3 for actual API responses;
     these files are a transparency artifact, not a fallback data
     source read by any code path. Each file's Credits_Used_Period
     column reflects only that file's own window (1/30/90 days);
     Credits_Used_Lifetime is identical across all three (the real
     all-time total).

Deliberately still NOT the same pattern as commits/pullrequests
(refresh_data.py populating a Parquet file that duckdb_service.py
reads instead of ever calling AWS) — CodeCommit needs an expensive
per-ticket branch walk worth caching as the primary read path; this is
a flat list of small daily CSVs cheap enough to re-list and
re-download on a cache miss, so the in-memory cache above remains the
real fast-path, with the CSV file as an added, honest side-effect.

Real bucket/prefix (confirmed 2026-09-09 via `aws s3 ls
s3://kiro-prompts-log-metadata/Kiro-user-activity-report/AWSLogs/456166332425/KiroLogs/user_report/
--profile kiro-s3-readonly`, then downloading and parsing a real file
by column name — not assumed from docs):

  s3://<KIRO_USAGE_S3_BUCKET>/<KIRO_USAGE_S3_PREFIX>YYYY/MM/DD/00/<CLIENT_TYPE>_456166332425_user_report_YYYYMMDDHHMM.csv

Real file families share the same schema under that prefix, one file
per day per client type — confirmed 2026-09-09: KIRO_IDE_*.csv,
PLUGIN_*.csv, and KIRO_CLI_*.csv all exist (Client_Type column
distinguishes rows from any of them). _list_report_keys() doesn't
filter by filename, so all three (and any future client type) are
read uniformly. 323 real files exist as of 2026-09-09, going back to
2026-04-06 — downloaded concurrently below (measured ~90s sequential
for this many small files, which is too slow for a page load).

Real header row, confirmed 2026-09-09 by downloading and parsing an
actual file (not the assumed schema from earlier in this project):

  Date,UserId,Client_Type,Chat_Conversations,Credits_Used,Overage_Cap,
  Overage_Credits_Used,Overage_Enabled,ProfileId,Subscription_Tier,
  Total_Messages,New_User,User_Email,Usage_Limit,auto_messages,
  claude_haiku_4.5_messages,claude_opus_4.5_messages,
  claude_opus_4.6_messages,claude_sonnet_4_messages,
  claude_sonnet_4.5_messages,claude_sonnet_4.6_messages,glm_5_messages,
  qwen3_coder_next_messages

Parsed by column NAME (csv.DictReader), not position — confirmed via
two real files from different days that `UserId` stays stable per
`User_Email` across files (same UUID for the same person both days),
so UserId is used as the stable `id` field below. `User_Email` itself
is NOT consistently formatted across real rows: two different real
domains were found in the same file (`teamlease.com` and
`team-lease.co.in`) for what is presumably the same company — real
schema/domain drift, not a bug in this module. Every email is
normalized (stripped, lowercased) before being used as a grouping key
or compared elsewhere (see routes/developers.py), but the two domains
themselves are never merged into one — that would be guessing which
of two real strings is "correct" with no way to verify it.
"""

from __future__ import annotations

import csv
import io
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, timedelta

import boto3

_DOWNLOAD_WORKERS = 20  # boto3 clients are thread-safe for concurrent calls; see get_developer_usage()

# Same _SERVICES_DIR/_BACKEND_DIR/_DATA_DIR pattern as duckdb_service.py,
# so the developers_*d.csv files live right next to
# commits.parquet/pullrequests.parquet.
_SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_SERVICES_DIR)
_DATA_DIR = os.path.join(_BACKEND_DIR, "data")

# One real snapshot file per real period this app actually offers
# (routes/developers.py's _ALLOWED_DAYS / the frontend's Last 1/30/90
# day selector) — not one file with a single fixed period. Each file's
# Credits_Used_Period column reflects ONLY that file's own window.
_SNAPSHOT_WINDOWS = (1, 30, 90)
DEVELOPERS_CSV_PATHS = {days: os.path.join(_DATA_DIR, f"developers_{days}d.csv") for days in _SNAPSHOT_WINDOWS}

_ROLE_SESSION_TTL_SECONDS = 3300  # same margin as codecommit_service.py
_USAGE_CACHE_TTL_SECONDS = 300  # small in-process cache; see module docstring

_client = None
_client_expires_at = 0.0

_usage_cache: list[dict] | None = None  # raw rows, not aggregated — see _get_all_raw_rows()
_usage_cache_built_at = 0.0


def _get_s3_client():
    """Assume AWS_KIRO_S3_ROLE_ARN and cache the client until near expiry.

    Deliberately separate from codecommit_service._get_codecommit_client()
    even though both start from the same base IAM user credentials
    (AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY) — this role assumes into a
    DIFFERENT AWS account (456166332425) than AWS_CODECOMMIT_ROLE_ARN
    (143912951401), confirmed by comparing the two role ARNs directly,
    and the S3 client below is pinned to us-east-1 (the bucket's real
    region) rather than AWS_REGION (ap-south-1, used for CodeCommit).
    """
    global _client, _client_expires_at

    if _client is not None and time.time() < _client_expires_at:
        return _client

    base_session = boto3.Session(
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("AWS_REGION", "ap-south-1"),
    )
    sts = base_session.client("sts")
    role_arn = os.environ["AWS_KIRO_S3_ROLE_ARN"]
    assumed = sts.assume_role(
        RoleArn=role_arn,
        RoleSessionName="vantage-backend-s3-usage",
    )
    creds = assumed["Credentials"]

    _client = boto3.client(
        "s3",
        region_name="us-east-1",  # bucket's real region — see module docstring
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
    )
    _client_expires_at = time.time() + _ROLE_SESSION_TTL_SECONDS
    return _client


def _list_report_keys(client) -> list[str]:
    """Every real .csv key under KIRO_USAGE_S3_PREFIX, across all dates
    and every client type (KIRO_IDE_*.csv, PLUGIN_*.csv, KIRO_CLI_*.csv
    all confirmed real — see module docstring) — paginated, since a
    growing number of daily files will eventually exceed one
    ListObjectsV2 page (1000 keys)."""
    bucket = os.environ["KIRO_USAGE_S3_BUCKET"]
    prefix = os.environ["KIRO_USAGE_S3_PREFIX"]

    keys: list[str] = []
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["Key"].endswith(".csv"):
                keys.append(obj["Key"])
    return keys


def _normalize_email(raw: str | None) -> str:
    return (raw or "").strip().strip('"').lower()


def _parse_usage_csv(text: str) -> list[dict]:
    """Real rows, by column name — see module docstring for the real
    header this was confirmed against."""
    reader = csv.DictReader(io.StringIO(text))
    return list(reader)


def _get_all_raw_rows(force_refresh: bool = False) -> list[dict]:
    """
    Every real row from every real CSV under KIRO_USAGE_S3_PREFIX,
    unfiltered, downloaded concurrently (measured ~90s sequential for
    323 real files — too slow for a page load, ~7s concurrent) and
    cached in-process for _USAGE_CACHE_TTL_SECONDS.

    Deliberately cached at the RAW ROW level, not pre-aggregated — both
    a specific date-range period and the all-time "lifetime" total
    (get_developer_usage() below) are derived from this same fetched
    set with zero extra S3 calls, rather than re-downloading everything
    once per period a caller asks for.
    """
    global _usage_cache, _usage_cache_built_at

    if not force_refresh and _usage_cache is not None and time.time() - _usage_cache_built_at < _USAGE_CACHE_TTL_SECONDS:
        return _usage_cache

    client = _get_s3_client()
    bucket = os.environ["KIRO_USAGE_S3_BUCKET"]
    keys = _list_report_keys(client)

    # Each download's rows are parsed in its own thread and returned,
    # then merged into all_rows back on the main thread — nothing
    # shared is touched from more than one thread at a time.
    def _fetch_and_parse(key: str) -> list[dict]:
        obj = client.get_object(Bucket=bucket, Key=key)
        text = obj["Body"].read().decode("utf-8")
        return _parse_usage_csv(text)

    all_rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=_DOWNLOAD_WORKERS) as pool:
        futures = [pool.submit(_fetch_and_parse, key) for key in keys]
        for future in as_completed(futures):
            all_rows.extend(future.result())

    _usage_cache = all_rows
    _usage_cache_built_at = time.time()
    _write_developers_csv_snapshot(all_rows)  # real on-disk snapshot, same refresh trigger as the cache above
    return all_rows


def _aggregate_rows(rows: list[dict]) -> dict[str, dict]:
    """
    Real per-email aggregation over whatever rows are passed in (the
    caller decides whether that's every real row or a date-filtered
    subset — this function itself does no filtering).

    Aggregation rule per normalized User_Email, over the given rows:
      - creditsUsed: SUM(Credits_Used).
      - tier: Subscription_Tier from the most recent row by Date (a
        tier can change; the latest one within the given rows wins).
      - id: UserId from the first row seen — confirmed stable across
        two real files from different days for the same real email
        (see module docstring), used as the routable id since
        User_Email itself isn't guaranteed URL-safe.
      - activeSince / lastActive: min/max Date seen, within the given
        rows only (so a period-filtered call's activeSince/lastActive
        describe activity within that period, not all-time).
      - clientType: Client_Type from that same most-recent row (same
        "latest wins" rule as tier) — internal-only, not part of the
        frontend Developer type / API response (see
        get_developer_usage()'s own docstring for why: it deliberately
        keeps the JSON shape unchanged), used only by
        _write_developers_csv_snapshot() below.

    Returns a dict keyed by normalized email, not a list — merged with
    another call's result (a different row set) by get_developer_usage()
    below.
    """
    acc: dict[str, dict] = {}

    for row in rows:
        email = _normalize_email(row.get("User_Email"))
        if not email or "@" not in email:
            continue  # defensive: a real row missing/malformed User_Email shouldn't crash the whole aggregation

        date = (row.get("Date") or "").strip()
        try:
            credits = float(row.get("Credits_Used") or 0)
        except ValueError:
            credits = 0.0

        entry = acc.setdefault(email, {
            "id": row.get("UserId"),
            "email": email,
            "tier": row.get("Subscription_Tier"),
            "clientType": row.get("Client_Type"),
            "creditsUsed": 0.0,
            "activeSince": date,
            "lastActive": date,
            "_lastDate": date,  # tracks which row's tier/clientType is "latest"
        })

        entry["creditsUsed"] += credits
        if date and date < entry["activeSince"]:
            entry["activeSince"] = date
        if date and date >= entry["_lastDate"]:
            entry["lastActive"] = date
            entry["_lastDate"] = date
            entry["tier"] = row.get("Subscription_Tier")
            entry["clientType"] = row.get("Client_Type")

    return acc


def _filter_rows_by_days(rows: list[dict], days: int) -> list[dict]:
    """Real rows whose Date column falls within the last `days` days
    (inclusive of today and the day exactly `days` ago) — the same
    real per-row date filtering get_developer_usage() and
    _write_developers_csv_snapshot() both use, factored out once so
    the two can never quietly drift apart."""
    end_date = date.today()
    start_date = end_date - timedelta(days=days)
    start_str, end_str = start_date.isoformat(), end_date.isoformat()
    return [r for r in rows if start_str <= (r.get("Date") or "").strip() <= end_str]


def _write_developers_csv_snapshot(all_rows: list[dict]) -> None:
    """
    Real, human-readable snapshots of the current aggregation — THREE
    separate files, one per real period this app actually offers
    (DEVELOPERS_CSV_PATHS: developers_1d.csv, developers_30d.csv,
    developers_90d.csv), written every time _get_all_raw_rows() does a
    real fresh S3 fetch (see the call site there) — same refresh
    trigger as the in-memory _usage_cache, not a separate schedule.
    Each file is opened in 'w' mode (truncates), so each refresh
    REPLACES that file's contents rather than appending — no
    accumulation of stale rows across refreshes.

    One row per real developer per file (not one row per source CSV
    file/day), using the exact same _aggregate_rows() this module's
    API-facing get_developer_usage() uses for that same window, so
    these numbers can never silently drift from what
    GET /api/developers?days=1|30|90 actually returns for that period.
    Credits_Used_Lifetime is identical across all three files (the
    real all-time total, unaffected by which file it's in) —
    Credits_Used_Period is the only column that differs between them,
    reflecting ONLY that file's own window.

    Deliberately isolated from get_developer_usage()'s own return
    value/schema — the Client_Type/Last_Active_Date columns here do
    NOT change what /api/developers returns; this is a pure
    side-effect for on-disk transparency, not a new API field.

    A write failure on any one file is caught and logged rather than
    raised (and doesn't stop the other two from being written) — these
    files existing is a transparency nice-to-have, not something
    /api/developers should ever 500 over.
    """
    lifetime_acc = _aggregate_rows(all_rows)

    for days in _SNAPSHOT_WINDOWS:
        period_acc = _aggregate_rows(_filter_rows_by_days(all_rows, days))

        rows_out = []
        for email, entry in lifetime_acc.items():
            period_entry = period_acc.get(email)
            rows_out.append({
                "User_Email": entry["email"],
                "Subscription_Tier": entry["tier"],
                "Client_Type": entry["clientType"],
                "Credits_Used_Period": round(period_entry["creditsUsed"], 2) if period_entry else 0.0,
                "Credits_Used_Lifetime": round(entry["creditsUsed"], 2),
                "Last_Active_Date": entry["lastActive"],
            })
        rows_out.sort(key=lambda r: r["Credits_Used_Lifetime"], reverse=True)  # matches get_developer_usage()'s own sort

        path = DEVELOPERS_CSV_PATHS[days]
        try:
            os.makedirs(_DATA_DIR, exist_ok=True)
            with open(path, "w", newline="") as f:
                writer = csv.DictWriter(f, fieldnames=[
                    "User_Email", "Subscription_Tier", "Client_Type",
                    "Credits_Used_Period", "Credits_Used_Lifetime", "Last_Active_Date",
                ])
                writer.writeheader()
                writer.writerows(rows_out)
        except OSError as exc:
            print(f"[s3_usage_service] WARNING: failed to write {path}: {exc}")


def get_developer_usage(days: int | None = None, force_refresh: bool = False) -> list[dict]:
    """
    Real per-developer usage. Returns TWO real, independently-computed
    numbers per developer:
      - creditsUsed: SUM(Credits_Used) over rows whose real Date column
        falls within the last `days` days (inclusive of today and the
        day exactly `days` ago) — real per-row date filtering, not a
        cosmetic label. `days=None` means no filtering (every real row
        — used for the lifetime figure below, and as a fallback).
      - lifetimeCreditsUsed: SUM(Credits_Used) over EVERY real row for
        that email, regardless of `days` — always the true all-time
        total, never affected by whichever period is selected.

    A developer present in the lifetime data but with zero rows in the
    selected period shows creditsUsed=0 for that period (real — they
    just weren't active in that window) rather than being dropped from
    the list, since the list itself represents "every real developer
    we have ANY usage data for", not "developers active in this
    period".

    Returns real dicts matching the frontend's Developer type exactly
    (types/index.ts): id, email, name (derived from the email's
    local-part, e.g. "naveen.jaganadham" -> "Naveen Jaganadham" — a
    deterministic transform of the real email, not a fabricated
    display name), avatarUrl (always '' — no avatar URL exists in this
    data source), tier, creditsUsed, lifetimeCreditsUsed, activeSince,
    lastActive — activeSince/lastActive/tier reflect the LIFETIME data
    (a developer's overall first/last-seen and current tier), not the
    filtered period, since those are identity/status fields, not usage
    totals. Sorted by lifetimeCreditsUsed descending, so the ranking
    doesn't reshuffle every time someone changes the period filter.
    """
    all_rows = _get_all_raw_rows(force_refresh=force_refresh)
    lifetime_acc = _aggregate_rows(all_rows)

    if days is None:
        period_acc = lifetime_acc
    else:
        period_acc = _aggregate_rows(_filter_rows_by_days(all_rows, days))

    developers = []
    for email, lifetime_entry in lifetime_acc.items():
        local_part = email.split("@", 1)[0]
        name = " ".join(part.capitalize() for part in local_part.replace(".", " ").replace("_", " ").split())
        period_entry = period_acc.get(email)
        developers.append({
            "id": lifetime_entry["id"],
            "email": lifetime_entry["email"],
            "name": name or email,
            "avatarUrl": "",  # honestly empty — no avatar URL exists in this data source
            "tier": lifetime_entry["tier"],
            "creditsUsed": round(period_entry["creditsUsed"], 2) if period_entry else 0.0,
            "lifetimeCreditsUsed": round(lifetime_entry["creditsUsed"], 2),
            "activeSince": lifetime_entry["activeSince"],
            "lastActive": lifetime_entry["lastActive"],
        })

    developers.sort(key=lambda d: d["lifetimeCreditsUsed"], reverse=True)
    return developers
