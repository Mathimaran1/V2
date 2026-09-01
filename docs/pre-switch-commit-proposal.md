# Proposal: require a real commit for the current episode before a ticket switch is confirmed

**Status: PROPOSAL ONLY — not implemented.** Nothing in `.kiro/` or
`.githooks/` has changed to reflect this.

## The gap this closes

`current-ticket.json` right now (checked live, 2026-09-01):
```
{"ticket_id": "ANG-123", "credits_at_ticket_start": 63.03,
 "episode_id": "ep_6a9681eb9207df", "episode_started_at": "2026-09-01T07:42:35Z"}
```
`git log`'s last 10 commits' `Kiro-Episode` trailers: `ep_6a95439e6e00c0`,
`ep_6a911bf011bd13` (×2), `ep_6a907e1405a135`, `none` (×2),
`ep_6a9004015a45d5`, `ep_6a8fdddf0361c9`, `ep_6a8d9907b3f4ea` (×2).
`ep_6a9681eb9207df` appears **nowhere** — this exact episode's credit
usage has no commit to attach to. If a mid-conversation switch to a
different ticket were confirmed right now (CASE C1 in
`aidlc-ask-for-ticket-if-missing.json`), `current-ticket.json` would be
overwritten with a fresh baseline/episode for the new ticket and
whatever credits were spent under `ep_6a9681eb9207df` would never be
recoverable in any commit trailer — silently lost, exactly like the
`pending_switch_to`-write and Jira-validation skips
`docs/deterministic-bookkeeping-proposal.md` already documented. Same
underlying shape: a required bookkeeping step depends on the agent
remembering to do it, and hasn't reliably held up.

## The question asked before building: can a command hook actually run `git commit` itself?

**Yes — with one important caveat, and one required precaution.**

**Why yes:** `scripts/ticket-gate-fastpath.sh` is already registered as
a `"type": "command"` hook action (`aidlc-ask-for-ticket-fastpath.json`)
— Kiro just executes it as a plain subprocess. A command hook has no
sandboxing that would stop it from running `git commit`; it's the same
kind of subprocess call as any other line in the script. This isn't
theoretical: the script already contains a dedicated, isolated
capability test (added tonight, still in place) that writes
`.kiro/hook-write-test.json` to disk — read back just now and confirmed
present with real content (`{"written_at": "2026-09-01T07:42:28Z",
"prompt_seen": true}`), proving a command hook's writes really persist,
not just appear to. `git commit` is not a fundamentally different kind
of action than a file write — both are subprocess calls a bash script
can make — so if one is proven, the other is not a new category of
risk, just an unverified specific case of the same proven category.

**The caveat:** this project's git hooks are wired live
(`core.hooksPath = .githooks`, confirmed), so `git commit` from *inside*
the command hook script does not bypass `pre-commit` / `commit-msg` /
`post-commit` — it runs through all three, for real, same as any other
commit. Those three hooks were built assuming one of two contexts:
a human typing in a real terminal, or the agent committing mid-chat-turn
with `KIRO_AGENT_COMMIT=1` already set after asking permission in chat.
A command hook's subprocess is neither — running `git commit` from it
bare (no env var set) would hit `pre-commit`'s CASE A/C branch, which
depends on whether that subprocess happens to have a TTY:
- No TTY (the more likely case, but **not concretely tested** for a
  Kiro command-hook's execution environment specifically): falls to
  CASE C, skips the refresh-ask cleanly, no block. Fine.
- A TTY *is* attached (this project has already been burned twice by
  wrongly assuming "no TTY" for a non-human subprocess — see
  `aidlc-git-conventions.md`'s two documented TTY-detection bugs):
  `read -t 300` blocks the switch for up to 5 minutes before timing out.
  Not fatal, but a bad, silent-seeming stall for something meant to be
  instant and invisible.
- `post-commit`'s own switch-question would also fire under the same
  TTY uncertainty, asking "working on a different ticket now?" into a
  context with no one to answer it — noise at best, another hang at
  worst.

**The required precaution:** invoke the auto-commit with
`KIRO_AGENT_COMMIT=1` set explicitly, the same flag the agent already
uses for its own chat-confirmed commits. This is not a misuse of that
flag — it exists precisely to mean "skip the interactive asks, this
commit is not a human sitting at a terminal" — which is exactly this
case too. It deterministically skips *both* the refresh-ask and the
post-commit switch-question, regardless of what TTY guess would
otherwise have been made, closing the caveat above rather than hoping
the guess comes out right. `KIRO_AGENT_COMMIT_UNCONFIRMED` is
deliberately **not** set — that flag specifically means "asked in chat,
never got a clear reply," which doesn't apply here; nothing was asked.

**Net answer to the question as posed:** the fully automatic version
(the hook runs the commit itself, no agent step) is technically
possible and is what this proposal recommends — not the softer
block-and-instruct fallback — because it's the only version that
actually satisfies the requirement as stated ("deterministic... NOT
dependent on the agent remembering"). A block-and-instruct version
would just relocate the same old failure mode (an agent asked to
remember to run a command) one step earlier; it's described below only
as the fallback if live testing finds the automatic commit unsafe.

## Design (primary: automatic)

Extend `scripts/ticket-gate-fastpath.sh`, in the branch that currently
handles `pending_switch_to` (today the script doesn't look at that
field at all — it only checks bare `ticket_id`). New logic, inserted
after the existing `TICKET_ID` read and before the current
`CURRENT_TRACKED_TICKET` early-exit:

1. Read `pending_switch_to` from `current-ticket.json` alongside
   `ticket_id`/`episode_id`. If it's empty, nothing to do — behave
   exactly as today.
2. If `pending_switch_to` is non-empty (a switch question is pending
   from a prior turn — CASE C2 already wrote it), check whether the
   **current** `episode_id` already has a real commit:
   ```
   git log --format='%(trailers:key=Kiro-Episode,valueonly)' \
     | grep -qxF "$EPISODE_ID"
   ```
3. If found: do nothing, fall through to the existing
   `CURRENT_TRACKED_TICKET` note and let the turn proceed normally.
4. If not found: run the commit **before** letting the prompt reach the
   agent hook:
   ```
   KIRO_AGENT_COMMIT=1 git commit --allow-empty \
     -m "chore: capture episode $EPISODE_ID credits before ticket switch"
   ```
   using the exact same credit-read command already proven tonight
   (the one embedded in `aidlc-ask-for-ticket-if-missing.json`'s CASE
   A1/C1 and duplicated in `pre-commit` itself) to populate
   `credits_at_ticket_start`'s delta — no new read logic, this commit
   goes through the real `pre-commit`/`commit-msg` pipeline exactly
   like any other, so it computes and stamps `Kiro-Credits` itself; the
   fastpath script does not need to read credits directly at all.
5. Whether the commit was just made or already existed, `exit 0` and
   let the prompt through — `CURRENT_TRACKED_TICKET` note still fires,
   and the agent hook's own CASE C1 logic (confirm/decline the switch)
   proceeds completely unchanged.

**Why gate on `pending_switch_to` being set, not on "this message is the
confirming reply":** deciding whether *this specific message* confirms
a switch is exactly the kind of natural-language judgment call this
project's command hooks have deliberately stayed out of everywhere else
(see `FUZZY_TICKET_MATCH`'s "flag it, let the agent confirm" pattern in
this same script). Gating on `pending_switch_to` alone sidesteps that
entirely: the commit is made as soon as a switch is *possibly* imminent,
not only once it's certain. Worst case if the user then declines the
switch, an extra empty bookkeeping commit exists for an episode that
continues anyway — harmless, and arguably a feature (that episode's
credits-so-far are now on record either way, addressing part of what
motivated this proposal in the first place).

**Why `--allow-empty`:** nothing needs to be staged for this commit to
be meaningful — its only payload is the trailers `commit-msg` stamps
on. Without `--allow-empty`, a clean working tree would make the commit
fail outright.

**One real dependency worth naming, not glossing over:** `pre-commit`
still runs its consent gate, `gitleaks protect --staged` (trivially
passes — nothing staged), and its ticket-block check (`ticket_id`
must be non-empty — guaranteed true here, `pending_switch_to` can only
be set once a real `ticket_id` already exists) ahead of anything else.
The one edge this doesn't cover: a machine that has never gone through
the consent prompt at all — its unconditional `read -p ... < /dev/tty`
isn't guarded by the TTY-existence check used elsewhere in the same
file, and would error rather than hang in a TTY-less subprocess,
failing the auto-commit closed. Realistic exposure is low (every
machine that's reached the point of having a tracked ticket has almost
certainly already committed and consented once), but worth confirming
in the live test below rather than assumed away.

## Design (fallback: block-and-instruct, only if the automatic version fails live testing)

If step 4 above turns out to be unsafe in practice (the TTY/consent
edge cases above prove more than theoretical), the fallback is a
**hard block, not a soft reminder**: when `pending_switch_to` is set
and no commit exists for the current `episode_id`, `exit 2` with a
stderr message instead of running the commit —
`"A ticket switch is pending but the current episode (<id>) has no
commit yet — run \`git commit --allow-empty\` (or a real commit) for
the current work before confirming the switch."` — which blocks the
prompt exactly like the existing empty-ticket gate does. This is
still deterministic in the sense that it can never be silently skipped
(the block is code, not a reminder in prose), but it reintroduces a
dependency on a human or agent actually acting on the block, which is
weaker than the primary design and is explicitly **not** the
recommended option — only a fallback.

## Live test plan

State confirmed clean before each run, same discipline as every other
proposal tonight:

1. Set a tracked ticket, make zero commits, trigger a CASE C2 switch
   question (mention a second real ticket) so `pending_switch_to` gets
   written. Confirm the fastpath's next-turn check fires and a real
   commit lands **before** the agent hook's switch-confirmation logic
   runs — checked via `git log -1` showing the right `Kiro-Episode`
   trailer, not inferred from the transcript.
2. Confirm the switch on that next turn; verify `current-ticket.json`
   now shows a fresh baseline/episode for the new ticket, and the old
   episode's commit from step 1 is still present and unchanged in
   `git log`.
3. Repeat with a **decline** instead of a confirm — verify the episode
   continues (no baseline change) and the extra commit from step 1 is
   still harmless (present, doesn't affect anything downstream).
4. Specifically test the TTY caveat: run the fastpath script manually
   with stdin/stdout NOT attached to a terminal (`</dev/null` inside a
   background subprocess, or `expect`-driven) to observe which
   `pre-commit`/`post-commit` branch it actually takes, since this is
   the one open unknown flagged above, not yet observed directly for a
   Kiro-invoked command hook specifically.
5. Repeat steps 1–3 at least twice more before calling this fixed,
   matching this project's stated pass bar: any single failure means
   "improved, still under investigation," not "fixed."

## Rollback plan

Entirely additive to `scripts/ticket-gate-fastpath.sh` — one new
`pending_switch_to`-gated block, inserted before the existing
`CURRENT_TRACKED_TICKET` check. Revert by removing that block; no
`.githooks/*` file changes, no new state files, no schema change to
`current-ticket.json` (`pending_switch_to` already exists as a field
today). Verifiable byte-for-byte the same way every other fastpath
revert this session has been.
