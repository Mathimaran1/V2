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

# Collect (ticket, episode, credits) per commit, skipping any commit with
# no Kiro-Ticket trailer at all (predates this hook, or hooks were
# bypassed — scripts/coverage-report.sh is the tool for finding those,
# this script is just about totaling what IS tracked).
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
  if [ -z "$TICKET" ] || [ "$CREDITS" = "n/a" ] || [ -z "$CREDITS" ]; then
    continue
  fi
  echo "$TICKET|$EPISODE|$CREDITS" >> "$TMPFILE"
done

if [ ! -s "$TMPFILE" ]; then
  echo "No commits with usable Kiro-Ticket/Kiro-Credits trailers found in this range."
  exit 0
fi

# Same two-step logic as the dashboard query in docs/runbook.md: max per
# (ticket, episode), then sum across episodes per ticket.
awk -F'|' '
{
  key = $1 "|" $2
  if ($3+0 > max[key]) max[key] = $3+0
  ticket[key] = $1
}
END {
  for (k in max) {
    total[ticket[k]] += max[k]
  }
  for (t in total) {
    printf "%s: %.4f credits\n", t, total[t]
  }
}
' "$TMPFILE" | sort
