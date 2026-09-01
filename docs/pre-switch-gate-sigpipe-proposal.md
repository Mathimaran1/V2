# Proposal: fix the pre-switch commit gate's SIGPIPE false-negative

**Status: PROPOSAL ONLY — not implemented.** Nothing in `scripts/` has
changed to reflect this.

## The bug, precisely, not just "a race"

`scripts/ticket-gate-fastpath.sh`'s pre-switch commit gate (`b222d80`)
decides whether to auto-commit with:
```bash
if ! git log --format='%(trailers:key=Kiro-Episode,valueonly)' \
    | grep -qxF "$EPISODE_ID"; then
  KIRO_AGENT_COMMIT=1 git commit --allow-empty ...
fi
```
under `set -euo pipefail` (line 47). This was flagged in `TODO.md`
(2026-09-01) after two real commits (`9e9a602`, `7916316`) landed for
the identical episode 47 seconds apart in the user's live Kiro session
— the second one should have found the first's own trailer and
skipped, and didn't.

**Root cause, confirmed by direct reproduction, not lock contention as
originally guessed:** `grep -qxF` exits the instant it finds a match.
The target trailer is always at or near the *top* of `git log`'s
newest-first output — it's the trailer the gate itself just committed
on the prior invocation. `grep` closing its end of the pipe while
`git log` is still writing the rest of the repo's history triggers a
real `SIGPIPE` in `git log`. Confirmed directly via `PIPESTATUS`:
**`git log` exits 141 (128+SIGPIPE), `grep` exits 0 (found).** Under
`pipefail`, a pipeline is reported as failed if *any* stage exits
non-zero — not only the rightmost — so this reports as failure even
though `grep` correctly found the match. The `if !` branch then reads
that as "episode not found yet" and commits again.

**Reproduced 55/55 times** across two independent setups: a synthetic
3000-commit repo, and the real repo at its actual size (64 commits) —
not a rare timing window, effectively certain once a matching trailer
exists at all. This alone, with no concurrency or timing coincidence
required, fully explains both real commits on a purely sequential
basis: turn 1's check correctly found nothing (genuinely no commit
yet) and committed; turn 2's check should have found turn 1's own
trailer and skipped, but the SIGPIPE bug reports "not found" every
time once a match exists to trigger it.

## What was ruled out, with evidence, not just reasoning

- **`.git/index.lock`, `.git/HEAD.lock`, `.git/refs/heads/<branch>.lock`**
  tested directly against `git log` — none affect it. `git log` is a
  pure read operation and doesn't touch these locks at all. The
  original "lock contention" guess in `TODO.md` was reasonable to
  raise but isn't the actual mechanism.
- **Overlapping/duplicate hook invocations (candidate (a))** — tested
  directly: 10 trials of two truly concurrent invocations (real
  background processes, real `git commit` calls) against a version of
  the check with the SIGPIPE bug already removed. Zero double-commits
  in 10/10 trials. Outcome was always exactly one commit — the other
  invocation either correctly saw the first's commit and skipped (its
  own check worked), or hit a real `git commit` lock error (exit 128),
  which the gate's own existing `if ! git commit; then ... exit 2; fi`
  handling already catches safely (verified when this gate was first
  built — see `TODO.md`'s pre-switch-commit-gate entry, Case 5). **Not
  confirmed as a cause, not needed to explain the incident, and — for
  what it's worth — even if genuine overlapping invocations do occur
  in the real Kiro environment (still untested, no way to drive Kiro's
  own dispatcher directly), the existing commit-failure handling
  already degrades safely rather than silently duplicating.**
- **Only one call site is actually vulnerable.** The script has two
  other `| grep -q` uses (`echo "$PROMPT" | grep -qE ...` and
  `echo "$NORMALIZED" | grep -qE ...`), but both pipe from `echo` of a
  short, single-line variable — a builtin's one-shot write that
  completes before `grep` can plausibly still be reading, no
  multi-line streaming process on the other end to receive a SIGPIPE.
  Confirmed by direct code read, not assumed safe by pattern-matching
  the syntax alone.

## Design

Replace the live pipe with a capture-then-check, so `grep` never reads
from a still-writing process at all:
```bash
LOG_TRAILERS=$(git log --format='%(trailers:key=Kiro-Episode,valueonly)')
if ! grep -qxF "$EPISODE_ID" <<< "$LOG_TRAILERS"; then
  KIRO_AGENT_COMMIT=1 git commit --allow-empty ...
fi
```
`git log`'s command substitution (`$(...)`) runs to full completion
and its process exits normally before `grep` ever starts — there is no
second process on the other end of `grep`'s input for a SIGPIPE to hit.
The here-string (`<<<`) rather than a plain variable-echo pipe is
deliberate: it avoids reintroducing *any* live pipe into `grep -q` at
all, not just this specific trigger of the bug — a plain
`echo "$LOG_TRAILERS" | grep -qxF ...` still pipes from a process
(`echo`) into `grep -q`, and while `echo` of an already-fully-captured
string is a single fast write in practice, a here-string removes the
pipe/signal risk structurally rather than relying on it being fast
enough in practice. Verified directly: 10/10 true positives (episode
present → correctly found) and a true negative (episode absent →
correctly not found) with this exact replacement.

**No other code in this block needs to change.** The failure-handling
around the commit itself (`if ! git commit; then ... exit 2; fi`,
`KIRO_AGENT_COMMIT=1`, `--allow-empty`) was tested and confirmed
correct when this gate was first built and is untouched by this fix —
this proposal is scoped to the one broken read, not a redesign.

## Live test plan

State confirmed clean (or explicitly live/untouched) before each run,
real file/git state checked after every case — same standard as every
proposal tonight.

1. **Direct regression test of the exact incident shape.** Real
   episode with `pending_switch_to` set, no commit yet → run the gate
   → confirm it commits (unchanged behavior). Run it again immediately
   (same episode, same `pending_switch_to`, simulating the second real
   turn) → confirm it now correctly SKIPS — this is the one case that
   was broken; `git log` afterward must show exactly one commit for
   that episode, not two.
2. **Repeat (1) at least 10 times** with fresh synthetic episode IDs
   each time, matching the reproduction's own sample size, to make
   sure the fix isn't itself a lower-probability coincidence in the
   other direction.
3. **True-negative check.** A genuinely new episode with no matching
   commit anywhere → confirm the gate still correctly commits (the fix
   must not make it permanently silent).
4. **Confirm the other two `grep -q` call sites are unaffected** — a
   quick negative check that `FUZZY_TICKET_MATCH` and the exact-match
   detection still behave identically before and after this change
   (they're untouched, but worth confirming nothing incidental broke).
5. **Re-run this proposal's own two ruled-out candidates one more time
   post-fix**, for completeness: confirm the lock-file tests and the
   10-trial concurrency test still show no double-commit with the real
   (now-fixed) script, not just the standalone reproduction harness.

## Rollback plan

A single, isolated one-line change (the live pipe → capture-and-check)
inside the pre-switch commit gate block added in `b222d80`. Revert by
restoring the original `git log | grep -qxF` line. No schema change,
no new files, no change to the commit/failure-handling logic around
it.
