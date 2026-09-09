"""
GET /api/developers — real per-developer usage from S3
(services/s3_usage_service.py), with coverage-percent computed against
real locally-cached CodeCommit commit author emails
(services/duckdb_service.py) where a genuine match exists.

`days` (1, 30, or 90; default 30) selects the real date-filtered
window `creditsUsed` reflects — see s3_usage_service.get_developer_usage()
for exactly how that filtering works. `lifetimeCreditsUsed` is always
the real all-time total regardless of `days`.

coveragePercent/coverageNote/matchedInCommits are still computed for
real here (not removed) even though the Users page currently doesn't
render them — see backend/routes/developers.py's own git history /
the chat writeup for why: as of 2026-09-09 the one repo this
dashboard's local commit cache covers (HCM-ALCS-BE-AIDLC-TEST) has
exactly one distinct commit author email across its entire history,
and it doesn't appear among any real S3 User_Email value, so
coveragePercent comes back null for every developer right now — not
because the matching logic is unfinished, but because there is
genuinely no real email overlap yet between these two real data
sources. Left in place (rather than deleted) so it starts working the
moment either side changes, and so re-adding the column is just a
frontend change, not a re-implementation.
"""

from fastapi import APIRouter, HTTPException

from services import duckdb_service, s3_usage_service

router = APIRouter()

_ALLOWED_DAYS = {1, 30, 90}

_NO_MATCH_NOTE = (
    "No CodeCommit commits found under this email in the locally cached "
    "ticket data. This can mean the developer hasn't committed to a "
    "tracked ticket yet, or that their commits live in a different "
    "CodeCommit repository than the one this dashboard currently tracks "
    "(CODECOMMIT_REPO_NAME in backend/.env) — it does not necessarily "
    "mean they have no real commits anywhere."
)


@router.get("/api/developers")
async def list_developers(days: int = 30):
    if days not in _ALLOWED_DAYS:
        raise HTTPException(status_code=400, detail=f"days must be one of {sorted(_ALLOWED_DAYS)}, got {days}")

    usage = s3_usage_service.get_developer_usage(days=days)
    known_emails = duckdb_service.get_all_commit_author_emails()

    developers = []
    for u in usage:
        email = u["email"]
        matched = email in known_emails

        coverage_percent = None
        coverage_note = _NO_MATCH_NOTE
        if matched:
            stats = duckdb_service.get_commit_confidence_stats_for_email(email)
            if stats["totalCommits"] > 0:
                coverage_percent = round(100 * stats["highConfidenceCommits"] / stats["totalCommits"], 1)
                coverage_note = (
                    f"{stats['highConfidenceCommits']} of {stats['totalCommits']} "
                    "tracked commits have high-confidence Kiro credit attribution."
                )

        developers.append({
            **u,
            "coveragePercent": coverage_percent,
            "coverageNote": coverage_note,
            "matchedInCommits": matched,
        })

    return {"developers": developers, "totalCount": len(developers)}
