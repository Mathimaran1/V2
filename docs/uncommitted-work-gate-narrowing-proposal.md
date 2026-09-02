# Proposal: narrow the uncommitted-work gate to per-episode NEW dirt, not whole-repo dirtiness

**Status: PROPOSAL ONLY — not implemented.** Nothing in `scripts/`,
`.githooks/`, or `.kiro/hooks/` has changed to reflect this.

## The problem, confirmed live, not theoretical

The uncommitted-work gate (`docs/uncommitted-work-gate-proposal.md`,
committed `7b3da75`) blocks a ticket switch whenever `git status
--porcelain` is non-empty, in three places: `scripts/ticket-gate-
fastpath.sh` (two checks — C2 detection and C1 confirmation) and
`.githooks/post-commit`'s terminal `'none'` branch.

**Checked directly, right now:** `git status --porcelain` on this repo
shows `M TODO.md` — this project's own established practice tonight
(every fix surgically staged, deliberately leaving *other*
reviewed-but-separate work uncommitted for extended periods) means the
working tree is dirty essentially all the time under normal operation
here. The gate's signal — "is the repo dirty at all" — doesn't
distinguish that from "did the user forget to commit real work before
switching," which is the actual thing it's supposed to catch. As
written, it would block close to every switch in this project's normal
workflow, not just the rare forgotten-work case.

**Check 1a (C2 detection) is the more aggressive of the two:** it fires
on the mere *mention* of a differently-shaped ticket ID string anywhere
in a message — no `pending_switch_to`, no confirmed switch intent
needed — combined with the same whole-repo dirtiness check. A message
like "let's check how ANG-999 handled this" while working on `ANG-123`,
with anything anywhere uncommitted, blocks outright.

## Investigated: did this false positive actually cause the 2195-line bundled commit?

**Not confirmable from available evidence — reporting that honestly,
not asserting a causal link I can't back up.** Checked directly:
`scripts/ticket-gate-fastpath.sh`'s uncommitted-work gate does not log
anything to `.kiro-tracking/hook-health.log` on a block — it only
`echo`s to stderr and exits 2, leaving no persistent trace. There is no
log line anywhere that says "blocked a switch at time T." I looked for
every indirect signal available instead:

- `.kiro-tracking/hook-health.log` between `3f0da3a` (16:07:12 IST) and
  `7b3da75` (17:36:30 IST) — an 89-minute gap — shows no entries at all
  until `7b3da75`'s own commit sequence. No evidence either way.
- `docs/uncommitted-work-gate-proposal.md`'s own "Testing" section,
  written during this same window, states: *"Live simulation with a
  dirty working tree (the changes from this very task) confirms `git
  status --porcelain` produces output and the check correctly
  identifies dirty files."* This confirms, in the feature's own
  words, that a dirty tree — from its own in-development changes, not
  forgotten prior work — WAS present and WAS flagged during this
  window. That's the exact false-positive shape, but it documents the
  check firing during self-testing, not that it blocked a real
  switch attempt that then forced a bulk commit.
- Timing is suggestive: `7b3da75`'s own episode (`ANG-4571`) started at
  `12:05:48Z`, 42 seconds before that commit; the very next commit
  (`554897b`) shows a NEW episode (`ANG-123`) started at `12:08:10Z` —
  a switch back within 2 minutes 22 seconds of the first. Two rapid
  switches bracketing one large commit is consistent with switch-related
  friction, but isn't proof of it.

**Conclusion: plausible and consistent with the available evidence, not
confirmed.** The gate's complete lack of logging is itself a real gap —
noted below as something worth fixing alongside the narrowing, so this
question is actually answerable next time.

## Design: compare against a per-episode dirty baseline, not absolute dirtiness

**Core idea:** capture `git status --porcelain`'s output at the exact
moment each new episode baseline is established (the same instant
`credits_at_ticket_start`/`episode_id` get written) and store it as a
new field, `dirty_snapshot_at_episode_start`, in `current-ticket.json`.
At switch-check time, compare the *current* `git status --porcelain`
against that stored baseline — only block on lines that are NEW since
the episode began. Pre-existing, unrelated pending work (present
before this episode started) is never new, so it never blocks a
switch; anything genuinely created or modified during this episode
still does.

Verified directly before writing this up:
```python
# capture (same instant as the credit baseline):
import subprocess, json
dirty = subprocess.run(['git','status','--porcelain'],
                        capture_output=True, text=True).stdout.splitlines()
# ... included as data['dirty_snapshot_at_episode_start'] = dirty

# compare (at switch-check time):
baseline = set(data.get('dirty_snapshot_at_episode_start', []) or [])
current = subprocess.run(['git','status','--porcelain'],
                          capture_output=True, text=True).stdout.splitlines()
new = [line for line in current if line not in baseline]
```
Tested in an isolated scratch repo: a file dirty before the baseline
was captured correctly produces `NEW_DIRTY: []` (allowed through); a
file created afterward correctly produces `NEW_DIRTY: ['?? new-work.py']`
(blocks). Full lines are compared, not just filenames — a file's status
changing (e.g. untracked → staged) during the episode does count as
"new," a deliberate choice: staging is a real action taken during this
episode, not silent pre-existing noise, and the user still just needs
to commit it either way.

### Where this touches

**Comparison sites (read-only, no write needed) — 3 places, matching
today's 3 blocking checks exactly:**
- `scripts/ticket-gate-fastpath.sh`, check 1a (C2 detection)
- `scripts/ticket-gate-fastpath.sh`, check 1b (C1 confirmation)
- `.githooks/post-commit`'s `'none'` branch

**Capture sites (write the new field) — the 4 places a fresh episode
baseline already gets established, all already writing
`credits_at_ticket_start`/`episode_id` in one bundled command (Option
A2, `docs/deterministic-bookkeeping-proposal.md`) — extending an
already-proven pattern, not introducing a new one:**
- CASE A1 (agent hook, `aidlc-ask-for-ticket-if-missing.json`)
- CASE C1 (same file)
- PRIORITY CHECK (same file)
- `.githooks/post-commit`'s own `'none'`-switch baseline write (still
  the pre-Option-A2 "print 3 lines, bash reconstructs JSON" style —
  extending it means also having python write the file directly here
  too, the same migration Option A2 already made everywhere else, since
  hand-assembling a 4th field containing arbitrary file-path text in
  bash is exactly the fragile pattern Option A2 exists to avoid)

**Backward compatibility:** a `current-ticket.json` written before this
change has no `dirty_snapshot_at_episode_start` field at all —
`data.get(..., []) or []` treats that as an empty baseline, which
means *everything* currently dirty counts as new — identical to
today's behavior. Safe default, self-heals the moment the next episode
starts and captures a real baseline.

### Alternative considered and rejected: a hardcoded exclude-list

E.g. `grep -v -E '^docs/.*\.md$'` to filter out routinely-pending
proposal docs. Rejected: it requires maintaining a list of "these
paths are always fine to be dirty," which is arbitrary, drifts out of
date as the project's own conventions change, and could coincidentally
exclude a genuinely-forgotten real file that happens to match the
pattern. The per-episode baseline is a principled definition of
"relevant to the current episode" with no hardcoded paths at all.

### Secondary fix, alongside this: give the gate a log line

Add a `hook_status=uncommitted-work-gate-blocked` line to
`.kiro-tracking/hook-health.log` on every block, matching every other
blocking path in this project. Directly closes the investigation gap
above — the next time this fires, it'll be answerable with real
evidence, not reconstructed from timing alone.

## Separate, small fix: `aidlc-session-greeting.json`'s hardcoded path

Currently: `cd /home/srimathi/Desktop/v1 && ...` — a hardcoded absolute
path, inconsistent with every other script in this project (all derive
their root dynamically). Verified directly: `git rev-parse
--show-toplevel` returns `/home/srimathi/Desktop/v1` correctly from
inside this repo. Fix: `cd "$(git rev-parse --show-toplevel)" && ...`
— works from anywhere inside the repo, no hardcoding, matches this
project's own established convention (every other hook computes its
root rather than assuming one).

## Live test plan

Real file/git state checked after every case, not transcript text —
same standard as tonight's other proposals.

1. **Pre-existing dirt allowed through.** Establish an episode with the
   repo already dirty (simulating this project's normal state);
   confirm `dirty_snapshot_at_episode_start` captures it; confirm a
   switch attempt with the SAME dirty state still present is allowed
   (no new lines).
2. **Genuinely new work still blocks.** From the same baseline, modify
   or create a file not present in the baseline; confirm the switch is
   blocked, and confirm the blocked message correctly shows only the
   NEW file(s), not the pre-existing ones.
3. **Mixed case.** Baseline has file A dirty; at switch time, A is
   still dirty AND new file B is also dirty; confirm the block message
   shows only B.
4. **Backward compatibility.** A `current-ticket.json` with no
   `dirty_snapshot_at_episode_start` field at all (simulating an
   episode established before this fix); confirm the fallback (empty
   baseline) behaves identically to today's whole-repo check.
5. **All 4 capture sites produce a valid, JSON-loadable
   `dirty_snapshot_at_episode_start`** — direct file-state check after
   triggering each of CASE A1, CASE C1, PRIORITY CHECK, and
   `post-commit`'s `'none'` branch.
6. **The new hook-health.log line fires correctly** on a real block,
   checked directly in the log file, not just via exit code.
7. **`aidlc-session-greeting.json` fix**, run from a subdirectory of
   the repo (not just the root) to confirm `git rev-parse
   --show-toplevel` resolves correctly regardless of invocation CWD.

## Rollback plan

Additive in all cases — a new JSON field alongside existing ones (no
existing field removed or renamed), and the comparison logic replaces
the existing whole-repo check at exactly the 3 sites that already do
whole-repo checking today. Revert by restoring the plain `git status
--porcelain` non-empty check at those 3 sites and dropping the capture
code at the 4 write sites; `dirty_snapshot_at_episode_start` left
harmlessly unused in any `current-ticket.json` that already has it.
The session-greeting path fix is a one-line, fully independent revert.
