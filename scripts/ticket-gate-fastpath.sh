#!/bin/bash
# Deterministic fast-path for the empty-ticket gate (CASE A2) — sits in
# front of .kiro/hooks/aidlc-ask-for-ticket-if-missing.json's agent hook,
# which still owns the full flow. Added 2026-08-31 after confirming live
# that a plain "hi" with no ticket set cost 0.51 credits: a full agent
# turn, including a live atlassian-rovo MCP call, just to read two local
# files and ask a static question.
#
# Kiro DOES support a non-agent "command" action type (kiro.dev/docs/hooks/)
# — this repo's earlier internal note claiming Kiro only supports
# agent-type hooks was wrong. That claim was based on a differently-shaped,
# unrelated failed draft (when/then/promptSubmitted/agentAction), not on
# actually checking Kiro's docs for a command type.
#
# This script covers ONLY the cheap, no-judgment case: ticket_id is empty
# AND the message is not a candidate answer (not ticket-ID-shaped, not
# 'none'). That's most messages while ticket_id is unset. Per Kiro's docs,
# exiting 2 blocks the prompt for UserPromptSubmit and its stderr is what
# surfaces back — zero agent tokens spent for this branch.
#
# Deliberately conservative about what it does NOT handle — all of these
# still need the real agent hook's judgment, so this script exits 0 (lets
# the prompt through untouched, no message shown) whenever any apply:
#   - .kiro/pending-ticket-check.json exists (needs live Jira validation)
#   - .kiro/pending-baseline-confirm.json exists — the agent hook is
#     mid "please refresh your credits, then say ready" exchange and is
#     waiting on THIS reply (see the MARKER FILE rule in
#     aidlc-ask-for-ticket-if-missing.json). Added 2026-08-31 after a
#     live bug: without this check, a plain "done"/"ready" confirmation
#     reply got misread as a fresh unanswered empty-ticket message and
#     this script re-asked the ticket question instead of letting the
#     confirmation through.
#   - current-ticket.json's ticket_id is already set (CASE C needs
#     judgment this script can't make — e.g. "is this ticket ID a passing
#     mention or a real switch")
#   - the message IS a candidate answer (ticket-ID shape, or 'none') —
#     still needs Jira validation + the credit-baseline capture flow
#
# NOT YET LIVE-VERIFIED (inferred from kiro.dev's docs, not observed
# running): the exact stdin JSON shape read below, whether exit 2's
# stderr is shown to the user verbatim or paraphrased by another agent
# pass, and whether a blocked command hook suppresses the sibling agent
# hook on the same trigger (if it doesn't, this script's exit 2 may not
# actually prevent the agent hook's own turn from also running — test
# this specifically). Verify all of this against a real Kiro session
# before trusting it in production.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# Read the UserPromptSubmit stdin payload via python3 — same tool this
# repo already relies on elsewhere (see current-ticket.json's baseline
# capture) since jq isn't confirmed installed on every machine and
# python3 is. Docs give the shape as
# {"hook_event_name": "userPromptSubmit", "cwd": ..., "session_id": ...,
# "prompt": "..."} — only "prompt" is used here.
PROMPT=$(python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('prompt', ''))
except Exception:
    print('')
")

TICKET_ID=""
if [ -f .kiro/current-ticket.json ]; then
  TICKET_ID=$(python3 -c "
import json
try:
    with open('.kiro/current-ticket.json') as f:
        data = json.load(f)
    print(data.get('ticket_id', '') or '')
except Exception:
    print('')
")
fi

# --- Pre-switch commit gate (docs/pre-switch-commit-proposal.md, added
# 2026-09-01). Answers, by construction, the open capability question
# that used to have its own isolated test block right here (removed now
# that this block is a stronger, live proof of the same thing): a
# command hook CAN write files that persist (confirmed by the removed
# test) and CAN run `git commit` for real (this block), since both are
# just subprocess calls this script already makes.
#
# Closes a confirmed gap: a mid-conversation ticket switch (CASE C1 in
# aidlc-ask-for-ticket-if-missing.json) overwrites episode_id with a
# fresh one for the new ticket, and if the OLD episode never made it
# into a commit's Kiro-Episode trailer, its credit usage is gone with
# no record anywhere. Gate on pending_switch_to being set (written by
# CASE C2 on a prior turn) rather than on judging whether THIS message
# confirms the switch — that judgment call is deliberately left to the
# agent hook everywhere else in this script (see FUZZY_TICKET_MATCH
# below); worst case here is one harmless extra empty commit if the
# switch ends up declined.
if [ -n "$TICKET_ID" ]; then
  PENDING_SWITCH_TO=$(python3 -c "
import json
try:
    with open('.kiro/current-ticket.json') as f:
        data = json.load(f)
    print(data.get('pending_switch_to', '') or '')
except Exception:
    print('')
")
  EPISODE_ID=$(python3 -c "
import json
try:
    with open('.kiro/current-ticket.json') as f:
        data = json.load(f)
    print(data.get('episode_id', '') or '')
except Exception:
    print('')
")
  if [ -n "$PENDING_SWITCH_TO" ] && [ -n "$EPISODE_ID" ]; then
    if ! git log --format='%(trailers:key=Kiro-Episode,valueonly)' \
        | grep -qxF "$EPISODE_ID"; then
      # KIRO_AGENT_COMMIT=1 — same flag the agent's own chat-confirmed
      # commits already use — is required here, not optional: it
      # deterministically skips pre-commit's refresh-click ask and
      # post-commit's switch-question ask, both of which are
      # TTY-dependent and would otherwise either hang up to 5 minutes
      # (see aidlc-git-conventions.md's two documented TTY-detection
      # bugs — a subprocess having a TTY attached is not proof a human
      # is watching it) or dump an unanswerable question into nothing.
      # --allow-empty: nothing needs to be staged, only pre-commit's
      # own trailer-stamping matters here.
      if ! KIRO_AGENT_COMMIT=1 git commit --allow-empty \
          -m "$TICKET_ID: capture episode $EPISODE_ID credits before switching to $PENDING_SWITCH_TO" \
          >/tmp/pre-switch-commit.log 2>&1; then
        echo "A switch to $PENDING_SWITCH_TO is pending, but the automatic bookkeeping commit for the current episode ($EPISODE_ID) failed — see /tmp/pre-switch-commit.log. Do not confirm the switch yet; resolve this first (a real commit, or ask the user how to proceed)." >&2
        exit 2
      fi
    fi
  fi
fi

# Ticket already set, a pending Jira validation is in flight, or the
# agent hook is mid-way through a "refresh credits, then confirm" wait —
# all three need the real agent hook. Let the prompt through untouched.
if [ -n "$TICKET_ID" ] || [ -f .kiro/pending-ticket-check.json ] || [ -f .kiro/pending-baseline-confirm.json ]; then
  exit 0
fi

# Ticket is empty. Is this message itself a candidate answer?
if echo "$PROMPT" | grep -qE '^[A-Z][A-Z0-9]*-[0-9]+$' || [ "$PROMPT" = "none" ]; then
  exit 0  # exact match — needs Jira validation, hand off to agent hook
fi

# Not an exact match — but does it become one after normalizing away
# whitespace and case (e.g. "ANG - 123" or "ang-123")? Added 2026-08-31,
# confirmed live: a real user typed "ANG - 123" and got re-asked the
# question because the strict regex doesn't allow spaces around the
# hyphen — same behavior the plain agent hook already had before this
# fast-path existed, just now visible sooner. Pass fuzzy matches through
# too (still needs Jira validation either way), but flag it as fuzzy via
# stdout context so the agent knows NOT to silently assume the
# normalized form is correct — it must confirm with the user first (see
# CASE A1's fuzzy-match instruction in aidlc-ask-for-ticket-if-missing.json).
# Only collapse whitespace immediately around a hyphen, plus trim outer
# whitespace — NOT all internal whitespace. Stripping every space would
# silently merge unrelated leading words into a fake match (confirmed:
# "no ang-4571" incorrectly normalized to "NOANG-4571", which matches the
# pattern even though it obviously isn't a ticket ID — see TODO.md).
NORMALIZED=$(echo "$PROMPT" \
  | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/[[:space:]]*-[[:space:]]*/-/' \
  | tr '[:lower:]' '[:upper:]')
if echo "$NORMALIZED" | grep -qE '^[A-Z][A-Z0-9]*-[0-9]+$'; then
  # exit 0 → stdout (not stderr) is what Kiro adds to the agent's
  # context, per kiro.dev/docs/hooks/actions/ — stderr is only read on
  # a non-zero exit, which this isn't.
  echo "FUZZY_TICKET_MATCH: raw message \"$PROMPT\" normalizes to $NORMALIZED after removing whitespace/case — not an exact match, confirm with the user before treating this as their answer."
  exit 0
fi

# No ticket, and this message isn't answering the question even loosely
# — block cheaply, zero agent involvement.
echo "Which Jira ticket are you working on (a real ticket ID, or explicitly 'none' for work with no ticket)?" >&2
exit 2
