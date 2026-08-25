#!/bin/bash
# Coverage metric: commits with tracking data ÷ total commits, per dev.
# Local-only version — the full design (docs/runbook.md section 2) has this
# as a scheduled AWS job over S3 + git data, per dev across the whole team.
# That doesn't exist yet (no AWS write access — see TODO.md). This is the
# same idea computed locally with plain git, so "is tracking actually
# working" doesn't have to wait for the AWS side to answer.
#
# Why this metric exists at all: a commit with no Kiro-Session trailer
# looks identical whether the dev did the work without Kiro, or the hooks
# silently broke on their machine. A single coverage number across many
# commits tells those two apart — a sudden drop means "tracking broke,"
# not "this dev stopped using Kiro."
#
# Usage: scripts/coverage-report.sh [dev-email] [branch]
#   dev-email defaults to the current git user.email
#   branch    defaults to the current branch

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

DEV="${1:-$(git config user.email)}"
BRANCH="${2:-$(git branch --show-current)}"

TOTAL=$(git log "$BRANCH" --author="$DEV" --oneline | wc -l)
TRACKED=$(git log "$BRANCH" --author="$DEV" --grep="^Kiro-Session:" --oneline | wc -l)

if [ "$TOTAL" -eq 0 ]; then
  echo "No commits found for $DEV on $BRANCH."
  exit 0
fi

PCT=$(awk -v t="$TRACKED" -v tot="$TOTAL" 'BEGIN{printf "%.1f", (t/tot)*100}')

echo "Coverage for $DEV on $BRANCH: $TRACKED/$TOTAL commits tracked (${PCT}%)"
if [ "$TRACKED" -lt "$TOTAL" ]; then
  echo ""
  echo "Untracked commits (no Kiro-Session trailer):"
  git log "$BRANCH" --author="$DEV" --oneline --invert-grep --grep="^Kiro-Session:"
fi
