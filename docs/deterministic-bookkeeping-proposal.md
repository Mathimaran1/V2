# Proposal: move mechanical bookkeeping into deterministic code

**Status: PROPOSAL ONLY — not implemented.** This is a design decision
in response to a confirmed reliability ceiling, not a hotfix. Nothing
in `.kiro/` has changed to reflect this.

## The evidence this is built on

Two clean, state-verified repro runs tonight (`TODO.md`, 2026-09-01):
a fresh session's first message, mentioning a different real ticket
while one is already tracked, produced the wrong response once (read
`current-ticket.json`, ignored its actual content) and a
right-*looking* response once that silently failed to write
`pending_switch_to` first, as CASE C2 requires — which would have
dropped the switch entirely on the next turn. Combined with three
earlier confirmed failures this same session (a skipped Jira
validation call, a self-generated instead of clock-read timestamp, an
earlier skipped `pending_switch_to` write from 2026-08-31 that this
exact bug is a recurrence of), that's **five independent instances of
the same shape**: the agent skips one specific required mechanical
step while still producing a plausible response around the gap.

The follow-up audit of every "confirmed live" claim in this project's
history found the same asymmetry from a different angle: every
git-hook-level (`pre-commit`/`post-commit`/`commit-msg`) test that
checked file state directly has a perfect record — dozens of entries,
zero false passes. Every failure tonight happened in the agent-driven
half. **The deterministic half of this system has never once been
the source of a bug in this file's entire history. The agent-driven
half has failed repeatedly, in increasingly specific and varied ways,
despite four separate rounds of stronger wording across tonight alone.**
That's not evidence a fifth wording attempt will hold — it's evidence
the mechanism itself (trust prose instructions to reliably execute a
multi-step procedure) has a ceiling, and the fix has to change what's
being asked of the agent, not how it's phrased.

## Two structural options, and which one this recommends

### Option A: move bookkeeping into deterministic code (recommended, primary)

Two concrete, narrow changes — both additive to the current
(already-restored, known-good) hook, not a restructure:

**A1 — always inject the real `ticket_id` into context, don't rely on
the agent to fetch and correctly interpret it itself.**
`scripts/ticket-gate-fastpath.sh` already reads `current-ticket.json`
reliably on every single turn — this has never once failed tonight,
across every test, in either checkout. Today it stays silent whenever
`ticket_id` is set (just `exit 0`, no note). Change it to always emit
a stdout note when `ticket_id` is non-empty:
`CURRENT_TRACKED_TICKET: <ticket_id> (read directly from
current-ticket.json by the command hook, not by the agent)`. This uses
the exact same proven mechanism already carrying `FUZZY_TICKET_MATCH`
— no new capability, no new risk surface. The point isn't that the
agent can't read the file itself; it's that a fact fed directly into
context, unconditionally, before any reasoning starts, is much harder
to override with a prior ("new session → probably empty") than a fact
the agent has to actively fetch and correctly weigh against that same
prior. Directly targets run 1's failure.

**A2 — bundle every file WRITE the agent makes into one deterministic
command, the same pattern already proven for the credits/episode_id/
timestamp read.** Today, writing `pending_switch_to` (or any
`current-ticket.json` update) is free-text JSON construction via a
generic Write File call — exactly the surface that's failed twice now
(the skipped write documented 2026-08-31, and again in run 2 tonight).
Replace it with one bundled command per write, the same shape as the
already-reliable credit-baseline read: e.g.
`python3 -c "import json; d=json.load(open('.kiro/current-ticket.json')); d['pending_switch_to']='<ID>'; json.dump(d, open('.kiro/current-ticket.json','w'))"`.
This doesn't guarantee the agent remembers to call it — nothing can
guarantee that from a prompt alone — but it shrinks "construct correct
JSON reflecting several fields' current state, from memory, in free
text" down to "call one command with one substituted value," which is
a narrower, more mechanical task, matching the one part of this whole
system's chat-side that HAS held up reliably (the credit-baseline
command itself has never been observed generating a wrong number —
only the surrounding free-text instructions like "use the current
timestamp" failed, which is what got fixed for A2's own timestamp case
already tonight). Directly targets run 2's failure.

**What stays with the agent, deliberately not moved:** genuine
judgment calls — is this ticket ID real (needs live Jira MCP access,
not available to a command hook, confirmed repeatedly this session);
does this message actually mean a switch, versus a passing reference,
a comparison, or an example (CASE C2's own explicit carve-out, not a
pattern-matchable distinction). Option A narrows what the agent has to
get right, it doesn't try to remove the agent from the loop entirely
— that boundary is real and already correctly drawn in this hook's
design.

### Option B: an after-the-fact verification layer (not recommended as primary — weaker footing)

The idea: after the agent claims something happened (asked a switch
question, validated a ticket), have a separate deterministic check
confirm the file actually reflects it, and flag or correct a mismatch.

Rated weaker for a concrete reason, not just caution: this session has
no confirmed evidence that a command hook can see what the agent's own
*prior response* said — every command hook this project has actually
tested (the fastpath script, extensively) only receives the current
user prompt and reads repo files, per `kiro.dev`'s own docs (checked
directly during the dispatcher-split investigation) and this repo's
own inline uncertainty about the exact stdin shape. A general
"verify the last claim" layer would need to correlate against
something a command hook may not have access to at all — an unproven
mechanism, not a proven one extended. A narrower version (a command
hook maintaining its own marker for "a question was asked implying a
write should have happened") is more plausible but adds a new
state-machine wrinkle this project has already been burned by getting
wrong once (the `pending-baseline-confirm.json` orphan-marker class of
bug). Given Option A directly addresses both confirmed failures using
only already-proven mechanisms, Option B isn't needed to close tonight's
gap — worth reconsidering only if Option A, once tested, turns out to
leave a real gap it doesn't cover.

## Concrete plan (Option A)

1. Extend `scripts/ticket-gate-fastpath.sh` with A1's stdout injection
   — small, isolated diff, same shape as the existing
   `FUZZY_TICKET_MATCH` block.
2. Update `aidlc-ask-for-ticket-if-missing.json`'s CASE C2 (and any
   other place that writes `pending_switch_to` or updates
   `current-ticket.json` outside the already-bundled credit/episode/
   timestamp command) to require the bundled command from A2 instead
   of a freeform Write File call, following the same "confirmed live:
   X, this wording closes that gap" documentation convention already
   used for every prior fix tonight.
3. Regression-test the fastpath script locally (dry-run stdin, same
   method already used for every prior fastpath change this session)
   before any live test, to catch a broken script before it costs a
   live turn.

## Live test plan

Same two scenarios that found the bug, re-run with A1+A2 in place,
state confirmed clean before each run (the same discipline that
actually caught both original failures — a contaminated-state test
would look identical to a passing one):

1. Fresh session, first message mentions a different real ticket while
   one is tracked — confirm the response correctly asks the switch
   question, **and** confirm `current-ticket.json` shows
   `pending_switch_to` set to the right value immediately after,
   checked directly, not inferred from the transcript.
2. A confirming reply on the next turn — confirm the switch actually
   completes (new baseline, new episode, `pending_switch_to` cleared),
   checked directly against the file.
3. Repeat both at least twice more (matching the "one pass isn't
   enough" standard already applied tonight) before calling this
   fixed.

**Pass bar, same as every structural change this session: any single
failure means this doesn't ship as "fixed," it ships as "improved,
still under investigation."**

## Rollback plan

A1 is a small, isolated diff to `ticket-gate-fastpath.sh` — revert by
removing the added block, same shape as every prior fastpath revert
this session. A2 changes prompt wording only, no new files, no state
machine changes — revert is a straight text restoration, verifiable
byte-for-byte the same way tonight's Idea-1 rollback was.
