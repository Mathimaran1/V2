# Proposal: shrink chat's job to validation only (Idea 2)

**Status: PROPOSAL ONLY — not implemented.** Nothing in `.kiro/` or
`.githooks/` has changed to reflect this.

## The idea as given

Today chat does four things per ticket switch: ask which ticket →
validate it → capture the credit baseline → write
`current-ticket.json`. That's the whole reason it costs a full turn
each for the ask, the refresh-wait, and the capture. Proposed: move
everything except validation out of chat, into free git-hook/terminal
logic that already asks "switching tickets?" for free in
`post-commit`.

## Feasibility — the three questions asked, answered with evidence

**1. Can baseline capture genuinely run outside chat?**

Yes — **already proven, already shipping**, not hypothetical. Read
`.githooks/post-commit` directly: its `"none"` switch path already
does the *exact* thing this idea proposes for real tickets — reads
`state.vscdb` via the same `python3`/`sqlite3` snippet used everywhere
else in this project, generates a fresh `episode_id`, and writes
`current-ticket.json`, entirely from a terminal git hook, zero agent
involvement, zero credits. This isn't a new mechanism to build; it's
extending one that's already running in production for one code path
(`"none"`) to also cover real tickets once they're validated.

**2. How does the validation result get from chat back to a hook?**

Also already proven, by the exact same file — `post-commit`'s switch
flow already writes `.kiro/pending-ticket-check.json`
(`{"typed_ticket": "...", "flagged_at": "..."}`) for chat to pick up
and validate later. This proposal is the same handoff run in reverse:
chat writes a small validation-result file
(`.kiro/ticket-validated.json`: `{"ticket_id": "ANG-123", "valid":
true, "validated_at": "..."}`) instead of doing the baseline capture
itself, and something outside chat reads it and finishes the job.

**3. Does this actually save turns, or just relocate them — be honest
if the answer is "it doesn't help."**

Here's the part that needs to be said plainly, per your own
instruction: **as literally scoped (a *git hook* reading the
validation result), this is functionally the same open question as
option #3** (moving baseline capture to first-commit time), which you
put on hold specifically because it changes what
`credits_at_ticket_start` measures — from "when the ticket was
selected" to "whenever the next commit happens." If the git hook doing
the pickup is `pre-commit`, baseline capture doesn't happen until the
next commit, exactly the timing shift #3 raised, just arrived at by a
different route. This should not be built under the "shrink chat"
framing while #3 itself is still on hold for evidence — that would be
making the same decision twice under two different names.

**A stronger alternative that avoids this problem entirely, found
while investigating:** don't wait for a git hook at all — do the
pickup in `scripts/ticket-gate-fastpath.sh` (the command hook, which
already runs on every chat message, for free, before the agent hook).
Concretely:

- Chat's job shrinks to *only*: "is this ticket ID real, yes or no?"
  — one small turn, no refresh-ask, no baseline capture, no file
  writing beyond the tiny validation-result file above.
- On the **next** `UserPromptSubmit` (i.e. your very next chat
  message, not your next commit), the command hook sees
  `.kiro/ticket-validated.json` exists and no refresh has been asked
  yet: it blocks (`exit 2`, the same proven mechanism CASE A2 already
  uses) with *"Please click your profile icon to refresh your credits,
  then send any message to continue"* and writes a marker.
- On the message after that, the command hook sees the marker, treats
  **any** reply as confirmation (same as `pre-commit`'s terminal
  `read -p ... press Enter` — it doesn't require agent judgment about
  whether the reply counts, it just needs *a* reply), runs the same
  `python3`/`sqlite3` baseline read, writes `current-ticket.json`,
  deletes both marker files, and — critically — still lets that same
  message through (`exit 0`) so the user's actual request gets
  answered normally in the same turn, not swallowed.

This keeps baseline timing tied to **ticket-selection time** (same
meaning as today, no #3-style semantic change) while moving the
ask-refresh-wait-capture-write sequence entirely into zero-cost
command-hook territory. Combined with the validation cache proposal
(a cache hit means even the "is it real" question doesn't need the
agent), this is a meaningfully bigger win than either idea alone —
possibly eliminating agent-turn cost for a ticket switch almost
entirely on a cache hit, and cutting it to one small validation-only
turn on a cache miss.

## Estimated savings

For the git-hook-at-commit-time version as literally scoped: savings
would be real but come bundled with #3's unresolved measurement
question, so no clean number until that's settled — not recommending
this variant.

For the command-hook variant: the refresh-ask and capture-and-write
turns currently cost ~0.48 and ~0.89 credits (from the real `ANG-123`
switch transcript earlier this session) — both would move to $0.
Chat's remaining job (validate only) should cost roughly what a
no-tool-call turn costs today (~0.09–0.10 credits) when combined with
the cache proposal, or one Jira-validation turn's cost
(~0.62–0.78 credits, no baseline/write work bundled in) on a cache
miss. Total for a full switch, cache miss: roughly 0.7 credits instead
of ~2.06 — a bigger reduction than the cache alone.

## Failure mode

The multi-step marker-file handoff (validated → ask → confirm →
capture) run entirely in a command hook is new *mechanically*, even
though every individual piece (blocking, marker files, python3 credit
reads) is separately proven elsewhere in this project. The real risk
is a marker left behind on an interrupted flow (same class of bug
already found and fixed once this session for
`pending-baseline-confirm.json`) silently disabling either the
fastpath's CASE A2 behavior or a future ticket flow. Needs the same
"every exit path deletes its markers" discipline already established
in this repo, applied to a new script instead of the agent prompt.

## Live test plan

1. Validate a new ticket in chat — confirm chat's response is *only*
   the validation outcome, no refresh-ask, no file writes beyond
   `ticket-validated.json`.
2. Send any next message — confirm the command hook blocks with the
   refresh-ask (not the agent).
3. Send any message after that — confirm baseline gets captured,
   `current-ticket.json` written, both markers deleted, **and** that
   original next message still gets answered (not swallowed).
4. Interrupt the flow deliberately (abandon after step 1, start a
   different unrelated ticket flow) — confirm no marker gets stuck
   disabling the fastpath's other behavior.
5. Compare real credit numbers for a full switch against this
   session's ~2.06-credit baseline.

## Rollback plan

Confined to `scripts/ticket-gate-fastpath.sh` (the new marker-handling
logic) and a much smaller hook-prompt change (chat's job shrinks to
validation only — a subtraction from the existing prompt, not a
restructure). No git-hook changes needed for the command-hook variant,
so `.githooks/*` stays untouched. Revert is deleting the new markers
and restoring the fastpath script and hook prompt to their current
(already-working) versions.
