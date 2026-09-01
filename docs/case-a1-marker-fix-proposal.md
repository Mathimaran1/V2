# Proposal: move CASE A1's marker write (and its ticket_id) into the command hook

**Status: PROPOSAL ONLY — not implemented.** Nothing in `.kiro/` or
`scripts/` has changed to reflect this.

## The two findings this closes

1. **Write-skip, confirmed live** (`TODO.md`, 2026-09-01, "a THIRD
   confirmed instance..."): a real transcript — `ANG-123` → agent
   correctly asks "Please click your profile icon to refresh your
   credits, then let me know when ready" → `done` → `.kiro/pending-
   baseline-confirm.json` turns out never to have been written, so the
   fast-path's own exemption never engages, the HARD GATE re-fires, and
   `done` gets discarded. Root cause: the marker write is a prose
   instruction inside the agent's own turn, not a deterministic step.
2. **Missing ticket_id, found by direct trace** (this session): the
   marker's defined content is `{"awaiting": true}` — no `ticket_id`
   field, confirmed against the literal MARKER FILE rule text. For
   CASE A1 specifically, nothing else on disk holds the candidate
   ticket ID at the moment the marker is created (`current-ticket.json`
   is empty by CASE A's own precondition) — so even a successful
   marker write leaves the next turn no way to know *which* ticket to
   finish setting up, other than the agent's own memory of the prior
   turn's conversation. This project already has three separate
   confirmed-tonight instances of that kind of cross-step context not
   reliably carrying forward (the fresh-session grounding bug, Option
   A2's skipped write, the cloudId-reuse anomaly — the last of which
   failed *within a single turn*, a shorter distance than a full turn
   boundary).

Both findings, on inspection, turn out to be isolated to **the same one
call site** — CASE A1 — for the same underlying reason: it's the only
one of the four places that write this marker with nothing else backing
it on disk.

## Confirming PRIORITY CHECK and CASE C1 do NOT need this fix — by code trace, not assumption

`scripts/ticket-gate-fastpath.sh`'s actual control flow (current file,
lines 151–162):

```bash
if [ -n "$TICKET_ID" ]; then
  echo "CURRENT_TRACKED_TICKET: $TICKET_ID (...)"
  exit 0
fi

# A pending Jira validation is in flight, or the agent hook is
# mid-way through a "refresh credits, then confirm" wait — both need
# the real agent hook. Let the prompt through untouched...
if [ -f .kiro/pending-ticket-check.json ] || [ -f .kiro/pending-baseline-confirm.json ]; then
  exit 0
fi
```

- **CASE C1** only ever runs while `ticket_id` is already non-empty
  (that's C1's own precondition — "ticket_id is non-empty"). Every
  turn in that state exits at line 151–154, via `CURRENT_TRACKED_
  TICKET`, **before the script ever reaches line 160's marker check**.
  Whether `pending-baseline-confirm.json` exists or not is structurally
  irrelevant to what the fast-path does on a C1 turn — it never looks.
  Separately, the ticket ID C1 needs is already sitting in
  `current-ticket.json`'s own `pending_switch_to` field, written by C2
  on the prior turn, and only overwritten by the same command that
  completes the switch — so even C1's own prose marker-write, if
  skipped, loses nothing.
- **PRIORITY CHECK** runs only while `ticket_id` is empty, so it does
  reach line 160 — but `.kiro/pending-ticket-check.json` (written
  reliably by `post-commit`, a real git hook, not agent prose) is
  independently checked in that same `||` condition and stays on
  disk for this flow's entire duration. If PRIORITY CHECK's own
  `pending-baseline-confirm.json` write got skipped, line 160 still
  exits via the `pending-ticket-check.json` half — the fast-path never
  notices the difference. Its `typed_ticket` field is the ticket ID,
  already durable, independent of this marker.
- **CASE A1** is the only branch that reaches line 160 with *no* other
  file (`pending-ticket-check.json`, `pending_switch_to`) backing it.
  `pending-baseline-confirm.json` is the *only* thing standing between
  a live sub-dialogue and the HARD GATE re-firing, and the only thing
  that could ever carry the candidate ticket ID forward on disk.

This matches the instruction precisely: don't over-apply the fix to
cases that don't have the problem. Only CASE A1's two sub-paths (the
fuzzy "Did you mean X?" question and the main "please refresh credits"
question) are touched below; C1 and PRIORITY CHECK's existing prose
instructions are left exactly as they are.

## Design

### 1. `scripts/ticket-gate-fastpath.sh` — write the marker (with ticket_id) at the exact point a candidate is first detected

The script already detects both of CASE A1's candidates deterministically
— that's the whole point of `FUZZY_TICKET_MATCH` and the exact-match
check just above it. Both detection points are reached **only** when no
marker already exists yet (line 160 exits earlier on any subsequent
turn), so there is no clobber risk — this is the first, and only, time
the marker gets created for a given candidate.

**Exact-match / `'none'` branch** (currently line 165–167):
```bash
if echo "$PROMPT" | grep -qE '^[A-Z][A-Z0-9]*-[0-9]+$' || [ "$PROMPT" = "none" ]; then
  # PROMPT is guaranteed safe to embed here — it already matched the
  # strict regex, or is the literal string 'none'; no quotes/apostrophes
  # possible in either case.
  python3 -c "
import json
json.dump({'awaiting': True, 'ticket_id': '$PROMPT'}, open('.kiro/pending-baseline-confirm.json', 'w'))
"
  exit 0  # exact match — needs Jira validation, hand off to agent hook
fi
```

**Fuzzy-match branch** (currently line 187–192), same idea, using
`$NORMALIZED` (also regex-validated safe to embed):
```bash
if echo "$NORMALIZED" | grep -qE '^[A-Z][A-Z0-9]*-[0-9]+$'; then
  python3 -c "
import json
json.dump({'awaiting': True, 'ticket_id': '$NORMALIZED'}, open('.kiro/pending-baseline-confirm.json', 'w'))
"
  echo "FUZZY_TICKET_MATCH: raw message \"$PROMPT\" normalizes to $NORMALIZED ..."
  exit 0
fi
```

**On the double-commit anomaly flagged in `TODO.md` right before this
proposal** — checked directly, doesn't apply here: `git commit` is
non-idempotent (every successful call creates a new object, which is
exactly how two calls produced two commits), but a plain file write is
idempotent — writing the same marker content twice, even from two
overlapping invocations, just leaves the same file in the same state.
There's no analogous "duplicate" outcome possible for this fix.

### 2. `aidlc-ask-for-ticket-if-missing.json` — stop asking the agent to write this marker for A1, read ticket_id from it instead

Both of CASE A1's existing "Write `.kiro/pending-baseline-confirm.json`
now..." instructions get replaced with: the marker (including
`ticket_id`) is already written by the command hook before this turn
starts — do not write or overwrite it; when you reach the point of
running the credit-read-and-write command, read `ticket_id` from
`.kiro/pending-baseline-confirm.json`, not from your own memory of
what the user typed earlier in the conversation. `CASE C1` and
`PRIORITY CHECK`'s own marker-write instructions are untouched.

### 3. New required deletion: the "ticket doesn't exist" rejection branch

This is the one genuinely new obligation this design adds. Today, the
marker is written only *after* Jira validation passes, so a rejection
("`<ticket>` doesn't appear to be a real ticket") never had a marker to
clean up. Now that the command hook writes it *before* validation
happens (it has no way to know the outcome in advance), a rejection
must explicitly delete it — otherwise it lingers, and every future
empty-ticket turn silently loses the fast-path's cost exemption until
someone notices (exactly the failure the MARKER FILE rule's general
"delete on every exit path" line already warns about). Add "and delete
`.kiro/pending-baseline-confirm.json`" to CASE A1's existing "tell the
user it doesn't appear to be a real ticket... treat this exactly like
(A2)" instruction. This exact pattern — delete the marker on a
decline-with-no-alternative — already exists for the fuzzy sub-path's
own decline case; this extends the same established pattern to the
one branch that doesn't have it yet, rather than inventing a new one.

## What this does NOT fully close — stated honestly, not glossed over

**The decline-with-alternative edge case still needs one narrow prose
step.** CASE A1's existing rule: a fuzzy-match decline that offers a
*different* candidate ("no, I meant ANG-4571") re-runs the matching
logic on the new candidate "keeping the marker in place throughout."
The command hook cannot detect this itself — "no ANG-4571" doesn't
match the ticket-ID regex (correctly; the existing `NOANG-4571`
false-positive fix depends on that), so the command hook won't see it
as a fresh candidate and won't update the marker's `ticket_id`. The
agent must update it. This is a narrower, single-sentence addition
("...and update the marker's `ticket_id` field to the new candidate")
to an instruction that already exists and already handles this
scenario in every other respect — not a reversion to the original,
fully-prose-dependent design. Flagged here rather than silently
assumed to be covered.

**A skipped deletion on the rejection branch degrades to a cost
regression, not a correctness bug — but is NOT self-correcting on its
own, corrected after live-testing proved the original claim here
wrong.** If the agent forgets to delete the marker after a "doesn't
exist" rejection, the fast-path keeps routing every subsequent
empty-ticket turn through the full agent hook (paying real cost).
This section originally claimed that resolves itself "the moment a new
candidate arrives" — tested directly (see `TODO.md`, 2026-09-01, "Test
9") and found FALSE: `scripts/ticket-gate-fastpath.sh` line 160's bare
existence check on `pending-baseline-confirm.json` exits before the
exact/fuzzy-match detection logic ever runs again, so a stale marker
is never overwritten by the command hook itself, no matter what the
next message is. Fixed by generalizing the decline-with-alternative
pattern above: CASE A1's very first line (immediately after "treat
that message AS the answer to the pending question") now also
instructs updating the marker's `ticket_id` to the current message's
candidate whenever it doesn't already match — closing this specific
gap, still prose-dependent (same honest limitation as the
decline-with-alternative case itself), verified live to close it in
testing, not merely reasoned through.

## Live test plan

State confirmed clean (or explicitly noted as live/untouched) before
each run, real file state checked after every turn — not inferred from
the transcript, same standard as every other proposal tonight.

1. **Exact match, success path.** Empty ticket → send `ANG-123` (or
   another real, valid ticket) → confirm directly:
   `.kiro/pending-baseline-confirm.json` exists and contains
   `ticket_id: "ANG-123"` **before** the agent hook's own turn — check
   it exists right after the fast-path runs, independent of whatever
   the agent does next.
2. **Exact match, full flow to completion.** Continue from (1): reply
   to the refresh-credits ask. Confirm `current-ticket.json` gets
   written with `ticket_id: "ANG-123"` and both markers are gone
   afterward.
3. **The exact bug from the transcript, replayed.** Same as (1)–(2)
   but simulate the original failure shape as closely as possible —
   confirm that even if the *agent's own* write got skipped for any
   reason, the marker (already written by the command hook on turn 1)
   still exists on the "done" turn, so the fast-path still stands
   down correctly. This is the direct regression test for the
   original bug.
4. **Fuzzy match.** Empty ticket → send `"ang - 123"` → confirm the
   marker exists with `ticket_id: "ANG-123"` (normalized) before the
   agent's "Did you mean...?" turn.
5. **Rejection branch.** Empty ticket → send a syntactically valid but
   fake ticket ID → confirm the marker gets created on that turn, then
   confirm it gets deleted once the agent reports "doesn't appear to
   be a real ticket" (this is the new required prose step — if it
   fails, that's the expected residual risk, not a surprise, and
   should be logged as such, not treated as invalidating the rest).
6. **CASE C1, unaffected — a negative test.** With a ticket already
   tracked, trigger a switch question (C2), confirm it (C1), and
   directly confirm the fast-path's behavior is byte-identical to
   before this change (still exits via `CURRENT_TRACKED_TICKET` at
   line 151–154, never reaches the marker-check line at all) —
   confirms the "C1 doesn't need this" trace wasn't just a read of the
   code but holds in a live run too.
7. **PRIORITY CHECK, unaffected — a negative test.** Same idea via
   `post-commit`'s switch-prompt path (`pending-ticket-check.json`) if
   practical to set up live; otherwise confirm via direct inspection
   that `pending-ticket-check.json` alone still satisfies line 160
   regardless of `pending-baseline-confirm.json`'s state.
8. Repeat (1)–(5) at least twice more before calling this fixed, same
   pass bar as every other structural change tonight: any single
   failure means "improved, still under investigation," not "fixed."

## Rollback plan

Two isolated, additive changes: the two new `python3 -c` marker-write
calls in `scripts/ticket-gate-fastpath.sh` (revert by removing them,
same shape as every other fastpath revert this session), and the
corresponding prompt-text edits in `aidlc-ask-for-ticket-if-missing.json`
scoped only to CASE A1's two sub-paths plus the new rejection-branch
deletion sentence (revert is a straight text restoration of those
specific spans). No schema change to `current-ticket.json`, no new
files, no change to CASE C1 or PRIORITY CHECK's own logic at all.
