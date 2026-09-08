"""
Real AWS CodeCommit Pull Request access for HCM-ALCS-BE-AIDLC-TEST.

Confirmed 2026-09-05, live against the real repo:
  - ListPullRequests (OPEN and CLOSED both queried) returns ZERO pull
    requests, open or closed. This repo has never had one. That is a
    real, honest result, not a bug — see the route/report writeup.

Because there is no real PR in this repo to test against, only
list_pull_requests_for_repo() below is proven against real (empty)
data end-to-end. get_pull_request_detail()'s field mapping (reviewers,
diff stats, credits) is written against CodeCommit's real, documented
API shapes and reused, already-verified logic (credit_calculator,
_parse_trailers) wherever possible, but is NOT verified against a real
merged/open PR — flagged here and in the route's docstring rather than
silently presented as tested.

CodeCommit has no built-in concept of CI "checks" (no CodeBuild/
CodePipeline status is exposed through this API) — there is no real
data source for the frontend's PullRequest.checks field, so it is
always returned empty rather than invented.
"""

from __future__ import annotations

import os

from services.codecommit_service import _get_codecommit_client, _normalize_commit, _parse_trailers
from services.credit_calculator import compute_credits_used


def _branch_name(ref: str) -> str:
    return ref[len("refs/heads/"):] if ref.startswith("refs/heads/") else ref


def list_pull_requests_for_repo() -> list[str]:
    """Real call: every PR id in the repo, OPEN and CLOSED, deduped."""
    client = _get_codecommit_client()
    repo = os.environ["CODECOMMIT_REPO_NAME"]

    ids: set[str] = set()
    for status in ("OPEN", "CLOSED"):
        resp = client.list_pull_requests(repositoryName=repo, pullRequestStatus=status)
        ids.update(resp.get("pullRequestIds", []))
    return sorted(ids)


def _walk_commits_between(client, repo: str, tip_commit_id: str, base_commit_id: str, max_walked: int = 200) -> list[dict]:
    """Raw CodeCommit commits reachable from tip_commit_id, stopping at base_commit_id."""
    raws: list[dict] = []
    seen: set[str] = set()
    frontier = [tip_commit_id]
    walked = 0

    while frontier and walked < max_walked:
        commit_id = frontier.pop(0)
        if commit_id in seen or commit_id == base_commit_id:
            continue
        seen.add(commit_id)
        walked += 1
        resp = client.get_commit(repositoryName=repo, commitId=commit_id)
        raw = resp["commit"]
        raws.append(raw)
        frontier.extend(raw.get("parents", []))
    return raws


def get_pull_request_detail(pr_id: str) -> dict:
    """
    Real call: GetPullRequest + GetPullRequestApprovalStates + GetDifferences,
    mapped into the frontend's PullRequest shape. Credits are computed by
    walking the PR's real commits (source -> merge base) through the same
    trailer parser and max-per-episode-then-sum logic as the commits route.
    """
    client = _get_codecommit_client()
    repo = os.environ["CODECOMMIT_REPO_NAME"]

    pr = client.get_pull_request(pullRequestId=pr_id)["pullRequest"]
    target = pr["pullRequestTargets"][0]  # this repo only ever has one target

    source_commit = target["sourceCommit"]
    destination_commit = target["destinationCommit"]
    merge_base = target.get("mergeBase", destination_commit)
    merge_metadata = target.get("mergeMetadata", {})
    is_merged = merge_metadata.get("isMerged", False)

    if pr["pullRequestStatus"] == "OPEN":
        status = "open"
    elif is_merged:
        status = "merged"
    else:
        status = "closed"

    # Reviewers/approvals — real API, but no real PR exists yet to confirm
    # the exact revisionId CodeCommit expects here in practice.
    try:
        approvals = client.get_pull_request_approval_states(
            pullRequestId=pr_id, revisionId=pr["revisionId"],
        )
        reviewers = [
            {"approver": a["userArn"], "status": a["approvalState"]}
            for a in approvals.get("approvals", [])
        ]
    except Exception:
        reviewers = []

    try:
        diffs = client.get_differences(
            repositoryName=repo,
            beforeCommitSpecifier=destination_commit,
            afterCommitSpecifier=source_commit,
        )
        files_changed = len(diffs.get("differences", []))
    except Exception:
        files_changed = None

    commits_raw = _walk_commits_between(client, repo, source_commit, merge_base)
    ticket = None
    for raw in commits_raw:
        # infer ticket from the PR's own commits' Kiro-Ticket trailer,
        # same convention the commits route already trusts
        t = _parse_trailers(raw["message"]).get("Kiro-Ticket")
        if t:
            ticket = t
            break

    normalized_commits = []
    if ticket:
        for raw in commits_raw:
            n = _normalize_commit(raw, ticket)
            if n:
                normalized_commits.append(n)
    credits = compute_credits_used(normalized_commits) if normalized_commits else None

    return {
        "id": pr_id,
        "title": pr["title"],
        "description": pr.get("description", ""),
        "status": status,
        "sourceBranch": _branch_name(target["sourceReference"]),
        "targetBranch": _branch_name(target["destinationReference"]),
        "author": pr["authorArn"],
        "reviewers": reviewers,
        "commitCount": len(commits_raw),
        "filesChanged": files_changed,
        "checks": [],  # CodeCommit has no native CI-check concept — no real source for this
        "kiroCredits": credits,
        "opened": pr["creationDate"].isoformat() if hasattr(pr["creationDate"], "isoformat") else str(pr["creationDate"]),
        "codeCommitUrl": (
            f"https://{os.environ.get('AWS_REGION', 'ap-south-1')}.console.aws.amazon.com/"
            f"codesuite/codecommit/repositories/{repo}/pull-requests/{pr_id}"
        ),
    }


def get_pull_requests_for_ticket(ticket_id: str) -> list[dict]:
    """
    Filters the repo's real PR list to ones whose title matches this
    project's established "TICKET: subject" convention (same prefix
    commits already use — confirmed via the commits route). Unverified
    against a real PR since none currently exist in this repo.
    """
    matched = []
    for pr_id in list_pull_requests_for_repo():
        detail = get_pull_request_detail(pr_id)
        if detail["title"].startswith(f"{ticket_id}: ") or detail["title"] == ticket_id:
            matched.append(detail)
    return matched
