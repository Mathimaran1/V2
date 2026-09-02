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
    # --- Uncommitted-work gate (added 2026-09-01, ANG-4571; narrowed
    # 2026-09-02, docs/uncommitted-work-gate-narrowing-proposal.md). A
    # ticket switch overwrites current-ticket.json with a fresh episode
    # — any uncommitted user work done under the OLD ticket would end
    # up committed under the NEW ticket's episode if the user forgets
    # to commit first. NOT a whole-repo dirtiness check anymore —
    # confirmed live 2026-09-01: this project's own normal workflow
    # leaves the repo dirty almost continuously (surgical staging,
    # deliberately-separate pending work), so a plain `git status
    # --porcelain` check would have blocked nearly every switch.
    # Compare against dirty_snapshot_at_episode_start (captured at the
    # same instant as this episode's credit baseline, below) — only
    # lines NOT present at episode start count as genuinely new work.
    # This fires on EVERY turn where pending_switch_to is set, not
    # just the confirming turn — same "gate on pending, not on
    # judgment" rationale as the pre-switch commit gate below.
    NEW_DIRTY=$(python3 -c "
import json, subprocess
try:
    with open('.kiro/current-ticket.json') as f:
        data = json.load(f)
    baseline = set(data.get('dirty_snapshot_at_episode_start', []) or [])
except Exception:
    baseline = set()
current = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout.splitlines()
print('\n'.join(l for l in current if l not in baseline))
")
    if [ -n "$NEW_DIRTY" ]; then
      echo "You have uncommitted changes (new since this episode began) — please commit or stash your work on $TICKET_ID before switching to $PENDING_SWITCH_TO. This ensures your current work gets tracked under the right ticket." >&2
      echo "" >&2
      echo "New dirty files:" >&2
      echo "$NEW_DIRTY" >&2
      mkdir -p .kiro-tracking
      echo "hook_status=uncommitted-work-gate-blocked ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) site=fastpath-c1" >> .kiro-tracking/hook-health.log
      exit 2
    fi

    # docs/pre-switch-gate-sigpipe-proposal.md, added 2026-09-01: capture
    # git log's output FIRST, then check it via a here-string — NOT a
    # live pipe into `grep -q`. Confirmed live, reproduced 55/55 times:
    # a live `git log | grep -qxF` here caused the real double-commit
    # bug (9e9a602/7916316) — grep -q exits the instant it finds the
    # target trailer (always near the top, since it's the trailer this
    # gate itself just committed), closing the pipe while git log is
    # still writing the rest of history, triggering a real SIGPIPE in
    # git log (confirmed via PIPESTATUS: git log exits 141, grep exits
    # 0). Under `pipefail` (set at the top of this file), that reports
    # the whole pipeline as failed even though grep succeeded, so the
    # `if !` below wrongly read "found" as "not found" every time and
    # committed again. A here-string has no second process on the other
    # end to receive a SIGPIPE — git log fully completes via command
    # substitution before grep ever runs.
    LOG_TRAILERS=$(git log --format='%(trailers:key=Kiro-Episode,valueonly)')
    if ! grep -qxF "$EPISODE_ID" <<< "$LOG_TRAILERS"; then
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

# --- Option A1 (docs/deterministic-bookkeeping-proposal.md, added
# 2026-09-01): don't rely on the agent to fetch and correctly weigh
# current-ticket.json's actual content against its own priors — feed
# the real value directly into context, unconditionally, the same
# proven exit-0-stdout mechanism FUZZY_TICKET_MATCH already uses below.
# Confirmed live 2026-09-01: a fresh session's first message, with
# ticket_id genuinely set to a real ticket, still got answered as if it
# were empty — the agent's own Read File call happened but its content
# got overridden by a "new session -> probably nothing tracked" prior.
# This closes that gap by not requiring the agent to go fetch the fact
# at all; it's just already sitting in context before reasoning starts.
if [ -n "$TICKET_ID" ]; then
  # docs/session-start-greeting-exception-proposal.md, added 2026-09-02:
  # hygiene only, not required for correctness (the expiry check on the
  # marker itself already prevents any incorrect firing on its own) —
  # a ticket is now set, so any leftover session-start greeting marker
  # is superseded; remove it here rather than leaving it to sit in
  # .kiro/ indefinitely on the common path where the expiry-check block
  # further down is never reached again to clean it up itself.
  rm -f .kiro/pending-session-greeting.json

  # docs/kiro-confirmed-persistent-signal-proposal.md, added 2026-09-02:
  # compute Kiro-Confirmed / Kiro-Confirmed-Gap-Seconds once per episode,
  # cached (never recomputed once set — the "'ask_confirmed_gap_seconds'
  # not in data" guard below). Uses the candidate-detection log, NOT the
  # pending-baseline-confirm.json marker's own lifecycle — confirmed live
  # 2026-09-02 that marker cleanup is agent-prose behavior and produced
  # opposite outcomes across two confirmed occurrences of the identical
  # underlying failure, making it unusable as the signal. The detection
  # log is agent-invisible — only this script ever reads or writes it —
  # so it can't be affected by agent behavior the same way.
  python3 -c "
import json
from datetime import datetime

CTJ = '.kiro/current-ticket.json'
try:
    with open(CTJ) as f:
        data = json.load(f)
except Exception:
    data = None

if data is not None and 'ask_confirmed_gap_seconds' not in data:
    tid = data.get('ticket_id', '')
    started_at = data.get('episode_started_at', '')
    gap = None
    started_dt = None
    if tid and started_at:
        try:
            started_dt = datetime.strptime(started_at, '%Y-%m-%dT%H:%M:%SZ')
        except Exception:
            started_dt = None
    if started_dt is not None:
        best = None
        try:
            with open('.kiro/candidate-detection-log.jsonl') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except Exception:
                        continue
                    if entry.get('ticket_id') != tid:
                        continue
                    try:
                        edt = datetime.strptime(entry.get('detected_at', ''), '%Y-%m-%dT%H:%M:%SZ')
                    except Exception:
                        continue
                    if edt <= started_dt and (best is None or edt > best):
                        best = edt
        except Exception:
            pass
        if best is not None:
            gap = (started_dt - best).total_seconds()
    if gap is not None:
        data['ask_confirmed_gap_seconds'] = gap
        # PROVISIONAL threshold — not yet calibrated against real
        # occurrences, see docs/kiro-confirmed-persistent-signal-proposal.md.
        THRESHOLD_SECONDS = 15
        data['ask_confirmed'] = gap >= THRESHOLD_SECONDS
    else:
        data['ask_confirmed_gap_seconds'] = None
        data['ask_confirmed'] = None
    with open(CTJ, 'w') as f:
        json.dump(data, f)
"

  # --- Early dirty-files gate for C2 detection turn (added 2026-09-01,
  # ANG-4571, second pass — closes the gap the first pass missed).
  # The existing dirty-files check above only fires when pending_switch_to
  # is already set (the C1 confirmation turn). But on the C2 detection
  # turn — the user's message mentions a different ticket for the first
  # time — pending_switch_to hasn't been written yet, so that check
  # never fires. The agent hook's behavioral instruction to run
  # `git status --porcelain` at C2 was confirmed skipped in live
  # testing. This code-enforced check catches it deterministically:
  # extract ticket IDs from the prompt, check if any differ from
  # TICKET_ID, and if so + dirty files exist, block with exit 2.
  # Deliberately conservative: only blocks, doesn't judge whether the
  # mention is "a real switch intent" — that's still the agent's job.
  # Worst case: a passing reference to another ticket in a dirty tree
  # gets blocked unnecessarily; the user just re-sends after committing
  # or rephrasing.
  PROMPT_TICKETS=$(echo "$PROMPT" | grep -oE '\b[A-Z][A-Z0-9]*-[0-9]+\b' || true)
  if [ -n "$PROMPT_TICKETS" ]; then
    HAS_DIFFERENT_TICKET=""
    for T in $PROMPT_TICKETS; do
      if [ "$T" != "$TICKET_ID" ]; then
        HAS_DIFFERENT_TICKET="$T"
        break
      fi
    done
    if [ -n "$HAS_DIFFERENT_TICKET" ]; then
      # Narrowed 2026-09-02, docs/uncommitted-work-gate-narrowing-proposal.md
      # — same per-episode baseline comparison as the C1 check above, not
      # whole-repo dirtiness. current-ticket.json still reflects the OLD
      # (current) episode here, since pending_switch_to hasn't been
      # written yet at this point in the flow — its
      # dirty_snapshot_at_episode_start is the right baseline to compare
      # against.
      NEW_DIRTY=$(python3 -c "
import json, subprocess
try:
    with open('.kiro/current-ticket.json') as f:
        data = json.load(f)
    baseline = set(data.get('dirty_snapshot_at_episode_start', []) or [])
except Exception:
    baseline = set()
current = subprocess.run(['git', 'status', '--porcelain'], capture_output=True, text=True).stdout.splitlines()
print('\n'.join(l for l in current if l not in baseline))
")
      if [ -n "$NEW_DIRTY" ]; then
        echo "You have uncommitted changes (new since this episode began) — please commit or stash your work on $TICKET_ID before switching to $HAS_DIFFERENT_TICKET. This ensures your current work gets tracked under the right ticket." >&2
        echo "" >&2
        echo "New dirty files:" >&2
        echo "$NEW_DIRTY" >&2
        mkdir -p .kiro-tracking
        echo "hook_status=uncommitted-work-gate-blocked ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) site=fastpath-c2" >> .kiro-tracking/hook-health.log
        exit 2
      fi
    fi
  fi

  echo "CURRENT_TRACKED_TICKET: $TICKET_ID (read directly from current-ticket.json by this command hook, not by you — trust this value over any assumption about session freshness). RESPONSE STYLE: do NOT narrate your reasoning, do NOT mention checking files or reading ticket state, do NOT cite case numbers or rules. Just respond naturally to what the user asked."
  exit 0
fi

# A pending Jira validation is in flight — needs the real agent hook.
# Let the prompt through untouched, no note needed (ticket_id is empty
# in this branch, nothing to report).
if [ -f .kiro/pending-ticket-check.json ]; then
  exit 0
fi

# The agent hook may be mid-way through a "refresh credits, then
# confirm" wait for a PREVIOUS candidate. Before standing down, though
# — check whether the marker has gone stale. Added 2026-09-02,
# confirmed live: a rejected/abandoned candidate's marker sat here
# un-deleted (the agent's "delete on rejection" prose step skipped —
# same reliability gap as everything else tonight), and its mere
# presence blocked this script from EVER reaching the
# candidate-detection logic below for a real, later-typed ticket —
# confirmed by this exact code trace, not speculation (see TODO.md,
# 2026-09-02). Rather than depending on the agent to notice and clean
# up a stale marker, check deterministically: does the CURRENT message
# look like a fresh, different candidate than what the marker already
# holds? If so, update it now — this script doesn't need to know WHY
# the old one went stale (explicit rejection, silent abandonment, or
# anything else), only that a real new candidate has arrived. Reuses
# the same match logic as the candidate-detection below (duplicated
# rather than shared, matching this file's existing style — the
# exact-match regex already appears in several places).
if [ -f .kiro/pending-baseline-confirm.json ]; then
  STALE_CANDIDATE=""
  if echo "$PROMPT" | grep -qE '^[A-Z][A-Z0-9]*-[0-9]+$'; then
    STALE_CANDIDATE="$PROMPT"
  else
    STALE_NORM=$(echo "$PROMPT" \
      | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/[[:space:]]*-[[:space:]]*/-/' \
      | tr '[:lower:]' '[:upper:]')
    if echo "$STALE_NORM" | grep -qE '^[A-Z][A-Z0-9]*-[0-9]+$'; then
      STALE_CANDIDATE="$STALE_NORM"
    fi
  fi
  if [ -n "$STALE_CANDIDATE" ]; then
    # Safe to embed unquoted — STALE_CANDIDATE only ever holds a value
    # that already matched the strict ticket-ID regex above.
    #
    # docs/kiro-confirmed-persistent-signal-proposal.md, added
    # 2026-09-02: candidate-detection log entry too, but only inside
    # the same "actually a new candidate" guard as the marker update
    # itself — a no-op repeat of the same stale value isn't a fresh
    # detection.
    python3 -c "
import json
try:
    with open('.kiro/pending-baseline-confirm.json') as f:
        d = json.load(f)
except Exception:
    d = {'awaiting': True}
if d.get('ticket_id') != '$STALE_CANDIDATE':
    d['ticket_id'] = '$STALE_CANDIDATE'
    json.dump(d, open('.kiro/pending-baseline-confirm.json', 'w'))
    with open('.kiro/candidate-detection-log.jsonl', 'a') as f:
        f.write(json.dumps({'ticket_id': '$STALE_CANDIDATE', 'detected_at': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'}) + '\n')
"
  fi
  exit 0
fi

# Ticket is empty. Is this message itself a candidate answer?
if echo "$PROMPT" | grep -qE '^[A-Z][A-Z0-9]*-[0-9]+$' || [ "$PROMPT" = "none" ]; then
  # docs/case-a1-marker-fix-proposal.md, added 2026-09-01: write the
  # marker (WITH the candidate ticket_id) ourselves, right here, the
  # moment a candidate is detected — don't leave it to the agent's own
  # prose instruction to remember (confirmed live: it didn't, twice —
  # TODO.md). This code path only runs when no marker exists yet (line
  # 160 above already exits early on any later turn), so there's no
  # clobber risk. PROMPT is safe to embed unquoted in the python
  # literal below — it already matched the strict regex, or is the
  # literal string 'none'; no quotes/apostrophes possible in either.
  #
  # docs/kiro-confirmed-persistent-signal-proposal.md, added 2026-09-02:
  # also append to the candidate-detection log, agent-invisible (the
  # agent never reads or writes this file, unlike the marker, so it
  # can't be inconsistently affected by agent cleanup behavior the way
  # the marker was — confirmed live 2026-09-02, two skipped-ask
  # occurrences left the marker in opposite states). This is the
  # deterministic "detected_at" half of the gap-seconds calculation.
  python3 -c "
import json
json.dump({'awaiting': True, 'ticket_id': '$PROMPT'}, open('.kiro/pending-baseline-confirm.json', 'w'))
with open('.kiro/candidate-detection-log.jsonl', 'a') as f:
    f.write(json.dumps({'ticket_id': '$PROMPT', 'detected_at': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'}) + '\n')
"
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
  # docs/case-a1-marker-fix-proposal.md, added 2026-09-01: same
  # write-it-ourselves fix as the exact-match branch above, using the
  # normalized candidate (also regex-validated safe to embed) — this
  # is what's being confirmed by the "Did you mean X?" question, so
  # it's what the marker should carry.
  #
  # docs/kiro-confirmed-persistent-signal-proposal.md, added 2026-09-02:
  # candidate-detection log, same as the exact-match branch above.
  python3 -c "
import json
json.dump({'awaiting': True, 'ticket_id': '$NORMALIZED'}, open('.kiro/pending-baseline-confirm.json', 'w'))
with open('.kiro/candidate-detection-log.jsonl', 'a') as f:
    f.write(json.dumps({'ticket_id': '$NORMALIZED', 'detected_at': '$(date -u +%Y-%m-%dT%H:%M:%SZ)'}) + '\n')
"
  # exit 0 → stdout (not stderr) is what Kiro adds to the agent's
  # context, per kiro.dev/docs/hooks/actions/ — stderr is only read on
  # a non-zero exit, which this isn't.
  echo "FUZZY_TICKET_MATCH: raw message \"$PROMPT\" normalizes to $NORMALIZED after removing whitespace/case — not an exact match, confirm with the user before treating this as their answer."
  exit 0
fi

# docs/session-start-greeting-exception-proposal.md, added 2026-09-02:
# before the bare HARD GATE question, check for a pending session-start
# greeting marker (written by aidlc-session-greeting.json on
# SessionStart, when ticket_id was empty). Judged by AGE
# (created_at), not by whether it happened to be reached soon after
# creation — five OTHER branches in this script (CURRENT_TRACKED_TICKET,
# pending-ticket-check.json, pending-baseline-confirm.json, exact-match,
# fuzzy-match) all exit before this point, so an ordinary first message
# could leave the marker unexamined for any number of turns; age-based
# expiry means it doesn't matter how many, or which branch fired.
# Deleted unconditionally the moment it's examined, matched or not —
# no path through this block leaves the file behind.
if [ -f .kiro/pending-session-greeting.json ]; then
  CREATED_AT=$(python3 -c "
import json
try:
    print(json.load(open('.kiro/pending-session-greeting.json')).get('created_at', ''))
except Exception:
    print('')
")
  CREATED_EPOCH=$(date -u -d "$CREATED_AT" +%s 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  AGE=$((NOW_EPOCH - CREATED_EPOCH))
  rm -f .kiro/pending-session-greeting.json
  # 300s (5 min) — same timeout already established twice elsewhere in
  # this project (pre-commit's profile-click prompt, post-commit's
  # switch question), reused rather than inventing a new number.
  # CREATED_EPOCH falls back to 0 on a missing/malformed timestamp,
  # making AGE huge and >=300 naturally — fails safe into "expired,"
  # never into treating a broken read as fresh.
  if [ -n "$CREATED_AT" ] && [ "$AGE" -ge 0 ] && [ "$AGE" -lt 300 ]; then
    echo "SESSION_START_GREETING_EXCEPTION: this is the first message of a new session with no ticket tracked — per the HARD GATE's own stated exception below, combine a brief warm greeting with the ticket question in ONE natural message (e.g. \"Hey! Good to see you — which Jira ticket are you working on today?\"). Do not narrate hook logic, do not explain how you know this. This applies to THIS turn only."
    exit 0
  fi
  # Expired, or malformed — marker already deleted above; fall through
  # to the normal bare-question HARD GATE below, unchanged.
fi

# No ticket, and this message isn't answering the question even loosely
# — block cheaply, zero agent involvement.
echo "Which Jira ticket are you working on (a real ticket ID, or explicitly 'none' for work with no ticket)?" >&2
exit 2
