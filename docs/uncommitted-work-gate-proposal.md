# Uncommitted-work gate before ticket switches

**Status: IMPLEMENTED** (2026-09-01, ANG-4571). Changes live in three
files: `scripts/ticket-gate-fastpath.sh`, `.githooks/post-commit`, and
`.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`.

## The gap this closes

A ticket switch overwrites `current-ticket.json` with a fresh
`episode_id` for the new ticket. If the user has uncommitted changes in
the working tree at that moment, those changes were done under the OLD
ticket's episode — but the next `git commit` will stamp the NEW
ticket's episode ID in its trailers. The credits and time spent on that
work get attributed to the wrong ticket, silently.

This is distinct from the pre-switch *bookkeeping* commit gate (see
`docs/pre-switch-commit-proposal.md`), which ensures the old episode's
credit delta makes it into at least one commit trailer before the
baseline is overwritten. That gate handles the tracking-data side; this
one handles the user's actual uncommitted *work*.

## Design: three insertion points, same check

Every path that can switch tickets now runs `git status --porcelain`
first. If the output is non-empty (any staged or unstaged changes),
the switch is blocked and the user is told to commit or stash first.

### 1. `scripts/ticket-gate-fastpath.sh` (code-enforced, deterministic)

**Two separate checks, covering both the C2 detection turn and the C1
confirmation turn:**

**Check 1a — C2 detection turn (added second pass, 2026-09-01):** Before
the `CURRENT_TRACKED_TICKET` exit, when `ticket_id` is set. Extracts
ticket IDs from the user's prompt via `grep -oE '\b[A-Z][A-Z0-9]*-[0-9]+\b'`,
checks if any differ from the current `ticket_id`, and if so runs
`git status --porcelain`. Blocks with `exit 2` if dirty. This catches
the switch at the *earliest possible moment* — the same turn the user
first mentions a different ticket — before `pending_switch_to` is even
written. Confirmed via live testing that the agent's behavioral C2
instruction was skipped; this code-enforced version cannot be.

**Check 1b — C1 confirmation turn (original):** Inside the
`if [ -n "$PENDING_SWITCH_TO" ] && [ -n "$EPISODE_ID" ]` block, before
the existing pre-switch bookkeeping commit gate. Runs on every
`UserPromptSubmit` where a switch is already pending. Blocks with
`exit 2` if dirty. This is the fallback for any case where check 1a
didn't fire (e.g. `pending_switch_to` was written by a prior session
that didn't have this check).

Both are real shell script checks — not AI behavioral instructions.

### 2. `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json` (agent-side, CASE C2)

In the agent hook prompt, at the point where CASE C2 first detects a
mid-conversation switch intent (a different ticket ID mentioned in the
user's message). The instruction tells the agent to run
`git status --porcelain` BEFORE writing `pending_switch_to` or asking
the switch-confirmation question.

This catches the switch one step earlier than #1 — at the moment of
detection, before `pending_switch_to` is even written. If dirty, the
agent warns the user and does not proceed with the switch flow at all.

**Honest limit:** this is a behavioral instruction to the AI, not
code-enforced. The agent could in principle skip it, the same way it
has skipped other mandatory steps before (see TODO.md). The fastpath
check (#1) is the backup that actually blocks deterministically.

### 3. `.githooks/post-commit` (terminal-based, immediate "none" switch)

In the `elif [ "$NEW_TICKET" = "none" ]` branch — the only path in
post-commit that switches `current-ticket.json` immediately without
deferring to the agent hook. Before reading the credit baseline and
writing the new episode, checks `git status --porcelain`. If dirty,
warns and aborts the switch (current-ticket.json left untouched).

The deferred path (a real ticket ID typed at the terminal) doesn't need
this check here — it writes `pending-ticket-check.json` and defers
validation to the agent hook, where checks #1 and #2 already cover it.

## What is NOT checked

- **Post-checkout** (`post-checkout` clears `current-ticket.json` to
  `{}` on branch switch): not checked. The checkout has already
  happened by the time this hook fires — the working tree state
  reflects the new branch, not leftover uncommitted work. And a branch
  switch that leaves dirty files is git's own responsibility to warn
  about (it does, or refuses the checkout).

- **PRIORITY CHECK path** (validating a `pending-ticket-check.json`
  from post-commit's deferred switch): not checked at the agent-hook
  level specifically, but IS covered by check #1 in the fastpath — the
  fastpath runs on every `UserPromptSubmit`, and if `pending_switch_to`
  happens to be set alongside a pending-ticket-check, the dirty-files
  block fires before the agent hook even sees the message.

## Testing

- All three modified scripts pass `bash -n` syntax checks.
- The agent hook JSON passes `json.load()`.
- Live simulation with a dirty working tree (the changes from this
  very task) confirms `git status --porcelain` produces output and the
  check correctly identifies dirty files.
- Logic ordering verified: in all three paths, the dirty-files check
  runs before the switch action (baseline write, `pending_switch_to`
  write, or `exit 2` block).
