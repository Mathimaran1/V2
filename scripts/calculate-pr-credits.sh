#!/bin/bash
# Calculate total Kiro credits for a PR, correctly: max per episode, then
# sum across episodes per ticket (see TODO.md — episodes can restart their
# baseline, so credits_used_so_far is cumulative WITHIN an episode, not
# incremental across the whole PR).
#
# KNOWN ISSUE (found 2026-09-04, not fixed — see TODO.md for the full
# git-history audit): this script's trailer extraction (the `grep -oP
# '^Kiro-X: \K.*'` calls below) matches ANY line in a commit message
# that starts with a trailer name, not only the real trailing trailer
# block commit-msg actually writes. Commit fb8c2f0 (2026-08-27) has a
# fully duplicated 6-field trailer block and produces a phantom
# `0.0000`-credit ticket line in this script's output whenever a
# --range includes it — real ticket totals are unaffected (the genuine
# ANG-124 line's own numbers are still correct), but a full-history run
# will show one spurious extra row. The same class of bug was caught
# and fixed live twice more, in real commits, on 2026-09-04 (a
# hand-typed trailer-shaped line, and separately a wrapped prose line
# that happened to start with a trailer name) — neither of those is
# still present in history, only fb8c2f0 is. Not rewritten — this
# project does not rewrite git history without being explicitly asked.
# A real fix would parse only the message's final trailer block (e.g.
# by locating the blank line immediately before the first `Kiro-*:`
# line from the end of the message) rather than grepping the whole
# body; flagged here as a known, real limitation, not silently patched.
#
# Built against local git + gh, not AWS CodeCommit: this account's
# CodeCommit access is blocked entirely (see README.md), and no git
# remote is configured on this repo at all yet, so an aws codecommit
# get-commit version would have been unverifiable — see TODO.md for the
# full reasoning. Trailers now live in the commit message itself
# (Kiro-Ticket, Kiro-Episode, Kiro-Credits — see commit-msg), which git
# already reads natively, no AWS permissions of any kind needed.
#
# Usage:
#   calculate-pr-credits.sh --repo <owner/repo> --pr <number>
#     Resolves the PR's commits via `gh pr view` (needs gh auth + a real
#     PR — not yet tested end-to-end, this repo has no remote/PRs to
#     test against; the trailer-parsing and aggregation logic below IS
#     tested, via --range, against this repo's own real history).
#   calculate-pr-credits.sh --range <base>..<head>
#     Same logic, against a local branch/commit range instead of a real
#     PR — no gh or network needed, works right now.

set -euo pipefail

usage() {
  echo "Usage:" >&2
  echo "  $0 --repo <owner/repo> --pr <number>" >&2
  echo "  $0 --range <base>..<head>" >&2
  exit 1
}

REPO=""
PR=""
RANGE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --pr) PR="$2"; shift 2 ;;
    --range) RANGE="$2"; shift 2 ;;
    *) usage ;;
  esac
done

if [ -n "$RANGE" ]; then
  SHAS=$(git log --format=%H "$RANGE")
elif [ -n "$REPO" ] && [ -n "$PR" ]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "❌ gh CLI not found — required for --repo/--pr mode." >&2
    exit 1
  fi
  SHAS=$(gh pr view "$PR" --repo "$REPO" --json commits --jq '.commits[].oid' 2>&1) || {
    echo "❌ gh pr view failed: $SHAS" >&2
    exit 1
  }
else
  usage
fi

if [ -z "$SHAS" ]; then
  echo "No commits found."
  exit 0
fi

# Collect (ticket, episode, credits) per commit, skipping any commit
# with no Kiro-Ticket trailer at all (predates this hook, or hooks were
# bypassed — scripts/coverage-report.sh is the tool for finding those,
# this script is just about totaling what IS tracked).
#
# Kiro-Elapsed-Minutes, Kiro-Confirmed and Kiro-CloudId-Confirmed were
# removed from the commit-msg trailer block (2026-09-05 — this project
# stopped tracking elapsed time and the ask/cloudId confirmation
# signals), so their extraction/aggregation was removed here too rather
# than left reading a trailer that no longer exists (which would have
# silently degraded every ticket's line to "n/a" instead of erroring).
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT

for sha in $SHAS; do
  MSG=$(git log -1 --format=%B "$sha" 2>/dev/null) || {
    echo "⚠️  Skipping $sha — not found locally (fetch it first if using --repo/--pr against a remote)." >&2
    continue
  }
  TICKET=$(echo "$MSG" | grep -oP '^Kiro-Ticket: \K.*' || true)
  EPISODE=$(echo "$MSG" | grep -oP '^Kiro-Episode: \K.*' || true)
  CREDITS=$(echo "$MSG" | grep -oP '^Kiro-Credits: \K.*' || true)
  JIRA_VALIDATED=$(echo "$MSG" | grep -oP '^Kiro-Jira-Validated: \K.*' || true)
  if [ -z "$TICKET" ] || [ "$CREDITS" = "n/a" ] || [ -z "$CREDITS" ]; then
    continue
  fi
  # docs/jira-unavailable-hard-stop-proposal.md, added 2026-09-04 (Bug 4)
  # — presence-sentinel pattern: Kiro-Jira-Validated is a real boolean
  # (or 'n/a'), so "missing" must be tracked separately from either
  # value (a plain `// empty`-style collapse would treat `false` as
  # "absent" too).
  if [ -z "$JIRA_VALIDATED" ] || [ "$JIRA_VALIDATED" = "n/a" ]; then
    JIRA_VALIDATED_PRESENT="0"
    JIRA_VALIDATED="n/a"
  else
    JIRA_VALIDATED_PRESENT="1"
  fi
  echo "$TICKET|$EPISODE|$CREDITS|$JIRA_VALIDATED_PRESENT|$JIRA_VALIDATED" >> "$TMPFILE"
done

if [ ! -s "$TMPFILE" ]; then
  echo "No commits with usable Kiro-Ticket/Kiro-Credits trailers found in this range."
  exit 0
fi

# Same two-step logic as the dashboard query in docs/runbook.md: max per
# (ticket, episode), then sum across episodes per ticket.
# docs/jira-unavailable-hard-stop-proposal.md, added 2026-09-04 (Bug 4):
# Kiro-Jira-Validated aggregation is per-TICKET, not per-episode-then-
# summed like credits — it's not a cumulative quantity, it's a yes/no
# fact about whether each episode's ticket existence was ever actually
# validated against Jira. It's cached once per episode (never
# recomputed on later commits within it), so every commit in the same
# episode carries the identical value — checking "does ANY commit for
# this ticket show false" is exactly equivalent to "does any episode
# for this ticket have an unvalidated ticket," which is the thing worth
# surfacing. A false anywhere wins over a true anywhere else,
# deliberately — a hidden un-validated episode is worse than a
# validated one looking unremarkable.
awk -F'|' '
{
  key = $1 "|" $2
  if ($3+0 > maxCredits[key]) maxCredits[key] = $3+0
  ticket[key] = $1
  if ($4+0 == 1) {
    if ($5 == "false") jiraValidatedFalse[$1] = 1
    if ($5 == "true") jiraValidatedTrue[$1] = 1
  }
}
END {
  for (k in maxCredits) {
    t = ticket[k]
    totalCredits[t] += maxCredits[k]
    seen[t] = 1
  }
  for (t in seen) {
    line = sprintf("%s: %.4f credits", t, totalCredits[t])
    if (t in jiraValidatedFalse) {
      line = line ", JIRA VALIDATION SKIPPED (transient failure — ticket existence not actually confirmed for at least one episode)"
    } else if (t in jiraValidatedTrue) {
      line = line ", jira-validated"
    } else {
      line = line ", jira-validated: n/a"
    }
    print line
  }
}
' "$TMPFILE" | sort
