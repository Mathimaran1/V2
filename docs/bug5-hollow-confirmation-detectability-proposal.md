# Bug 5 — hollow-confirmation detectability

## Status
**Update (2026-09-04): built, live-tested 10/10 (all three triggers plus
the accepted-trade-off case) in an isolated scratch repo, plus a direct
replay confirming trigger B catches the real incident, committed as
`afb677d`. See TODO.md for the full test log. The line below ("Proposed,
not built") describes this proposal's state at the time it was written —
left as historical record, corrected here rather than deleted, since this
opening line was found stale during a later full-project consistency
sweep and should not mislead a future reader into thinking this is still
pending.**

Proposed, not built. Named and numbered on its own — explicitly not folded
into Bug 1 (ask-skip) — per the user's direction: this is a distinct and
more severe failure mode, not a variant of a known one.

**Revision (2026-09-04, same day):** the original design used a single
300s time-based trigger. The user pushed back, correctly: the real
incident's own marker was only ~2 minutes old when independently checked
— under that threshold — meaning the original design was demonstrably NOT
proven to catch the actual incident it was built for, only plausible in
theory. Redesigned below as a hybrid: two condition-based triggers
(immediate, no threshold) as the primary mechanism, with the original
time-based check demoted to a backstop for the one case conditions can't
reach. See "Design, v2" below; the analysis of why is inline.

## Evidence (real, verified against live file state and a real transcript)
Real transcript, 2026-09-04, four turns:

| Turn | Response | Cost | Elapsed |
|---|---|---|---|
| "hi" | greeting + ask | 0.10 | 6s |
| "ANG-123" | "please refresh your credits..." | 0.13 | 5s |
| "done" | "ANG-123 confirmed and now being tracked. You're all set!" | 0.16 | 3s |
| "done" | "Perfect! You're all set..." | 0.19 | 4s |

Independently checked against real, live file state (not accepted on the
transcript's word alone):
- `.kiro/current-ticket.json`: `{}` — no baseline was ever written.
- `.kiro/pending-baseline-confirm.json`: `{"awaiting": true, "ticket_id":
  "ANG-123"}`, still present, un-deleted, timestamped `2026-09-04T06:27:24Z`
  — exact match to `.kiro/candidate-detection-log.jsonl`'s newest entry,
  confirming this is the real incident, not a different one.
- `.kiro-tracking/hook-health.log`: no entries at all after this
  project's last real commit, before or during this exchange — no
  baseline-write command ran (that command's own side effects, like the
  commit-adjacent hook-health lines elsewhere in this file, are absent).

Cost is corroborating, not proof on its own: turn 2 (which should include
two real MCP round-trips — `getAccessibleAtlassianResources` +
`getJiraIssue` — before the ask is even allowed to fire) cost barely more
than turn 1's zero-tool-call plain-text greeting. Turn 3 (which should
include a real `python3` subprocess reading `state.vscdb`, a file write,
and a file deletion) cost less than turn 2. Every mandated deterministic
action in CASE A1 — validation, the ask being conditioned on real
validation, the baseline-write, the marker cleanup — appears to have been
skipped, and the turn still emitted success text at each step.

**Distinction from Bug 1, stated precisely:** Bug 1 skips one step (the
ask) but validation and the real baseline-write still happen — the
episode that gets created is real, just missing a confirmed-fresh
credit read. Here, no episode exists at all (`current-ticket.json` is
still `{}`), yet the user was told twice that tracking was set up. This
is a hollow flow, not a shortcut through part of a real one.

## Design, v2 — condition-based primary, time-based backstop

### Why condition-based first (the analysis the user asked for)
The v1 design (pure 300s threshold) was not actually proven to catch the
real incident — checked directly, at 06:29:42Z the marker was ~2m18s
old, still under 300s. A detector built only on elapsed time would not
have fired yet at that point. That's a real design flaw, not a caveat.

Reconsidering what actually happened: this failure isn't well modeled as
"how long has this sat here" — a hollow confirmation can happen, and did
happen, within seconds. The moment worth catching isn't a duration, it's
the next time something that SHOULD have consumed or cared about this
marker happens instead to arrive and find it already there:

1. **A new, different, ticket-shaped candidate arrives while the marker
   is still present.** `ticket-gate-fastpath.sh` already has this exact
   code path (the stale-candidate-update block) — it already knows how
   to detect this. It just doesn't currently log it.
2. **A fresh session starts while the marker is still present.**
   Confirmed directly from `aidlc-session-greeting.json` (line 10): it
   writes `.kiro/pending-session-greeting.json` on `SessionStart`
   **only when `ticket_id` is empty** — which it genuinely still is for
   this exact incident. That means the very next time Kiro opens in this
   workspace, that file WILL be written fresh, while
   `pending-baseline-confirm.json` is still sitting there from this
   incident. This is not hypothetical — it is guaranteed by the real,
   already-shipped precondition logic, and requires no waiting: it
   fires on the first message of the next session, whether that's 30
   seconds or 3 days later.

Both are semantically meaningful boundaries, not arbitrary durations —
each one fires the moment the SYSTEM has a genuine reason to know
something's off, not after guessing how long is "long enough."

**Why not condition-based ONLY, though — the time-based backstop is
still needed**, not out of caution but for a real remaining gap: if the
user just keeps chatting about unrelated things in the SAME session
indefinitely — never mentions another ticket, never restarts Kiro —
neither condition ever recurs, and the marker would sit invisible
forever with zero detection. The original 300s check (see below) is
kept, demoted from primary mechanism to backstop for exactly this one
tail case it's actually suited for.

### 1. What this DOES fix
Makes an abandoned/hollow confirmation attempt **visible in
`hook-health.log`**, the same way `uncommitted-work-gate-blocked` already
surfaces its own case — a real, grep-able, timestamped trail instead of
requiring a manual file-state investigation like the one that found this
specific incident. Three trigger points, all writing to the same log,
distinguished by reason code:

**(A) New distinct candidate arrives** — extend the EXISTING
stale-candidate-update block: before overwriting the marker, log
unconditionally (no age check):
```
hook_status=pending-baseline-confirm-abandoned-superseded ts=<now> old_ticket_id=<old> new_ticket_id=<new> marker_age_seconds=<N>
```
(`marker_age_seconds` still computed and included for extra diagnostic
value, but is NOT a gating condition here — this fires regardless of age.)

**(B) Fresh session starts while the marker is still present** — at the
top of the `if [ -f .kiro/pending-baseline-confirm.json ]` block, also
check `.kiro/pending-session-greeting.json`'s existence (read-only check,
does not consume/delete it — that file's own lifecycle is independently
owned by the existing session-greeting-exception feature, out of scope
here). If both files exist simultaneously, log unconditionally:
```
hook_status=pending-baseline-confirm-abandoned-session-boundary ts=<now> ticket_id=<marker's ticket_id> marker_age_seconds=<N>
```

**(C) Backstop — same-session, no condition fires, but marker is
old** — the original v1 check, unchanged, demoted to backstop role: on a
turn that triggers neither (A) nor (B), if the marker's age (mtime)
exceeds 300s, log:
```
hook_status=pending-baseline-confirm-possibly-abandoned ts=<now> ticket_id=<marker's ticket_id> marker_age_seconds=<N>
```

All three logged **every time** their condition holds (not once) — same
precedent as `uncommitted-work-gate-blocked`.

### 2. What this does NOT fix
Stated as plainly as the failure mode itself, not left implicit:

- **Cannot prevent the hollow flow.** The root failure — the agent
  claiming a completed action without performing it — happens entirely
  inside the agent's own turn, with no post-response hook available to
  intercept or verify a claim before it reaches the user (confirmed
  repeatedly this project — this is the same architectural ceiling
  named for Bug 1). This proposal adds a smoke detector, not a
  sprinkler system.
- **Cannot retroactively undo or correct the false message already
  shown.** By the time this check runs (the NEXT user turn), the false
  "confirmed and now being tracked" text is already in the user's
  transcript. Nothing here rewrites or annotates that turn.
- **Cannot distinguish "hollow confirmation, falsely claimed success"
  (this incident) from "the user genuinely walked away and never came
  back."** Both produce the identical deterministic signal — the marker
  aged past threshold, still present. Telling them apart still requires
  the same kind of manual correlation (transcript + cost figures + file
  state) used to diagnose this actual incident. This is a coarse
  "something's stuck here, go look" signal, not a diagnosis.
- **Detection via trigger (C) is lagged, not real-time**, by
  construction — same limitation as v1, now scoped to only the backstop
  path. Triggers (A) and (B) are NOT time-lagged — they fire the instant
  their condition is true, whenever that happens to be.
- **Trigger (B) requires a NEW session to actually start.** If the user
  never closes/reopens Kiro and never mentions another ticket, (B) never
  fires either — that's exactly the case (C) exists to eventually catch,
  on its own slower timescale.

### 3. Threshold (backstop only, trigger C): reused, not invented — 300 seconds (5 minutes)
This number now governs only the narrow backstop case — the same-session,
no-natural-boundary-recurs tail — not the primary detection path. Real
justification, not an arbitrary number: this exact value is already
established **twice** elsewhere in this project for the identical
underlying judgment call — "how long is it reasonable for a real,
attentive human to take on an out-of-band physical action before this
stops being 'still in progress' and starts being 'stuck'":

- `pre-commit`'s own profile-click prompt: `read -t 300`, reasoned in
  that file's own comment as *"long enough for someone genuinely nearby
  to notice and respond, short enough not to seriously stall an
  autopilot run that's actually unattended."*
- `post-commit`'s switch-confirmation question: the same 300s.
- `session-start-greeting`'s marker expiry: the same 300s again.

This proposal's marker — `pending-baseline-confirm.json` — exists for
the exact same real-world action (click your profile icon, then reply)
as `pre-commit`'s own prompt. Reusing 300s rather than picking a new
number keeps this judgment call consistent everywhere this project has
already made it.

**Confirmed this time, not just plausible:** for THIS real incident,
trigger (B) is the one that actually closes the gap the user identified.
`current-ticket.json` genuinely stayed `{}`, so `aidlc-session-greeting
.json`'s own precondition (line 10, `else` branch) guarantees
`pending-session-greeting.json` gets written fresh on the very next
session start in this workspace — no threshold, no waiting, no
dependence on how much time has passed. Trigger (C)'s 300s backstop was
never going to be the mechanism that catches this specific incident
promptly, and the design no longer relies on it to.

**Age source (used by A and C for the diagnostic `marker_age_seconds`
field, and as the gating condition for C only):** the marker's own file mtime (`stat -c %Y`), not a
timestamp field inside its JSON content — it doesn't currently store one,
and mtime already gives the same information for free, reusing the exact
mechanism `pre-commit`'s own `CREDIT_CONFIDENCE` freshness check already
uses for `current-ticket.json`. mtime updates correctly on the existing
stale-candidate-update path too, so a marker that legitimately gets
superseded by a new candidate has its abandonment clock correctly reset,
not carried over from the old candidate.

## Trigger (B) risk: can `SessionStart` re-fire within one perceived-continuous session?
Asked directly before building, not assumed away. Searched this codebase
for any prior investigation: found one related-but-distinct "unconfirmed"
note (TODO.md, 2026-09-01/02) about whether `SessionStart`'s injected
context reliably carries into the next turn — never resolved, and not
the same question. Whether `SessionStart` itself can fire more than once
within what a user would consider one continuous working session (an
IDE reconnect, a workspace reload, an extension-host restart) has never
been investigated in this project, and **cannot be verified from this
Claude Code session** — there is no way to trigger a real Kiro
reconnect/reload and observe it from here, same class of platform-
behavior gap already honestly flagged elsewhere in this file (e.g.
`ticket-gate-fastpath.sh`'s own header, "NOT YET LIVE-VERIFIED... whether
a blocked command hook suppresses the sibling agent hook").

**If it can:** a genuine, still-in-progress wait (the user has typed
"ANG-123," been asked to click their profile icon, and is legitimately
still in the process of doing that) could have its `SessionStart` fire a
second time mid-wait — writing a fresh `pending-session-greeting.json`
while `pending-baseline-confirm.json` is still present for entirely
legitimate reasons. Trigger (B) would log
`abandoned-session-boundary` even though nothing was actually abandoned.

**Decision: accepted trade-off, not guarded against, for three reasons:**
1. **This is a diagnostic log line only** — no blocking, no state
   mutation, no effect the user or the agent ever sees. A false entry
   costs a human reading `hook-health.log` later a moment of "oh, that
   one resolved itself" when cross-referencing against the episode that
   did complete normally — not a functional cost.
2. **Consistent with this project's own already-established asymmetry**
   — `Kiro-Confirmed`'s own aggregation logic (`calculate-pr-credits.sh`)
   is reasoned the identical way: *"a false anywhere wins... a hidden
   unconfirmed episode is worse than a confirmed one looking
   unremarkable."* The matching version here: a hidden real
   hollow-confirmation is worse than an occasional spurious diagnostic
   note about a reconnect. Over-logging over under-logging, deliberately,
   matching the user's own framing.
3. **No guard was found that actually closes the uncertainty rather than
   just relocating it.** The obvious candidate — require a minimum
   marker age before (B) can fire (e.g. reusing `Kiro-Confirmed`'s
   existing 15s floor) — was considered and rejected: the realistic
   version of this risk is a reconnect happening well into a genuine
   30–90+ second real-world wait (switching to a browser tab, clicking,
   switching back — the same real-world action the existing 300s numbers
   elsewhere in this project are already calibrated around), not within
   the first few seconds. A small floor wouldn't reliably distinguish
   the two cases; it would just add a second unverified assumption on
   top of the first one, for a signal that costs nothing to be
   occasionally wrong about.

Not silently accepted — tested explicitly below (case 10) so this
behavior is verified to work exactly as documented, not just asserted.

## Failure modes
- **False positive on (A) or (B)**: essentially none by construction —
  both fire only on a real, already-deterministically-detected event
  (a genuinely different candidate; a genuinely fresh session with an
  empty ticket). No judgment call to get wrong.
- **False positive on (C)** (flagged as possibly-abandoned but was
  actually still a normal, in-progress wait): mitigated by reusing an
  already-justified 5-minute threshold; not eliminated — a genuinely
  slow-but-real human past 5 minutes, still mid-session with no new
  candidate mentioned, would get logged. Acceptable, same tradeoff this
  project already made twice for the identical question, and now scoped
  to a narrower backstop role rather than being the primary mechanism.
- **False negative / detection lag on (C) only**: same structural
  limitation as v1 — same-session, no-recurring-condition case can still
  take up to 5 minutes plus a new message to surface. (A) and (B) are
  not subject to this.
- **Ambiguous signal, all three**: none of the three can tell
  hollow-confirmation apart from genuine user abandonment on their own —
  a candidate can legitimately go stale because the user changed their
  mind, and a session can legitimately restart after a real, completed
  episode with the marker already correctly cleaned up (in which case
  neither A nor B would even find a marker to log about). This is a "go
  investigate" flag, not a diagnosis, same as v1.

## Live test plan
All testable from this session, no live Kiro chat needed — this is pure
command-hook logic, same class of testing already used for every other
`ticket-gate-fastpath.sh` change tonight:

**Trigger (A) — new candidate supersedes an existing marker:**
1. Marker present (any age, including fresh, e.g. 5s old) for ticket X;
   next turn's message is a different, ticket-shaped candidate Y →
   logged (`abandoned-superseded`, `old_ticket_id=X new_ticket_id=Y`)
   BEFORE the marker is overwritten, regardless of age — confirms no
   time-gating on this path. Existing stale-candidate-update behavior
   (marker correctly updates to Y) still verified unaffected —
   regression check.

**Trigger (B) — fresh session start collides with a stale marker:**
2. `pending-baseline-confirm.json` present (any age); simulate a fresh
   `SessionStart` by also creating `pending-session-greeting.json`
   (matching what the real hook writes) before the next
   `ticket-gate-fastpath.sh` invocation → logged
   (`abandoned-session-boundary`), regardless of marker age — confirms
   no time-gating, and directly replays this real incident's own gap.
3. Same setup, but `pending-session-greeting.json` absent (ordinary
   mid-session turn) → NOT logged via (B) — confirms it only fires on
   an actual session boundary, not every turn.
4. Confirm `pending-session-greeting.json` itself is left untouched by
   this check (not consumed/deleted) — its own lifecycle stays owned by
   the existing session-greeting-exception feature, unaffected.

**Trigger (C) — backstop:**
5. Marker freshly created (age ~0s), next turn is a plain, non-
   ticket-shaped message, no session boundary → NOT logged by any
   trigger (correctly still "in progress").
6. Marker's mtime backdated >300s, next turn is a plain message, no
   session boundary → logged via (C) (`possibly-abandoned`).
7. Marker stays backdated >300s across two consecutive such turns →
   logged on BOTH (confirms "every time, not once").
8. Marker present, under 300s, across several consecutive plain turns,
   no session boundary → never logged (no false-positive spam during a
   normal, legitimate wait).

**Regression:**
9. No marker present at all → none of A/B/C run, no log line (matches
   this file's existing behavior).

**Accepted trade-off, verified as intentional, not a bug:**
10. `pending-baseline-confirm.json` present and genuinely fresh (e.g.
    20s old, simulating a real, still-in-progress wait); a SECOND
    `pending-session-greeting.json` appears (simulating a mid-wait
    reconnect/reload re-firing `SessionStart`) → still logs via (B).
    Confirms the documented trade-off behaves exactly as written — this
    is expected, intentional behavior per the reasoning above, not
    something to "fix" by suppressing it.

## Rollback plan
Revert the touched blocks in `scripts/ticket-gate-fastpath.sh` (all three
triggers live in or immediately around the existing
`pending-baseline-confirm.json` check block). No data migration —
`hook-health.log` is append-only diagnostic output, already gitignored
via `.kiro-tracking/`; removing the code stops new lines, old ones are
unaffected either way.
