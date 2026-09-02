# Proposal: a warm combined greeting+ask for an empty-ticket session's first message

**Status: PROPOSAL ONLY — not implemented.** Nothing in `.kiro/` or
`scripts/` has changed to reflect this.

**Revised after review** (2026-09-02): the original version of this
proposal had only a happy-path consumption step, no real expiry. Traced
directly and confirmed the gap is real — see "The stale-marker
question, answered" below — and fixed with a time-based expiry before
this goes back for approval.

## The request, and why it needs care

Real transcript (2026-09-02): `hi`, no ticket tracked → the agent
narrated ("I need to read the current ticket file to determine what to
do") instead of the bare HARD GATE question — a repeat of the
already-logged, unresolved "does `exit 2` actually suppress the
sibling agent hook" question (`TODO.md`, 2026-09-02). Separately, the
user asked for a real behavior change: when no ticket is set, the
first response of a session should be a warm greeting *combined* with
the ticket question, not the current cold bare question (or the
narrated non-answer it's currently getting instead).

This isn't just a session-greeting hook tweak. It requires an explicit
exception to the HARD GATE, which currently reads, deliberately
absolute: *"your ENTIRE response this turn must be ONLY the ticket
question... This applies to every category of message without
exception... There is no such thing as a message this gate does not
apply to."* That wording exists because softer versions were
repeatedly found being talked around — changing it needs the same
care that went into writing it.

## Design

### Don't rely on the agent inferring "this is turn 1" — use a deterministic marker instead

The naive approach — have `SessionStart`'s injected `SESSION_START_
CONTEXT` note tell the agent "this is a fresh session, greet warmly on
the first message" — depends on an unconfirmed assumption: that
`SessionStart`'s context reliably carries into the *next* turn's
`UserPromptSubmit` processing, and that the agent correctly attributes
a bare "hi" turn back to that earlier injection rather than treating it
as an ordinary empty-ticket message like any other. Given tonight's
repeated finding that this class of prose-only, cross-turn inference
is unreliable, this proposal doesn't build on that assumption at all.

**Instead:** `SessionStart` (`aidlc-session-greeting.json`) writes a
one-shot marker, `.kiro/pending-session-greeting.json`, whenever
`ticket_id` is empty. The fast-path command hook (`UserPromptSubmit`)
checks for that marker at the exact point it would otherwise fire the
bare-question HARD GATE block; if present, it deletes the marker (one
use only) and instead lets the turn through with a stdout note telling
the agent to combine a greeting with the question. If the message
turns out to be an actual candidate (exact/fuzzy match, `'none'`) — the
existing CASE A1 paths already handle that correctly on their own, no
special greeting needed — the marker is still cleared, silently, so it
never lingers into a later turn.

This is fully deterministic on the trigger condition (marker exists or
doesn't); the only prose-dependent part left is the agent actually
writing a natural greeting, which is inherently something only the
agent can do.

### Exact changes

**1. `aidlc-session-greeting.json`, empty-ticket branch** — write the
marker WITH a timestamp (the expiry basis, see below), keep the
injected note minimal (the real instruction now comes from the
fast-path on the next turn, avoiding two hooks describing conflicting
things to the agent at different times):

Before:
> `"SESSION_START_CONTEXT: No ticket is currently set. The first
> message will trigger the ticket-assignment flow via the other hooks
> — no special greeting needed from you."`

After (plus writing `.kiro/pending-session-greeting.json` with
`{"created_at": "<ISO timestamp>"}` before this echo):
> `"SESSION_START_CONTEXT: No ticket is currently set."`

(Dropping "no special greeting needed from you" — that's no longer
accurate once this ships, and leaving it in would have two hooks
telling the agent contradictory things about the same turn.)

**2. `scripts/ticket-gate-fastpath.sh`** — right before the existing
bottom-of-script HARD GATE block (`echo "Which Jira ticket..." >&2;
exit 2`), now with a time-based expiry — 300 seconds (5 minutes),
reusing the exact timeout already established twice elsewhere in this
project (`pre-commit`'s profile-click prompt, `post-commit`'s switch
question) rather than inventing a new number:
```bash
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
  if [ -n "$CREATED_AT" ] && [ "$AGE" -ge 0 ] && [ "$AGE" -lt 300 ]; then
    echo "SESSION_START_GREETING_EXCEPTION: this is the first message of a new session with no ticket tracked — per the HARD GATE's own stated exception below, combine a brief warm greeting with the ticket question in ONE natural message (e.g. \"Hey! Good to see you — which Jira ticket are you working on today?\"). Do not narrate hook logic, do not explain how you know this. This applies to THIS turn only."
    exit 0
  fi
  # Expired (>=300s old), or a malformed/unparseable timestamp
  # (CREATED_EPOCH falls back to 0, making AGE huge and >=300
  # naturally, the same fail-safe direction as everywhere else in
  # this file — never fail open into treating a broken read as
  # fresh) — marker already deleted above; fall through to the
  # normal bare-question HARD GATE below, unchanged.
fi
```
The marker is deleted unconditionally, in every branch, the moment
it's examined — expired or not, malformed or not, matched or not.
There is no path through this block that leaves the file behind.
Placed after the existing exact-match/fuzzy-match candidate checks
(so a first message that's already a real ticket ID still goes through
normal CASE A1 handling, unaffected — if that happens, this block
simply isn't reached on that turn, and the marker is examined and
cleared the *next* time an empty-ticket message does reach it, still
correctly judged against its real age, however many turns that took).

**3. Hygiene cleanup at the existing `CURRENT_TRACKED_TICKET`
early-exit** (fires once `ticket_id` is non-empty) — opportunistically
remove a leftover marker if one's still sitting there, since the
greeting need is already superseded the moment a real ticket gets set
through any path:
```bash
if [ -n "$TICKET_ID" ]; then
  rm -f .kiro/pending-session-greeting.json
  ...
```
Not required for correctness (the expiry above already prevents any
incorrect firing on its own) — this is purely to avoid an orphaned
marker sitting in `.kiro/` indefinitely on the (plausible) path where
a session's first real message is already a valid ticket ID, so the
expiry-check block never gets reached again to clean it up itself.

**4. `aidlc-ask-for-ticket-if-missing.json`'s HARD GATE preamble** —
the one, narrow, explicit carve-out:

Before:
> "...then your ENTIRE response this turn must be ONLY the ticket
> question from CASE A2 below — do not answer, explain, search, look
> anything up, or take any other action first. This applies to every
> category of message without exception... There is no such thing as
> a message this gate does not apply to."

After:
> "...then your ENTIRE response this turn must be ONLY the ticket
> question from CASE A2 below — do not answer, explain, search, look
> anything up, or take any other action first. This applies to every
> category of message without exception, WITH EXACTLY ONE EXCEPTION,
> added 2026-09-02 (see docs/session-start-greeting-exception-
> proposal.md): if the fast-path command hook's stdout for this turn
> contains a line starting with 'SESSION_START_GREETING_EXCEPTION:',
> your response may combine a brief warm greeting with the ticket
> question as one natural message, exactly as that note describes —
> and ONLY for this one turn; every other turn, including every later
> empty-ticket turn in the same session, reverts to the bare question,
> no exceptions, exactly as before. Do not apply this exception based
> on your own judgment about whether a greeting seems appropriate —
> only the presence of that exact stdout line licenses it."

Tying the exception to a literal, deterministic stdout signal (rather
than "use your judgment about whether this looks like a fresh
session") keeps the carve-out itself from becoming a new place for the
agent to rationalize extra narration on turns where it doesn't apply.

## The stale-marker question, answered explicitly

Asked directly: what happens if `SessionStart` writes the marker but
the fast-path never gets to consume it on the very next turn — does it
linger and incorrectly fire on a later, unrelated turn?

**As originally written: yes, it could have.** The check sat at one
point only (just before the bottom HARD GATE), and five other branches
in the same script (`CURRENT_TRACKED_TICKET`, `pending-ticket-
check.json`, `pending-baseline-confirm.json`, exact-match, fuzzy-match)
all `exit 0` earlier, before ever reaching it. Any of those firing on
the first turn — an ordinary outcome, not a rare interruption — would
leave the marker completely unexamined, with nothing to stop it from
eventually being found and incorrectly applied on a genuinely unrelated
turn, possibly a long time later.

**Fixed:** the check now judges the marker by its own recorded age
(`created_at`), not by whether it happened to be reached soon after
being written. It doesn't matter which branch fires first, how many
turns pass, or how long the marker sits — the moment it *is* examined
(now, or on any later turn), it's deleted unconditionally in the same
step, and the greeting exception only applies if that age is under 300
seconds. A marker examined 10 minutes or 10 days after creation is
found, deleted, and silently ignored, never applied. Item 3
(`CURRENT_TRACKED_TICKET` cleanup) additionally prevents the file from
sitting around indefinitely on the common path where it's never
re-examined at all — pure hygiene, not required for the correctness
guarantee above, which the expiry check alone already provides.

## What this does NOT address

The narration bug itself (`exit 2` apparently not suppressing the
sibling agent hook) is untouched by this proposal — still open, still
logged, not this proposal's problem to solve. This proposal only adds
a deliberate, narrow exception to what the response should contain
*when* the agent hook does run on that specific first turn; it doesn't
change whether/when the agent hook runs at all.

## Live test plan

Real file state checked after every case.

1. **Fresh session, empty ticket, first message is a plain greeting.**
   Confirm `.kiro/pending-session-greeting.json` exists (with a real
   `created_at`) after `SessionStart` fires. Confirm the fast-path's
   next turn deletes it and emits the `SESSION_START_GREETING_EXCEPTION`
   stdout line, exit 0 (not the bare-question exit 2).
2. **Second message, same session, still empty ticket** (user didn't
   answer). Confirm the marker is gone (already consumed) and the
   bare-question HARD GATE fires normally, unchanged from today.
3. **Fresh session, empty ticket, first message is already a real
   ticket ID** (e.g. `ANG-123`). Confirm the marker is NOT touched on
   this turn (the exact-match branch exits first) and normal CASE A1
   handling proceeds untouched. Then, on a LATER turn where the ticket
   is empty again (e.g. after a branch switch, well within 300s),
   confirm the still-fresh marker is correctly found and still applies
   the exception — proving age, not turn-count, is what's judged.
4. **Fresh session, ticket already tracked** (non-empty). Confirm no
   marker gets written at all — existing tracked-ticket greeting
   behavior unaffected.
5. **Expiry — the core question this revision answers.** Write a
   marker with a `created_at` from >300 seconds ago (simulating a
   session that was interrupted, or one where several intervening
   turns delayed reaching this check). Send a plain empty-ticket
   message. Confirm: marker file deleted, NO
   `SESSION_START_GREETING_EXCEPTION` line emitted, normal bare-question
   HARD GATE fires instead — the exact scenario asked about, proven
   not to misfire.
6. **Malformed/missing `created_at`.** Confirm it fails safe — treated
   as expired (never applied), not as fresh.
7. **`CURRENT_TRACKED_TICKET` hygiene cleanup.** With a marker present
   and `ticket_id` non-empty, confirm the marker is removed by that
   branch even though the expiry-check block is never reached.

## Rollback plan

Four additive, isolated changes: one marker-write line (now with a
timestamp) in `aidlc-session-greeting.json`, one new expiry-checked
block in `ticket-gate-fastpath.sh` (before the existing bottom HARD
GATE, not replacing it), one hygiene cleanup line at the existing
`CURRENT_TRACKED_TICKET` branch, and one carve-out sentence in the HARD
GATE preamble. Revert each independently by removing its own piece; no
schema change, no new persistent state beyond the one-shot marker file.
