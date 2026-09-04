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
  CONFIRMED=$(echo "$MSG" | grep -oP '^Kiro-Confirmed: \K.*' || true)
  JIRA_VALIDATED=$(echo "$MSG" | grep -oP '^Kiro-Jira-Validated: \K.*' || true)
  CLOUD_ID_CONFIRMED=$(echo "$MSG" | grep -oP '^Kiro-CloudId-Confirmed: \K.*' || true)
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
  # docs/kiro-confirmed-persistent-signal-proposal.md, added 2026-09-02
  # — same presence-sentinel pattern as ELAPSED_PRESENT just above,
  # reused rather than reinvented. Kiro-Confirmed is a real boolean
  # (true/false), so "missing" must be tracked separately from either
  # value — the exact class of bug this build's own end-to-end test
  # already caught once, in the jq read that feeds this field (a plain
  # `// empty`-style collapse would treat `false` as "absent" here too).
  if [ -z "$CONFIRMED" ] || [ "$CONFIRMED" = "n/a" ]; then
    CONFIRMED_PRESENT="0"
    CONFIRMED="n/a"
  else
    CONFIRMED_PRESENT="1"
  fi
  # docs/jira-unavailable-hard-stop-proposal.md, added 2026-09-04 (Bug 4)
  # — same presence-sentinel pattern as CONFIRMED_PRESENT just above,
  # reused rather than reinvented. Kiro-Jira-Validated is a real boolean
  # (or 'n/a'), so the same false-vs-missing distinction matters here too.
  if [ -z "$JIRA_VALIDATED" ] || [ "$JIRA_VALIDATED" = "n/a" ]; then
    JIRA_VALIDATED_PRESENT="0"
    JIRA_VALIDATED="n/a"
  else
    JIRA_VALIDATED_PRESENT="1"
  fi
  # docs/cloudid-guess-detectability-proposal.md, added 2026-09-04 (Bug 2)
  # — same presence-sentinel pattern, third reuse.
  if [ -z "$CLOUD_ID_CONFIRMED" ] || [ "$CLOUD_ID_CONFIRMED" = "n/a" ]; then
    CLOUD_ID_CONFIRMED_PRESENT="0"
    CLOUD_ID_CONFIRMED="n/a"
  else
    CLOUD_ID_CONFIRMED_PRESENT="1"
  fi
  echo "$TICKET|$EPISODE|$CREDITS|$ELAPSED|$ELAPSED_PRESENT|$CONFIRMED_PRESENT|$CONFIRMED|$JIRA_VALIDATED_PRESENT|$JIRA_VALIDATED|$CLOUD_ID_CONFIRMED_PRESENT|$CLOUD_ID_CONFIRMED" >> "$TMPFILE"
done

if [ ! -s "$TMPFILE" ]; then
  echo "No commits with usable Kiro-Ticket/Kiro-Credits trailers found in this range."
  exit 0
fi

# Same two-step logic as the dashboard query in docs/runbook.md: max per
# (ticket, episode), then sum across episodes per ticket — applied to
# both credits and elapsed minutes independently, since a stale elapsed
# reading and a stale credits reading aren't the same kind of gap.
# docs/kiro-confirmed-persistent-signal-proposal.md, added 2026-09-02:
# Kiro-Confirmed aggregation is per-TICKET, not per-episode-then-summed
# like credits/elapsed — it's not a cumulative quantity, it's a
# yes/no fact about whether each episode's baseline was ever actually
# confirmed. Kiro-Confirmed is cached once per episode (never
# recomputed on later commits within it), so every commit in the same
# episode carries the identical value — checking "does ANY commit for
# this ticket show false" is exactly equivalent to "does any episode
# for this ticket have an unconfirmed baseline," which is the thing
# worth surfacing. A false anywhere wins over a true anywhere else,
# deliberately — per this whole proposal's own reasoning, a hidden
# unconfirmed episode is worse than a confirmed one looking unremarkable.
awk -F'|' '
{
  key = $1 "|" $2
  if ($3+0 > maxCredits[key]) maxCredits[key] = $3+0
  if ($5+0 == 1) {
    hasElapsed[key] = 1
    if ($4+0 > maxElapsed[key]) maxElapsed[key] = $4+0
  }
  ticket[key] = $1
  if ($6+0 == 1) {
    if ($7 == "false") confirmedFalse[$1] = 1
    if ($7 == "true") confirmedTrue[$1] = 1
  }
  # docs/jira-unavailable-hard-stop-proposal.md, added 2026-09-04 (Bug 4)
  # — same per-ticket "any false wins" aggregation as Kiro-Confirmed just
  # above, same reasoning: a hidden un-validated episode is worse than a
  # validated one looking unremarkable.
  if ($8+0 == 1) {
    if ($9 == "false") jiraValidatedFalse[$1] = 1
    if ($9 == "true") jiraValidatedTrue[$1] = 1
  }
  # docs/cloudid-guess-detectability-proposal.md, added 2026-09-04
  # (Bug 2) — same per-ticket "any false wins" aggregation, third reuse.
  if ($10+0 == 1) {
    if ($11 == "false") cloudIdConfirmedFalse[$1] = 1
    if ($11 == "true") cloudIdConfirmedTrue[$1] = 1
  }
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
      line = sprintf("%s: %.4f credits, %.2f minutes", t, totalCredits[t], totalElapsed[t])
    } else {
      line = sprintf("%s: %.4f credits, n/a minutes", t, totalCredits[t])
    }
    if (t in confirmedFalse) {
      line = line ", UNCONFIRMED baseline (ask may have been skipped)"
    } else if (t in confirmedTrue) {
      line = line ", confirmed"
    } else {
      line = line ", confirmed: n/a"
    }
    if (t in jiraValidatedFalse) {
      line = line ", JIRA VALIDATION SKIPPED (transient failure — ticket existence not actually confirmed for at least one episode)"
    } else if (t in jiraValidatedTrue) {
      line = line ", jira-validated"
    } else {
      line = line ", jira-validated: n/a"
    }
    if (t in cloudIdConfirmedFalse) {
      line = line ", CLOUD ID NOT CONFIRMED (validated without ever calling getAccessibleAtlassianResources for at least one episode — possible guessed cloudId)"
    } else if (t in cloudIdConfirmedTrue) {
      line = line ", cloud-id-confirmed"
    } else {
      line = line ", cloud-id-confirmed: n/a"
    }
    print line
  }
}
' "$TMPFILE" | sort
