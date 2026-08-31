#!/bin/bash
# Calculate total Kiro credits for a PR, correctly: max per episode, then
# sum across episodes per ticket (see TODO.md — episodes can restart their
# baseline, so credits_used_so_far is cumulative WITHIN an episode, not
# incremental across the whole PR).
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

# Collect (ticket, episode, credits, elapsed_minutes) per commit,
# skipping any commit with no Kiro-Ticket trailer at all (predates this
# hook, or hooks were bypassed — scripts/coverage-report.sh is the tool
# for finding those, this script is just about totaling what IS
# tracked).
#
# Elapsed-minutes column, added 2026-08-28 — same field, same pattern as
# credits: Kiro-Elapsed-Minutes is cumulative WITHIN one episode (fixed
# start, recalculated per commit — see pre-commit and commit-msg), so it
# gets the identical max-per-episode-then-sum treatment below, not a
# direct sum. Deliberately NOT filtered the same way credits is: a
# commit with valid Kiro-Ticket/Kiro-Credits but no elapsed data (any
# commit made before this field existed) must still count fully toward
# the credits total — only its own contribution to the elapsed total is
# skipped. "4" (no valid elapsed data anywhere for a key) is used as a
# presence sentinel below, distinct from a genuine "0.00 minutes"
# reading, so totals can honestly report "n/a" instead of a misleading 0.
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
  ELAPSED=$(echo "$MSG" | grep -oP '^Kiro-Elapsed-Minutes: \K.*' || true)
  if [ -z "$TICKET" ] || [ "$CREDITS" = "n/a" ] || [ -z "$CREDITS" ]; then
    continue
  fi
  # Not a filter on the commit itself — just a presence flag column so
  # awk below can tell "no elapsed data for this commit" apart from a
  # real "0.00".
  if [ -z "$ELAPSED" ] || [ "$ELAPSED" = "n/a" ]; then
    ELAPSED_PRESENT="0"
    ELAPSED="0"
  else
    ELAPSED_PRESENT="1"
  fi
  echo "$TICKET|$EPISODE|$CREDITS|$ELAPSED|$ELAPSED_PRESENT" >> "$TMPFILE"
done

if [ ! -s "$TMPFILE" ]; then
  echo "No commits with usable Kiro-Ticket/Kiro-Credits trailers found in this range."
  exit 0
fi

# Same two-step logic as the dashboard query in docs/runbook.md: max per
# (ticket, episode), then sum across episodes per ticket — applied to
# both credits and elapsed minutes independently, since a stale elapsed
# reading and a stale credits reading aren't the same kind of gap.
awk -F'|' '
{
  key = $1 "|" $2
  if ($3+0 > maxCredits[key]) maxCredits[key] = $3+0
  if ($5+0 == 1) {
    hasElapsed[key] = 1
    if ($4+0 > maxElapsed[key]) maxElapsed[key] = $4+0
  }
  ticket[key] = $1
}
END {
  for (k in maxCredits) {
    t = ticket[k]
    totalCredits[t] += maxCredits[k]
    if (k in hasElapsed) {
      totalElapsed[t] += maxElapsed[k]
      tickerHasElapsed[t] = 1
    }
    seen[t] = 1
  }
  for (t in seen) {
    if (t in tickerHasElapsed) {
      printf "%s: %.4f credits, %.2f minutes\n", t, totalCredits[t], totalElapsed[t]
    } else {
      printf "%s: %.4f credits, n/a minutes\n", t, totalCredits[t]
    }
  }
}
' "$TMPFILE" | sort
