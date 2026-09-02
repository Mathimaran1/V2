# Proposal: a persistent, non-decaying `Kiro-Confirmed` signal, replacing reliance on marker-file cleanup

**Status: PROPOSAL ONLY — not implemented.** Priority, per explicit
instruction — the problem this responds to is presenting false
confidence about stale data, not a cosmetic gap.

## Why the existing signal isn't enough

`Kiro-Confidence` (`.githooks/pre-commit`) is a rolling time window: it
reads `low` for roughly the first 5 minutes after a baseline is
written, then reads `high` once enough time has passed — regardless of
whether anyone ever actually confirmed the baseline honestly. Real
test (`4085b0e`, 2026-09-02) confirmed it correctly reads `low` for a
commit made ~3 minutes after a confirmed-skipped-ask baseline. But a
commit made 10 minutes later, against that exact same never-confirmed
baseline, would very likely read `high` — the window simply closed. A
system that shows confident-looking data on a delay, for something
that was never actually confirmed, is worse than one that visibly
never resolves the question: it invites trusting a number that was
never earned.

## Feasibility investigated first — the naive idea doesn't hold up

The obvious idea: check whether `.kiro/pending-baseline-confirm.json`
was created *and properly cleaned up* for a given episode, as a proxy
for "the ask-and-wait cycle actually ran." Investigated with real
evidence before designing around it, per instruction — and it fails:

- **Episode `ep_6a97c11a251f2f`** (this session's confirmed 3rd
  ask-skip): marker checked directly, currently **absent** — cleaned
  up despite the ask having been skipped.
- **An earlier confirmed occurrence** (`TODO.md`, "a THIRD
  marker-related failure variant"): marker was **left behind**, with a
  stale, mismatched `ticket_id`, after a different skipped ask.

**Two confirmed instances of the identical underlying failure produced
opposite marker states.** The marker's cleanup is itself agent-prose
behavior (the "delete the marker" instruction), and it's exactly as
unreliable as the ask instruction it was meant to support. Whether the
marker is left behind or cleaned up tells you nothing about whether
the ask happened — it only tells you whether *that specific, separate*
prose instruction happened to fire this time. Building the new signal
on top of it would just be relocating the same reliability gap one
file over.

## The design that actually works: a time-delta between two facts the command hook already produces reliably

Two things ARE fully deterministic and already proven tonight:

1. **The moment a candidate is first detected** — the command hook
   already writes/updates `pending-baseline-confirm.json`'s
   `ticket_id` at this exact instant, reliably (marker fix, `3f0da3a`
   + `469ac6e`), regardless of what the agent does afterward.
2. **The moment a baseline is actually written** — `episode_started_at`
   in `current-ticket.json`, written by the agent's own credit-read
   command, using the real system clock at write time (this value's
   accuracy has never been the failure point in anything found
   tonight — only the *process leading up to* the write has been).

**The insight: a genuine ask-and-wait round trip takes real, human
time — reading a question, clicking a profile icon, typing a reply.**
A skipped ask means the agent goes from "candidate detected" straight
to "baseline written" within the same turn, with no intervening
message. The gap between these two timestamps is a structural signal
that doesn't depend on the agent's own self-reporting or cleanup
behavior *at all* — it only depends on two timestamps the system
already produces independently of each other.

### Mechanism

**A new, agent-invisible log — the agent never reads, writes, or is
even told about this file, so it can't be inconsistently affected by
agent behavior the way the marker was:**
`.kiro/candidate-detection-log.json` (or similar), append-only, one
entry per candidate detection: `{"ticket_id": "ANG-123", "detected_at":
"<ISO timestamp>"}`. Written by the command hook at the exact same 3
points that already write/update `pending-baseline-confirm.json`
(exact-match, fuzzy-match, and the stale-marker auto-update) —
reusing, not duplicating, logic that's already proven.

**Computed once per episode, cached, not re-evaluated every turn —**
at the existing `CURRENT_TRACKED_TICKET` branch, the first time
`ticket_id` is non-empty and `current-ticket.json` doesn't yet have
this field: look up the most recent detection-log entry for this exact
`ticket_id` at or before `episode_started_at` (matching by recency
handles a ticket typed across multiple separate episodes correctly).
Compute the delta. Write the result into `current-ticket.json` as a
new field, permanently — this becomes part of the episode's own
record, the same way `credits_at_ticket_start` is, not something that
can later drift as time passes.

**Two trailers, not one — the raw fact and the derived judgment kept
separate, because the derived judgment depends on a threshold that
cannot be validated before real data exists to validate it against:**
```
Kiro-Confirmed-Gap-Seconds: <number> | n/a
Kiro-Confirmed: true | false | n/a
```
`Kiro-Confirmed-Gap-Seconds` is the raw, unconditional delta — always
recorded whenever a detection-log entry is found, regardless of any
threshold, and never wrong in the way a boolean classification could
be. `Kiro-Confirmed` is derived from it against the threshold (see
below — shipped with this build, but explicitly provisional, not
finally calibrated). `n/a` on either trailer means the same thing: no
matching detection-log entry was found (the coverage gap below, or a
pre-existing episode) — there was nothing to compute a delta or a
classification from.

### The threshold — answered directly, not asserted as a round number

**How it will actually be calibrated, not a one-time guess:** this
build ships with a working threshold (so the full mechanism is
buildable and testable now, not left half-wired), but the threshold
itself is explicitly labeled provisional, not final, and calibration
is a defined follow-up step, not an assumption that the first number is
right:

1. **This build:** the log-writing, unconditional gap-seconds
   recording, AND the `true`/`false` classification all go live, using
   a threshold stored as one named, tunable constant (at the top of
   the compute-and-cache block, not buried inline) — 15 seconds,
   chosen from this session's own observed real single-turn timings
   (4–50 seconds) as a starting bound, explicitly commented as
   `PROVISIONAL — not yet calibrated against real occurrences, see
   docs/kiro-confirmed-persistent-signal-proposal.md`.
2. **Calibration (follow-up, after this ships):** the next several live
   occurrences — both genuine ask-completions and any further skips —
   get cross-checked directly: read `Kiro-Confirmed-Gap-Seconds` off
   the real commit, compare it against what the actual transcript shows
   happened. The same "confirmed live" evidence standard as every other
   bug found tonight, applied to calibration instead of a bug report.
   The threshold constant gets adjusted then, with real justification,
   not re-guessed.
3. **Because the raw seconds value is recorded unconditionally
   regardless of the threshold**, a wrong provisional value doesn't
   lose or corrupt any data — recalibrating later is moving one number
   and does not require touching historical records, which already
   hold the real, unrounded gap.

**Getting it wrong in either direction, named explicitly, matching the
concern raised:** too low, and a same-turn skip that happened to
involve several internal tool calls (Jira validation, credit read) could
cross the bar and read `true` — a false confirmation. Too high, and a
genuinely fast real reply could read `false` — a false skip report.
Because the raw seconds value is always recorded regardless of where
the threshold ends up, a wrong threshold is a `Kiro-Confirmed`-only
problem, correctable by moving one number, not a re-instrumentation —
the underlying data was never lost or approximated away.

### Coverage gap, named honestly

This log only gets written at the 3 points already covered by the
marker mechanism — CASE A1's exact/fuzzy detection. CASE C1
(mid-session switch) and the PRIORITY CHECK (post-commit's deferred
typed-ticket flow) establish baselines too, but through different code
paths this proposal doesn't touch. Episodes from those paths would
read `Kiro-Confirmed: n/a` until extended — an honest "unknown," not a
wrong answer, but real coverage this proposal doesn't close in its
first version.

## Does anything actually read this trailer, and does it handle `n/a` correctly? — answered directly, not asserted

**Checked directly, not assumed:** grepped the whole repo for every
script that reads any `Kiro-*` trailer. Exactly one does:
`scripts/calculate-pr-credits.sh` (`ticket-gate-fastpath.sh` only
*writes* trailer-adjacent fields, never reads them back). Right now,
`calculate-pr-credits.sh` doesn't reference `Kiro-Confirmed` at all —
it doesn't exist yet — so there is currently no silent-default risk
anywhere, because nothing consumes the field. That changes the moment
this ships, so the script needs its own explicit handling as part of
this same build, not left as a future unknown.

**This project already has a proven, exact pattern for this — reuse
it, don't invent a new one.** `calculate-pr-credits.sh` already solves
the identical problem for `Kiro-Elapsed-Minutes`: a presence *sentinel*
(`ELAPSED_PRESENT`), tracked as a separate column from the value
itself, so the aggregation `awk` step can tell "no data for this
commit" apart from a real reading — and the final output explicitly
prints `n/a minutes` for a ticket with zero elapsed data anywhere in
its history, rather than defaulting to 0 or dropping the ticket
silently.

**Applied the same way here, as part of this build (not deferred):**
add a `CONFIRMED_PRESENT` sentinel column alongside a new
`CONFIRMED` column in the same per-commit loop, using the identical
"blank or `n/a` → sentinel 0" rule already used for elapsed minutes.
In the final report per ticket: if every commit for that ticket read
`n/a`, report `Kiro-Confirmed: n/a` for the ticket as a whole,
distinct from reporting it as confirmed or unconfirmed. If any commit
for that ticket has a real `true`/`false` reading, report the most
informative one for a human skimming ticket-level output — e.g.
`unconfirmed baseline` if *any* episode for that ticket reads `false`
(worth surfacing prominently, matching this proposal's whole point:
false confidence is worse than a visible gap), otherwise `confirmed`
if all present readings are `true`, otherwise `n/a` if none are
present at all. This is additive to the script's existing per-ticket
credits/minutes line, not a rewrite of it.

## What this does NOT claim

Still cannot force the ask to happen — no proposal tonight has
found a way to do that. What changes is that a skipped ask, once it
happens, leaves a *permanent, non-decaying* mark on that episode's
record — `Kiro-Confirmed: false` doesn't expire the way `Kiro-
Confidence: low` does. This is detection and permanent record-keeping,
not prevention — the same honest distinction already drawn for the
earlier (different, shelved) confidence-flag idea, but this version is
actually built on a signal proven to be reliable, not one shown tonight
to be inconsistent.

## Live test plan (once approved)

Real file state checked after every case.

1. **Genuine gap simulated** — write a detection-log entry, wait past
   the threshold (or backdate it), then establish a baseline for that
   same ticket. Confirm `Kiro-Confirmed: true`.
2. **Same-turn write simulated** — detection-log entry and baseline
   write timestamped within the threshold of each other. Confirm
   `Kiro-Confirmed: false`.
3. **No detection-log entry at all** (simulating a CASE C1/PRIORITY
   CHECK-established baseline). Confirm `Kiro-Confirmed: n/a`, not a
   crash and not a false `true`/`false`.
4. **Multiple episodes, same ticket ID, re-detected later** — confirm
   the recency-based match picks the correct detection entry for the
   *current* episode, not a stale one from a much earlier episode.
5. **Computed once, not every turn** — confirm a second commit against
   the same episode doesn't recompute or overwrite an already-set
   `Kiro-Confirmed` value.
6. **Replay of this session's actual 3rd occurrence**, as closely as
   reproducible: detection and baseline-write timestamps effectively
   simultaneous. Confirm `Kiro-Confirmed: false` — this is the case
   that most directly motivated the proposal, so it needs to be tested
   directly, not just covered by the generic case 2.
7. **`Kiro-Confirmed-Gap-Seconds` recorded correctly** in both the
   true and false cases above — real evidence the raw value survives
   independent of the threshold, not just the derived boolean.
8. **`calculate-pr-credits.sh`'s `n/a` handling** — a ticket where
   every commit reads `n/a` reports `n/a` at the ticket level, not a
   silent default to confirmed or unconfirmed; a ticket with a mix of
   `true` and `false` readings surfaces the `false` case prominently
   (per the "false confidence is worse than a visible gap" reasoning
   this whole proposal is built on); the existing credits/minutes
   output for that ticket is unchanged, this is purely additive.

## Rollback plan

Additive only: one new append-only log file, one new `current-
ticket.json` field (computed once, optional), two new trailers with
`n/a` fallbacks, and one additive extension to `calculate-pr-
credits.sh`'s existing per-ticket loop (reusing its own established
presence-sentinel pattern, not a new one). No existing field renamed
or removed; `Kiro-Confidence` is untouched. Revert by removing the 3
log-write points, the one compute-and-cache block, and the script
extension; existing commits and `current-ticket.json` unaffected
either way.
