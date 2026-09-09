"""
Real AWS CodeCommit access for HCM-ALCS-BE-AIDLC-TEST, across every
branch in the repo (not just one hardcoded branch) — see
_all_branch_head_commit_ids().

Confirmed 2026-09-05, live against the real repo:
  - The base IAM user in AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY has NO
    codecommit:* permissions at all (AccessDeniedException on GetBranch).
  - Assuming AWS_CODECOMMIT_ROLE_ARN via STS DOES have GetBranch/GetCommit
    access. So every call here goes through that assumed role, not the
    base user directly.

CodeCommit's API has no "git log" equivalent — there's GetBranch (head
commit id) and GetCommit (one commit + its parents), so history is
walked manually by following `parents` back from the branch head.

Trailer parsing deliberately does NOT use the naive
`grep -oP '^Kiro-X: \\K.*'` approach scripts/calculate-pr-credits.sh
uses — that script's own comments document a known bug where it matches
ANY line starting with a trailer name anywhere in the body, not just the
real trailing trailer block (see commit fb8c2f0). This parser instead
finds the message's last blank-line-delimited block and only reads
trailers from there, which is immune to that class of bug.
"""

from __future__ import annotations

import os
import re
import time

import boto3

_ROLE_SESSION_TTL_SECONDS = 3300  # refresh a bit before the 1hr STS default expiry
_TRAILER_LINE_RE = re.compile(r"^([A-Za-z][A-Za-z0-9-]*):\s(.*)$")

_client = None
_client_expires_at = 0.0


def _get_codecommit_client():
    """Assume AWS_CODECOMMIT_ROLE_ARN and cache the client until near expiry."""
    global _client, _client_expires_at

    if _client is not None and time.time() < _client_expires_at:
        return _client

    base_session = boto3.Session(
        aws_access_key_id=os.environ["AWS_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["AWS_SECRET_ACCESS_KEY"],
        region_name=os.environ.get("AWS_REGION", "ap-south-1"),
    )
    sts = base_session.client("sts")
    role_arn = os.environ["AWS_CODECOMMIT_ROLE_ARN"]
    assumed = sts.assume_role(
        RoleArn=role_arn,
        RoleSessionName="vantage-backend-codecommit",
    )
    creds = assumed["Credentials"]

    _client = boto3.client(
        "codecommit",
        region_name=os.environ.get("AWS_REGION", "ap-south-1"),
        aws_access_key_id=creds["AccessKeyId"],
        aws_secret_access_key=creds["SecretAccessKey"],
        aws_session_token=creds["SessionToken"],
    )
    _client_expires_at = time.time() + _ROLE_SESSION_TTL_SECONDS
    return _client


def _parse_trailers(message: str) -> dict[str, str]:
    """Return only the trailers in the message's final trailer block."""
    lines = message.rstrip("\n").split("\n")

    # Walk back from the end while lines look like trailers; stop at the
    # first blank line or first non-trailer-shaped line above them.
    block_start = len(lines)
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i]
        if line.strip() == "":
            break
        if not _TRAILER_LINE_RE.match(line):
            break
        block_start = i
    else:
        block_start = 0

    trailers: dict[str, str] = {}
    for line in lines[block_start:]:
        m = _TRAILER_LINE_RE.match(line)
        if m:
            trailers[m.group(1)] = m.group(2)
    return trailers


def _subject_line(message: str) -> str:
    return message.split("\n", 1)[0].strip()


def _strip_ticket_prefix(subject: str, ticket_id: str) -> str:
    prefix = f"{ticket_id}: "
    if subject.startswith(prefix):
        return subject[len(prefix):]
    return subject


def _normalize_commit(raw: dict, ticket_id: str) -> dict | None:
    """
    raw: one CodeCommit GetCommit 'commit' object.
    Returns a normalized dict if this commit's Kiro-Ticket trailer matches
    ticket_id, else None.
    """
    message = raw["message"]
    trailers = _parse_trailers(message)

    if trailers.get("Kiro-Ticket") != ticket_id:
        return None

    def none_if(value: str | None, sentinel: str) -> str | None:
        if value is None or value == sentinel:
            return None
        return value

    episode = none_if(trailers.get("Kiro-Episode"), "none")

    credits_raw = none_if(trailers.get("Kiro-Credits"), "n/a")
    credits = float(credits_raw) if credits_raw is not None else None

    validated_raw = trailers.get("Kiro-Jira-Validated")
    if validated_raw == "true":
        jira_validated = True
    elif validated_raw == "false":
        jira_validated = False
    else:
        jira_validated = None  # missing or "n/a"

    full_hash = raw["commitId"]
    return {
        "hash": full_hash[:7],
        "fullHash": full_hash,
        "message": _strip_ticket_prefix(_subject_line(message), ticket_id),
        "subject": _subject_line(message),
        "author": raw["author"]["name"],
        "authorEmail": raw["author"]["email"],
        "timestamp": raw["author"]["date"],
        "kiroTicket": trailers.get("Kiro-Ticket"),
        "kiroEpisode": episode,
        "kiroCredits": credits,
        "kiroConfidence": trailers.get("Kiro-Confidence"),
        "kiroSession": trailers.get("Kiro-Session"),
        "kiroSource": trailers.get("Kiro-Source"),
        "kiroJiraValidated": jira_validated,
    }


def _all_branch_head_commit_ids(client, repo: str) -> list[str]:
    """
    Every branch's current HEAD commit id, so history-walking below covers
    the entire repo instead of a single hardcoded branch — a ticket's
    commits may land on any branch (e.g. v2 vs. v1-import), and CodeCommit
    has no single "all commits" API, only per-branch heads to walk back
    from.
    """
    branch_names = client.list_branches(repositoryName=repo)["branches"]
    head_ids = []
    for name in branch_names:
        resp = client.get_branch(repositoryName=repo, branchName=name)
        head_ids.append(resp["branch"]["commitId"])
    return head_ids


def get_commits_for_ticket(ticket_id: str, max_commits_walked: int = 500) -> list[dict]:
    """
    Real CodeCommit call: walk history from every branch's HEAD via
    ListBranches + GetBranch + repeated GetCommit (following `parents`),
    collecting every commit whose Kiro-Ticket trailer equals ticket_id.
    Commits reachable from more than one branch are only visited/counted
    once (shared `seen` set below).

    Returns commits oldest-first (matches reading a ticket's work in the
    order it happened).
    """
    client = _get_codecommit_client()
    repo = os.environ["CODECOMMIT_REPO_NAME"]

    matched: list[dict] = []
    seen: set[str] = set()
    frontier = _all_branch_head_commit_ids(client, repo)
    walked = 0

    while frontier and walked < max_commits_walked:
        commit_id = frontier.pop(0)
        if commit_id in seen:
            continue
        seen.add(commit_id)
        walked += 1

        resp = client.get_commit(repositoryName=repo, commitId=commit_id)
        raw = resp["commit"]

        normalized = _normalize_commit(raw, ticket_id)
        if normalized is not None:
            matched.append(normalized)

        frontier.extend(raw.get("parents", []))

    matched.reverse()  # walked newest -> oldest; flip to oldest-first
    return matched
