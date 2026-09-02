# Proposal: wording fix for the "already handled" framing risk + feasibility of an after-the-fact confidence flag

**Status: Item 1 (wording fix) BUILT — 2026-09-02, after the ask-skip
recurred live a second time with the marker correctly populated,
ruling out marker mechanics as that occurrence's cause and
strengthening the case for this specific mitigation (see `TODO.md`).
Item 2 (confidence flag) remains PROPOSAL ONLY — not implemented.**
(The stale-marker auto-update fix from the same investigation was
built separately, per explicit instruction that it was simple and
mechanical enough not to need this review step — see `TODO.md`,
2026-09-02, and `scripts/ticket-gate-fastpath.sh`.)

## The failure this responds to

`TODO.md` (2026-09-02, "a THIRD marker-related failure variant"): CASE
A1 validated `ANG-123` against Jira, then went straight to the
credit-read command — the "please click your profile icon... and WAIT"
step never appeared at all. The instruction text itself is intact and
correctly sequenced (confirmed by direct trace); this isn't a textual
regression. It's the agent not following a still-correct instruction —
the same reliability ceiling this project has hit repeatedly tonight,
just in a new spot.

Stated plainly, per the explicit instruction on this proposal: **item
1 below is the one that might actually reduce this failure. Item 2
does not prevent it, and cannot reliably detect the general case — it
only makes a specific, narrower shape of it visible after the fact.**
Don't read item 2 as closing the gap item 1 doesn't.

## Item 1: wording fix for the "already handled" framing risk

### The risk, as identified

CASE A1's current text (both the main path and the fuzzy sub-path)
reads:

> "The command hook already wrote `.kiro/pending-baseline-confirm.json`
> (with this candidate's ticket_id) the moment it first detected this
> message... do NOT write or overwrite it yourself. Then ask the user
> directly: 'Please click your profile icon...' — and WAIT for their
> actual reply — before running the command below."

Grammatically, "Then ask..." is a separate, still-required instruction.
But the sentence immediately before it tells the agent one specific
thing is *already done* — and it's a real, plausible risk that this
primes the agent to read the whole paragraph as "this section is
handled by the system," skipping past the part that genuinely isn't
handled. Not confirmed as the cause of the real incident, but a
concrete wording risk worth closing regardless of whether it was the
cause this time.

### Proposed rewording

Move the "don't write the marker" note to its own short parenthetical
*after* stating what the agent still must do, rather than leading with
it — so the FIRST thing the agent reads is the action still required
of it, not a reason to relax:

**Before:**
> "The command hook already wrote `.kiro/pending-baseline-confirm.json`
> (with this candidate's ticket_id) the moment it first detected this
> message — added 2026-09-01, see docs/case-a1-marker-fix-proposal.md;
> do NOT write or overwrite it yourself. Then ask the user directly:
> 'Please click your profile icon to refresh your credits, then let me
> know when ready' — and WAIT for their actual reply — before running
> the command below."

**After:**
> "You must still ask the user directly: 'Please click your profile
> icon to refresh your credits, then let me know when ready' — and
> WAIT for their actual reply — before running the command below. This
> is not optional and nothing else in this flow does it for you. (The
> marker file itself, `.kiro/pending-baseline-confirm.json`, is
> already written with this candidate's ticket_id by the command hook
> — added 2026-09-01, see docs/case-a1-marker-fix-proposal.md — so
> that ONE specific action, and only that one, is not yours to
> repeat.)"

Same information, reordered so the required action leads and the
already-done note is clearly scoped to "that one specific thing," not
"this section." Applied identically to the fuzzy sub-path's equivalent
sentence.

### Honest limit of this fix

This is still a prose instruction. It cannot guarantee compliance —
nothing tonight has found a wording change that guarantees compliance
for anything. It's a real, scoped reduction of one identified risk
factor, not a closure of the underlying reliability gap. Worth doing
because it's low-cost and directly targets a plausible contributor;
not being oversold as a fix for the failure mode itself.

## Item 2: feasibility of a deterministic after-the-fact confidence flag

### What was investigated

Whether a command hook can detect, on a later turn, that a baseline
was established with no corresponding ask/marker activity ever
recorded for it, and mark that episode's confidence data accordingly.

### Feasible, with one precondition and one hard limit

**Feasible, mechanically:** the command hook already does this class of
thing reliably — `hook-health.log` is exactly an append-only record
written deterministically by hooks, and tonight's marker fix already
proved the command hook can write/update JSON fields in
`current-ticket.json` reliably. A parallel append-only log (e.g.
`.kiro-tracking/ask-cycles.log`, written the moment the command hook
detects an exact/fuzzy candidate — the same point it already writes
the marker) would give a deterministic record of "a candidate was
detected at time T." On any later turn, the command hook can compare
`current-ticket.json`'s current `ticket_id`/`episode_started_at`
against that log and set a new field (e.g. `ask_provenance_confidence:
"unconfirmed"`) if no matching entry exists — which `commit-msg` could
then surface as a new trailer, e.g. `Kiro-Ask-Confidence`, distinct
from the existing `Kiro-Confidence` (which measures credit-cache
freshness, a different kind of uncertainty).

**Precondition — this is much stronger once the stale-marker fix
(built separately) is in place.** Before that fix, the command hook's
own candidate-detection could be silently blocked by a stale marker
(exactly what happened to `ANG-123` tonight) — meaning "no ask-cycle
record exists" could mean either "the ask was genuinely never
triggered" or "a stale marker blocked the command hook from ever
seeing this candidate," two different problems. With the stale-marker
fix in place, the command hook reliably sees every real candidate,
making the log's absence a much cleaner signal.

**The hard limit — stated plainly, not glossed over: this cannot catch
the general case, and tonight's actual incident may not even be
catchable by it.** The command hook has zero visibility into two
things that matter here: whether the agent's *visible chat response*
actually included the ask question, and whether it *genuinely waited*
for a real reply before proceeding, versus asking and immediately
continuing in the same turn. Once the marker exists (correctly written
by the command hook, which — with item 3's fix — will now reliably
happen for any real candidate, stale-marker-blocked or not), there is
no further deterministic signal available for "did the agent actually
stop here." A flag built this way only catches one specific shape of
failure: *no candidate-detection record exists at all for this
episode's ticket_id* — which is a real, useful thing to know, but is
not the same as "the ask was skipped." An agent that gets a marker
written correctly and *still* skips the ask (plausible, and not ruled
out as part of tonight's actual incident) would show a fully
plausible, populated `dirty_snapshot_at_episode_start` and a
just-as-populated ask-cycle log entry — indistinguishable, by this
flag, from a fully compliant run.

**Conclusion: build this only as a visibility improvement, not
represented as a fix.** If pursued, its value is turning "we can't
tell whether this happened" into "we can tell whether a candidate
record ever existed for this episode" — genuinely useful for auditing
after the fact (exactly the gap that made this investigation's item 1
answer "no signal either way" instead of a clean yes/no) — but it does
not close the reliability gap itself, and shouldn't be described to
anyone as doing so.

### If approved to build

- Command hook (fastpath): at every point it already writes or updates
  `pending-baseline-confirm.json`'s `ticket_id` (including the new
  stale-marker auto-update from item 3), also append one line to
  `.kiro-tracking/ask-cycles.log`: `candidate=<ticket_id>
  detected_at=<ISO timestamp>`.
- Command hook (fastpath): on every turn, if `current-ticket.json` has
  a `ticket_id` set and no `ask_provenance_confidence` field yet, check
  the log for a matching entry at or before `episode_started_at`; write
  `ask_provenance_confidence: "confirmed"` or `"unconfirmed"`
  accordingly, once, so it doesn't get recomputed every turn.
- `commit-msg`: add `Kiro-Ask-Confidence: <value>` (falling back to
  `n/a` for episodes established before this field existed, same
  convention as every other optional trailer).

## Live test plan (for whichever item is approved to build)

Real file state checked after every case, same standard as tonight's
other work.

**Item 1 (wording):** no code behavior to test — this is a text-only
change with no deterministic branch to exercise. Verification is
readability/unambiguity review only; explicitly not claimed to be
live-testable the way code changes are.

**Item 2 (confidence flag), if built:**
1. Candidate detected → confirm `ask-cycles.log` gets exactly one new
   line with the right ticket_id and a real timestamp.
2. Baseline established matching a logged candidate → confirm
   `ask_provenance_confidence: "confirmed"`.
3. Baseline established with NO matching log entry (simulating a
   stale-marker-blocked or otherwise bypassed candidate) → confirm
   `"unconfirmed"`.
4. A pre-existing `current-ticket.json` from before this field existed
   → confirm the trailer falls back to `n/a`, not a crash or a false
   "unconfirmed."
5. **Explicit negative test, matching the hard limit above:** simulate
   a candidate that WAS correctly logged (so `ask_provenance_confidence:
   "confirmed"`) but where the ask was still skipped (can't be
   detected by definition) — confirm this case is NOT flagged, and
   document that as expected, not a bug in the test.

## Rollback plan

Item 1: a straight text revert of the two reordered sentences, no
state or schema change.

Item 2, if built: additive only — one new log file, one new optional
`current-ticket.json` field, one new optional trailer with an `n/a`
fallback. Revert by removing the three write points; existing
`current-ticket.json`/commit data unaffected either way.
