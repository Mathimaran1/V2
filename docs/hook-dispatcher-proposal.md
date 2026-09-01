# Proposal: split the ticket-flow hook into a dispatcher + on-demand detail file

**Status: TRIED AND ROLLED BACK (2026-08-31).** This was implemented
exactly as designed below, tested live in a real Kiro session, and
**failed on cost** — the opposite of its intended effect. Full
before/after numbers and the rollback are recorded in `TODO.md`'s
2026-08-31 "dispatcher/detail-file split... FAILED, rolled back" entry.
`.kiro/hooks/aidlc-ask-for-ticket-if-missing.json` is back to its
original monolithic form; `ticket-flow-details.md` no longer exists.
The design below is kept for the record and as a warning, not as a
plan to re-attempt as-is: reading the ~30KB detail file via a tool
call was not free the way inline prompt text was, and the agent's use
of Kiro's own Task List tool to track the now-file-delivered procedure
added real overhead the "roughly the same cost" assumption below never
accounted for. Any future attempt at this needs to isolate and measure
that overhead first, not just re-shrink the inline text.

---

*(Original proposal preserved below, unedited.)*

## The problem this addresses

`.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`'s `prompt` field is
currently one instruction block, ~30KB (HARD GATE, COST GUARD,
NARRATION GUARD, the MARKER FILE rule, the PRIORITY CHECK, CASE A, CASE
C — all inline).

Per `kiro.dev/docs/hooks/actions/`, for the `Prompt Submit` trigger an
Agent Prompt hook's text is *"appended to the user prompt, and the
combined prompt is sent to the agent"* — one combined request, every
time. That means this entire ~30KB is paid for as input context on
**every single chat message**, once a ticket is tracked, regardless of
whether that turn has anything to do with tickets at all. A plain "fix
this bug" message costs the same instruction-parsing overhead as an
actual ticket switch.

`scripts/ticket-gate-fastpath.sh` already solves the *empty-ticket,
irrelevant-message* case for free (a command hook can fully block a
turn via `exit 2` before the agent hook's text is ever appended). It
cannot solve the *ticket-already-tracked, irrelevant-message* case the
same way, because blocking there would swallow the user's real request
instead of answering it — that's the finding recorded in TODO.md's
2026-08-31 cost-investigation entry (option #1, ruled out as scoped).

## Proposed design

Split the single hook prompt into two tiers:

**1. A short dispatcher prompt, inline in the hook config (target:
well under 1KB).** Always appended, every turn — this is the fixed
cost that replaces today's ~30KB fixed cost. It does only this:

- Read `.kiro/current-ticket.json` (`ticket_id`), and check whether
  `.kiro/pending-ticket-check.json` or `.kiro/pending-baseline-confirm.json`
  exist.
- Apply a short triage:
  - Either pending file exists → **read the details file, follow it.**
  - `ticket_id` is empty (shouldn't usually reach here — the fastpath
    command hook already blocks this case — but handle it if it does)
    → **read the details file, follow it.**
  - `ticket_id` is set, and the message contains anything that could
    plausibly be a ticket reference — a bare ID, a fuzzy/mistyped one,
    or a natural-language mention of one — → **read the details file,
    follow it.**
  - Otherwise (ticket tracked, message doesn't reference any ticket at
    all) → do nothing ticket-related; answer the user's actual message
    normally.
- The triage rule is deliberately biased toward "when in doubt, read
  the file" — a false positive here just costs one extra file read; a
  false negative silently disables the whole flow for that turn (see
  Failure mode below), so the dispatcher must never be tuned to be
  clever about ruling cases out.

**2. `.kiro/hooks/ticket-flow-details.md`** — today's full instruction
block (HARD GATE, COST GUARD, NARRATION GUARD, MARKER FILE, PRIORITY
CHECK, CASE A, CASE C), moved essentially verbatim into this file, read
via a tool call only when the dispatcher decides it's needed.

**Expected effect:** the common case (ticket tracked, unrelated
message) drops from ~30KB of appended instructions to a few hundred
bytes plus 2–3 small local JSON reads. The cases that actually need
ticket handling cost roughly what they cost today (dispatcher overhead
+ one file read of a similarly-sized detail doc) — this is not
expected to make real ticket-flow turns cheaper, only to stop paying
for them on turns that don't need them.

## Failure mode this introduces — must be treated as the primary risk

Today, the full procedure is unconditionally in front of the model on
every turn; it cannot "forget" to consult it. The split introduces a
new way to fail: **the dispatcher's cheap triage judges a turn as
"nothing needed" when it actually should have read the details file**
— missing a subtly-phrased ticket mention, misjudging a pending marker
as irrelevant, or just under-triggering because the triage prompt is
short by design.

This is worse than the bugs fixed earlier in this session (the
same-ticket re-baseline, the process-narration leaks), because those
were *visible* — wrong or noisy output the user could see and report.
A skipped dispatch is **silent**: the turn just answers the user's
message normally, with no sign anything ticket-related was supposed to
happen. A missed switch-detection here wouldn't surface until a much
later commit's credit numbers looked wrong, with no direct link back
to the turn that caused it.

## Required test before this ships

All cases below need to be run live in a real Kiro session (same
constraint as everything else in this repo needing live Kiro
verification — this cannot be exercised from Claude Code). For each
case, report **both** whether the details file was actually read (a
visible tool call in the transcript) **and** whether the resulting
behavior was correct — passing on cost alone without confirming
correctness is not a pass.

| # | Setup | Message | Expected |
|---|-------|---------|----------|
| 1 | Ticket tracked, no pending files | "fix this bug" | No file read. No ticket handling. Request answered normally. **This is the case that should get cheaper — confirm the credit number actually drops vs. today's baseline.** |
| 2 | Ticket tracked (e.g. ANG-4571) | "let's also look at ANG-200 while we're at it" | File read happens. C2 switch-detection fires. (Adversarial: natural-language mention, not a bare ID — checks the triage isn't only catching bare IDs.) |
| 3 | Ticket tracked | "ang - 200" (fuzzy/mistyped) | File read happens. Fuzzy-match handling fires. **This is the case most likely to be missed** — fuzzy detection needs judgment that a lightweight triage is least likely to reliably reproduce. |
| 4 | `pending-baseline-confirm.json` exists (mid profile-icon-ask) | "done" — no ticket-shaped text in the message itself | File read happens (the dispatcher must check marker-file existence, not just message content). |
| 5 | Ticket empty, fastpath already blocked the turn | (n/a — turn never reaches the dispatcher) | Confirm no double-question or redundant dispatch — the fastpath's existing block should still be the only thing that fires. |
| 6 | Full regression pass | Re-run `docs/manual-test-checklist.md` section 2 (Tickets) end-to-end against the split version | Every existing behavior holds — including the two bugs already fixed this session (same-ticket retype no longer re-baselining, no process narration) — not just the new cost-focused cases above. |

**Pass bar:** any single failure in cases 1–5 blocks shipping — per
the "silent failure" reasoning above, "mostly works" is not an
acceptable bar for a mechanism whose failure mode is invisible.

## Rollback plan

- Before making the split, keep the current monolithic
  `aidlc-ask-for-ticket-if-missing.json` content available via a
  labeled git commit (or a `.bak` copy) — not relying on `git log`
  archaeology to recover it later.
- The change touches exactly two things: the hook's `prompt` field,
  and the new `.kiro/hooks/ticket-flow-details.md` file. Nothing in
  `.githooks/*` or `scripts/*` parses or greps either file's content
  (confirmed), so nothing else depends on this exact shape — rollback
  is a straight revert of the hook file to its pre-split content plus
  deleting the new detail file. No cascading changes elsewhere.
- Given the failure mode is silent rather than loud, rollback should
  be triggered by **any single failed case** in the test table above,
  not by a majority-pass judgment call.
