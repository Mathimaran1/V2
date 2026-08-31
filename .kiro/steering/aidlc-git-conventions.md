---
inclusion: always
---
# AI DLC Git Conventions — Kiro Usage Rules

## Ticket linking
- Every plan must mention its Jira ticket ID (e.g. ANG-123).
- Every commit message must start with "ANG-123: short description".

## Ticket assignment is mandatory — something must always be chosen; "none" is legitimate, never silent (final design, 2026-08-27, settled after two same-day corrections)
**Every commit requires an ACTIVE, explicit choice: a real, validated
Jira ticket, or the deliberate answer "none" for genuinely ticket-less
work.** Neither is optional — the choice itself is mandatory — but
"none" is a legitimate, trackable value, not something to refuse or
work around. This is the middle ground between two prior designs, both
tried and both wrong in opposite directions on the same day:
- **Too permissive (the original design, and everything through the
  terminal-prompt-removal fix):** no ticket set silently defaulted to
  `none` with no active choice ever made — the commit just went
  through, tracked or not.
- **Too strict (the first reversal, same day):** `none` was removed as
  a concept entirely — every commit required a real ticket, full stop,
  with no way to explicitly and honestly record ticket-less work at
  all.
- **The correct middle ground, this section:** nothing is silent.
  Nothing is refused. A real ticket ID or an explicit "none" — either
  one, chosen on purpose — both write a real record (a real credit
  baseline, a real episode, a real trailer) and let the commit proceed.
  The only thing that ever blocks a commit is genuinely nothing having
  been chosen at all yet.

**What this means concretely:**
- If `.kiro/current-ticket.json` has no `ticket_id` set at all,
  `.githooks/pre-commit` **blocks the commit outright** (`exit 1`) with:
  *"No ticket set for this work. Please open Kiro chat and tell it
  which ticket you're working on before committing. Every commit
  requires a real ticket — there are no exceptions."* This code was
  built during the "too strict" phase and is unchanged since — it still
  blocks correctly, because once "none" is actively chosen and saved,
  `ticket_id` is the string `"none"`, which is not empty, so this check
  never fires for it. It only ever fires when nothing has been chosen.
- When you (the agent) ask which ticket the user is working on (CASE
  A2 below), the question is: *"which Jira ticket are you working on
  (a real ticket ID, or explicitly 'none' for work with no ticket)?"*
  If the user answers `none`, save it exactly like a real ticket would
  be saved — a real credit baseline and episode_id, written into
  `current-ticket.json` as `{"ticket_id": "none", ...}` — skipping only
  the Jira existence check, since "none" makes no claim about a real
  ticket to validate. Never save it as a guess or a default; only save
  it when the user has actually said so.
- `post-commit`'s "working on a different ticket now?" question accepts
  "none" as a switch target the same way — an explicit, confirmed
  choice (a real baseline/episode written immediately, with a plain
  confirmation message), not a silent skip. A real typed ticket is
  still deferred to you for validation exactly as before.
- A ticket that's already set — real or explicitly `none` — keeps
  working exactly the same for every subsequent commit; only a
  genuinely never-answered `current-ticket.json` blocks anything.

**The honest trade-off, stated plainly, not glossed over:** this is
narrower than "the original design, and everything through the
terminal-prompt-removal fix" (silent `none`), but wider than "the first
reversal" (no `none` at all). Genuinely ticket-less work — a quick
experiment, a config tweak — CAN still be committed, but only after
someone has actually been asked and actually answered "none" at least
once for that machine's `current-ticket.json`; it is never assumed. See
`TODO.md` and `README.md` for the full history of both corrections and
why each one was made.

## Commit message trailer format
Every commit gets eight machine-readable trailers, stamped automatically
by `.githooks/commit-msg` — nothing to type by hand:
```
Kiro-Ticket: PROJ-123
Kiro-Episode: ep_68aabbcc1a2b3c
Kiro-Credits: 42
Kiro-Confidence: high
Kiro-Session: 8f3a1c2e-...
Kiro-Source: kiro_session
Kiro-Episode-Started: 2026-08-28T05:59:04Z
Kiro-Elapsed-Minutes: 12.34
```
`none`/`n/a` fallbacks apply when a field can't be resolved — see
`docs/runbook.md` for the exact per-field rules.

`Kiro-Episode-Started`/`Kiro-Elapsed-Minutes` (added 2026-08-28) are
time tracking's exact counterpart to `Kiro-Episode`/`Kiro-Credits`, not
a separate mechanism: `episode_started_at` is a fixed timestamp written
once, at the same instant as `credits_at_ticket_start`, at every point a
new episode is established (CASE A1's initial assignment, CASE C1's
confirmed switch, post-commit's explicit "none" switch, and the
PRIORITY CHECK path). `Kiro-Elapsed-Minutes` is then recalculated fresh
every commit in `pre-commit` — current time minus that fixed
`episode_started_at` — the same "fixed baseline, recomputed delta each
commit" shape `Kiro-Credits` already uses.

## Episode boundaries — three cases, not equally trusted
A fresh `episode_id` (and a fresh `credits_at_ticket_start` baseline)
gets generated by exactly three triggers, in order of reliability:
- **CASE A — branch switch.** `.githooks/post-checkout` clears
  `.kiro/current-ticket.json` on any branch checkout; the next
  `ask-for-ticket-if-missing` prompt regenerates it.
- **CASE B — post-commit direct question (primary, reliable, terminal
  path).** `.githooks/post-commit` asks "Working on a different ticket
  now? (y/n)" right after every successful commit — deterministic, not
  an AI read of conversation. Answering "n" (or nothing) leaves
  `current-ticket.json` untouched and the episode continues. Answering
  "y" asks for the new ticket ID and overwrites it with a fresh
  baseline/episode. **Two distinct fallback triggers skip this
  question, each logged differently in `.kiro-tracking/hook-health.log`
  so they're distinguishable, not lumped together:**
  - **No-TTY fallback:** no controlling terminal to ask into at all —
    e.g. a fully headless subprocess. Logged as
    `hook_status=post-commit-switch-check-skipped-no-tty`.
  - **Agent-commit fallback, fixed 2026-08-27:** `$KIRO_AGENT_COMMIT`
    is set. This is checked FIRST, ahead of the TTY check — a real bug
    existed until this date where it wasn't checked at all, so an
    agent's own tool-execution shell (which CAN have a real TTY
    attached, same root cause pre-commit's profile-click prompt had
    already hit and fixed for itself) got asked anyway, dumping the
    question into a chat transcript as inert, unanswerable text —
    confirmed happening for real, not hypothetical. Logged as
    `hook_status=post-commit-switch-check-skipped-agent-commit`.
  Either way, the question is skipped rather than risking a hang or a
  wrong-signal check — see CASE B's chat-based counterpart directly
  below, which is what actually covers both cases. **5-minute timeout,
  added 2026-08-26:** a TTY existing is not proof someone's watching it
  — Kiro's autopilot mode can leave one technically open with nobody
  there, and a bare prompt would hang forever in that state. The
  question now uses `read -t 300`; a timeout logs
  `hook_status=post-commit-switch-check-timeout` (distinct from every
  skip case above and from a real answer) and defaults to "not
  switching" — the same safe default already used for an ambiguous
  reply.

### CASE B, agent-initiated-commit counterpart — a chat-level rule, not code
The terminal question above cannot reach anyone when the agent itself
runs `git commit` as part of carrying out a request — whether or not a
TTY happens to be attached to that shell. (Corrected 2026-08-27: it's
not "no terminal exists," which was the original, buggy assumption —
an agent's own tool-execution shell CAN have a real TTY attached, which
is exactly what let this question slip through and get dumped into a
chat transcript as inert text before the code fix above. The real
signal is `$KIRO_AGENT_COMMIT`, not TTY presence, and the hook now
checks it first.) Rather than leave this scenario to the
`hook-health.log` fallback alone, the agent is expected to ask
directly, in the conversation, in the same turn:

> Whenever you (the agent) execute a git commit command yourself as
> part of a user's request, and it succeeds: immediately after, before
> doing anything else, ask the user directly: "Committed on
> `<ticket_id>` — are you switching to a different ticket now?" and
> wait for their yes/no answer before continuing with anything else.
> Do not skip this even if the user's original request seems finished
> after the commit.

**Fallback after repeated non-answers, added 2026-08-27 — count-based,
not time-based** (see the shared explanation of why, right below CASE
B's other question, "Fallback after repeated non-answers" under
"Before committing" — the same rule and the same reasoning apply here):
if the user's next message doesn't clearly answer yes or no, ask again
— up to 3 asks total. If the reply to the third ask still doesn't
clearly answer it, stop asking: proceed as if the answer were "no" (the
same safe default already used for an ambiguous single reply — see the
episode-boundary CASE B logic in `post-commit`), but say so explicitly
in that same message, e.g. "Asked 3 times, no confirmation received —
staying on `<ticket_id>` without a confirmed answer." This makes an
unconfirmed default distinguishable from a genuinely-answered "no,"
which a silent default would not be.

**Honest limit of this mechanism:** this is a *behavioral* instruction
to the agent, not code-level enforcement — unlike the terminal path
above (a real hook, always runs, cannot be forgotten), this relies on
the agent actually following the steering rule every time. It could in
principle be missed. `.githooks/post-commit`'s no-TTY logging to
`hook-health.log` stays in place unchanged specifically as the backup
for that case: if the agent ever fails to ask, the log still records
that a switch-check was owed on that commit, so the gap is auditable
even when the behavioral rule isn't. The 3-attempt fallback above is
the same kind of behavioral rule, not code — nothing in `post-commit`
counts chat attempts or can verify the agent actually gave up after
exactly 3, only that this document says to.
- **CASE C — AI-detected mid-conversation switch (secondary,
  best-effort).** The `ask-for-ticket-if-missing` hook also watches
  conversation for signs of a switch to a different specific ticket
  before anything's been committed yet, and asks to confirm. Softer
  than CASE B by design — it depends on the AI recognizing intent from
  natural language, not a direct deterministic question — so treat it
  as a safety net, not the mechanism to rely on.

All three produce `episode_id` values in the same format
(`'ep_' + hex(unix_timestamp) + 3 random hex bytes`), so which case
created a given episode isn't recoverable from the ID itself.

### Refresh before the baseline is read, not just before each commit — two separate asks, not one reused (added 2026-08-28)
**A real gap, found after the fact:** every commit's credit delta is
computed *against* `credits_at_ticket_start` — the baseline captured
the moment a new episode starts. "Before committing" below already
makes you ask the user to click their profile icon before **reading**
credits at commit time — but that only covers a single commit's read.
**A stale *baseline* is worse: it poisons every commit for the rest of
that episode, not just one**, since every later delta is computed
against that one number. Reading the baseline straight from
`state.vscdb` without asking first — which all three cases above
originally did — left exactly that gap open.

**These are two separate, parallel checks, not the same one reused:**
- **Ask #1 — before establishing a NEW baseline.** Whenever CASE A1
  (a ticket, or explicit `"none"`, gets assigned for the first time),
  CASE C1 (a mid-conversation switch gets confirmed), or a
  `pending-ticket-check.json` entry gets validated and applied (the
  `post-commit` switch flow's chat-side confirmation) is about to
  write a fresh `credits_at_ticket_start`/`episode_id`: **first** ask
  the user — *"Please click your profile icon to refresh your credits,
  then let me know when ready"* — and **wait for their actual reply**
  before running the credit-read command. This is now written directly
  into `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`'s prompt text
  at all three baseline-establishing points, not just described here.
- **Ask #2 — before every commit's own read, unchanged.** `pre-commit`'s
  existing terminal/chat prompt (CASE A/B/C under "Before committing")
  still fires on every commit within an already-established episode,
  exactly as before. This section doesn't touch that — it's the
  existing, separate check, not being re-asked or replaced.

Answering ask #1 once at the start of an episode does **not** answer
ask #2 for any commit that follows — they refresh two different
numbers (the episode's starting point vs. a specific commit's current
read), asked by two different mechanisms (the AI hook in chat vs.
`pre-commit`'s own prompt), and both can legitimately fire close
together the first time a ticket gets set (baseline, then almost
immediately the first commit's own read) without that being redundant.

**Same honest limit as everything else in this document, said again
because it matters here too:** this is a behavioral instruction to the
AI hook, not code-enforced — nothing in `pre-commit` or `post-commit`
can verify the baseline-establishing ask actually happened before the
credit-read command ran. Given CASE B's commit-time ask was skipped
live, twice, on 2026-08-28 (see `TODO.md`), this new ask carries the
same real risk of being skipped and should not be assumed reliable
until it's actually been tested across several separate new-episode
starts, not just written down.

## Before committing
Open your profile panel (click the profile icon in the sidebar) to
check your current credit usage before committing. This isn't just a
habit — clicking it forces Kiro to refresh the cached usage number your
commit's tracking will read, which is otherwise stale for up to ~30
minutes.

**Why this note exists, so it doesn't get deleted by someone who only
sees the older conclusion:** an earlier investigation found that
calling the dashboard command programmatically
(`kiro.accountDashboard.showDashboard` via `executeCommand`) does
**not** force a resync — `state.vscdb` stayed byte-identical after
calling it directly. That's still true, and it's tempting to conclude
from it that "clicking the dashboard doesn't help." **It doesn't
generalize to the real UI click.** Tested twice, reproduced both times
(see `TODO.md`'s 2026-08-26 entries): a human physically clicking the
profile icon in the sidebar *does* force a real resync, persisted to
`state.vscdb` — confirmed by the cache's own internal timestamp jumping
to within seconds of the click, on two separate occasions, ruling out
coincidental background syncs both times. The button and the command
look like they'd do the same thing; they don't. Only the real click
helps `pre-commit`'s read — see `.githooks/pre-commit`'s own comments
at the point it reads `state.vscdb`, and the `credit_confidence` logic
right after, which now uses this same freshness signal directly.

### Three cases, same A/B/C pattern as episode boundaries above
Getting a dev to actually click before a commit reads their credits
needs the same three-way split as ticket-switch detection, for the
same underlying reason: a hook can prompt into a real terminal, but has
no way to reach a human through a chat conversation, and no way to
tell "no human at all" apart from "a human is present in chat" — that
gap can only be closed by agent behavior, not hook code.

**Bug found and fixed 2026-08-26 — read this before assuming TTY
presence means "human":** the original design assumed `/dev/tty` being
openable reliably meant CASE A (a human typing in a real terminal).
That assumption was wrong — an agent running `git commit` through its
own tool-execution mechanism can also have a real TTY attached, not
just a bare subprocess. Result: an agent-run commit took the CASE A
branch, and the terminal prompt got dumped into the chat transcript as
inert text instead of a real, answerable question — nobody was watching
a terminal to answer it. The fix below has you (the agent) self-
identify explicitly via an environment variable, rather than the hook
guessing from TTY presence alone.

- **CASE A — human typing the commit in a real terminal.** No
  `$KIRO_AGENT_COMMIT` set, and `.githooks/pre-commit` finds a TTY. It
  asks directly, before reading `state.vscdb`: "Please click your
  profile icon to refresh your credits, then press Enter to continue,"
  and waits for Enter, up to a **5-minute timeout** (added
  2026-08-26 — a TTY existing isn't proof someone's watching it; Kiro's
  autopilot mode can leave one technically open with nobody there, and
  a bare `read -p` would hang forever in that case). A timeout logs
  `hook_status=pre-commit-refresh-prompt-timeout` — distinct from a
  real answer and from the no-TTY skip in CASE C below — and the
  commit proceeds, same as if no TTY had been there at all.
  **Code-enforced** — a real hook, always runs, cannot be forgotten,
  same guarantee level as CASE A of episode boundaries above.

- **CASE B — you (the agent) are committing as part of an active chat
  turn with a human present.**

  > **MANDATORY FIRST STEP, NO EXCEPTIONS:** Before you run ANY
  > `git commit` command yourself, your very next action must be to
  > ask the user: "Please click your profile icon to refresh your
  > credits, then let me know when you're ready to commit." Do NOT run
  > `git commit`, do NOT set `KIRO_AGENT_COMMIT=1`, and do NOT stage
  > files with `git add` in preparation for committing until the user
  > has explicitly replied confirming they are ready. This applies
  > EVERY SINGLE TIME, with NO exceptions for how the user phrased
  > their request, how many times you've already asked in this
  > conversation, or any other context. Skipping this step is a
  > critical error.

  **Rewritten to this strength on 2026-08-28 after a real, repeating
  failure — not a hypothetical.** The previous wording ("first, ask...
  and wait for their actual reply") already said the right thing, and
  was still skipped live, twice, including once immediately after
  being explicitly named as the exact failure mode to avoid — proof
  that a merely-clear instruction is not the same as an
  unmissable one. This rewrite doesn't change the underlying rule, only
  makes it harder to rationalize past: **an earlier, unrelated message
  in the conversation is never sufficient** — "the user asked me to
  test a commit" is not the same as "the user replied to THIS specific
  question," and treating the two as equivalent is exactly the
  reasoning that produced both real skips. Only a reply to this exact
  question, asked after you decided to commit, counts.

  Only once the user has actually confirmed, run the commit prefixed
  with the flag that tells the hook this already happened in chat:
  ```
  KIRO_AGENT_COMMIT=1 git commit -m "..."
  ```
  `pre-commit` checks for `$KIRO_AGENT_COMMIT` *first*, before the TTY
  check — if set, it skips the terminal prompt entirely (there may be a
  TTY attached, but nobody is watching it — see the bug above) and logs
  `hook_status=pre-commit-refresh-confirmed-via-chat` instead.

  **Second layer, added 2026-08-28 — a deterrent and a detection aid,
  not enforcement (a plain chat statement can't be verified by a
  hook, and doesn't try to be):** immediately before setting
  `KIRO_AGENT_COMMIT=1`, state out loud in your own response, as its
  own sentence: *"Confirming: the user replied '\<exact quote of their
  reply\>' before I proceed."* This forces an actual reference to a
  real prior message rather than a silent internal decision — if
  you skip the ask, you cannot produce this line honestly (there is no
  reply to quote), which makes a skip visible in the transcript instead
  of invisible. This is not a substitute for actually asking and
  waiting; it's a second, independent tripwire so a skip is *legible*
  even when it happens, since the first layer alone has already failed
  to prevent one twice.

  **Still behavior-dependent, not fully code-enforced — say this
  plainly, again, since it matters more now, not less, given two real
  failures:** neither layer above is verified by any hook. A hook can
  check that `$KIRO_AGENT_COMMIT` is set; it cannot check that the ask
  actually happened, that the quoted reply is real and not invented, or
  that the "MANDATORY FIRST STEP" instruction was even read. Stronger
  wording lowers the *chance* of a skip and makes a skip easier to
  *catch after the fact* by comparing the quoted reply against the real
  transcript — it does not make a skip *impossible*. A `PreToolUse`
  code-enforced gate was investigated as the actual fix for that gap
  and reverted (see `TODO.md`, 2026-08-27/28) — not because
  code-enforcement is the wrong idea, but because the investigation
  itself surfaced two unrelated, more urgent bugs first (a silent
  `hook-health.log` gap, and `.kiro/consent-version` disappearing) that
  needed resolving before adding a new mechanism on top. This rewrite
  is the interim tightening, not a claim that the underlying problem
  (a hook cannot verify a chat conversation happened) is solved.

  **This does not conflict with the fallback below — they cover
  different failures.** "MANDATORY FIRST STEP, NO EXCEPTIONS" forbids
  never asking at all, which is what actually happened both times this
  was skipped. The fallback below requires the ask to have genuinely
  happened, up to three times, with a real reply received each time
  that just didn't clearly confirm — that is not skipping the step,
  it's the step being followed and still not producing a clear answer.
  If you have not asked at all yet, there is no fallback to reach for;
  go ask.

  **Fallback after repeated non-answers, added 2026-08-27 — count-based,
  not time-based.** The terminal's CASE A above has a real, code-enforced
  5-minute timeout (`read -t 300`) for exactly this situation: someone
  might not actually be watching. Chat has no equivalent, and cannot —
  **this is a hard limitation to state honestly, not a design choice:
  the chat-based fallback counts unanswered attempts, not elapsed
  time, because no equivalent of the terminal's `read -t 300` exists
  for a chat conversation — Kiro cannot act after a period of silence,
  only in response to a message.** No matter how much real time passes
  with the user saying nothing, nothing happens — there is no "wake up
  after 5 minutes" for a chat turn, only "the user sent a message" or
  "the user sent nothing, ever, and this conversation simply never
  continues." So instead of a timeout, use an attempt count: ask the
  question above. If the user's next message doesn't clearly confirm
  readiness to commit, ask again — up to 3 asks total. If the reply to
  the third ask still doesn't clearly confirm, stop asking: proceed
  with the commit anyway, setting BOTH `KIRO_AGENT_COMMIT=1` (as usual)
  AND `KIRO_AGENT_COMMIT_UNCONFIRMED=1`:
  ```
  KIRO_AGENT_COMMIT=1 KIRO_AGENT_COMMIT_UNCONFIRMED=1 git commit -m "..."
  ```
  and say so explicitly in that same chat message too — e.g. "Asked 3
  times, no confirmation received — committing anyway without confirmed
  readiness." The second env var is checked by `pre-commit` and logs
  `hook_status=pre-commit-refresh-confirmed-via-chat-unconfirmed`
  (distinct from the normal `-confirmed-via-chat` line) — unlike the
  ticket-switch question above, there IS a real hook invocation
  happening right after this one, so this specific piece of the
  behavioral rule genuinely is reachable as an auditable log line, not
  just a chat message. Only set it when the 3-attempt fallback actually
  fired — never on a commit properly confirmed on the first or second
  try.

  This same 3-attempt, count-based fallback applies to CASE B's other
  question (the ticket-switch question, above) too, with one real
  difference: that question resolves entirely in chat, after
  `post-commit` has already finished running for the commit that
  triggered it — there is no hook invocation happening at the moment
  the fallback would fire to log anything into. For that question,
  "stated plainly to the user in that same message" is the only
  reachable form of this note; there is no `hook-health.log` equivalent
  for it the way there is here.

- **CASE C — Kiro committing with no human present at all (fully
  autonomous/background execution, no active chat turn, and correctly
  not setting `$KIRO_AGENT_COMMIT` since there was no one to ask).**
  `.githooks/pre-commit` falls through to the same `{ : < /dev/tty; }
  2>/dev/null` check as before (deliberately not `[ -t 0 ]` — already
  tested and found to read false even for genuine human-typed commits)
  and does **not** attempt to ask anything when no TTY is present. The
  commit proceeds normally; `credit_confidence`'s existing cache-
  freshness check already handles this correctly with no special-
  casing — nobody clicked, so the cache stays stale, and confidence
  correctly comes out low. **Residual gap, not fully closed by this
  fix:** if a truly autonomous, no-human commit happens to run through
  a shell that has a TTY attached (the same condition that caused the
  original bug) AND the agent fails to omit `$KIRO_AGENT_COMMIT`
  correctly, it would still fall into the CASE A branch and dump a
  prompt nobody answers. This fix closes the specific, confirmed
  chat-present misdetection; it does not add a code-level guarantee for
  every possible unattended-TTY scenario.

**Detection boundary, stated plainly, corrected from the earlier
(wrong) version of this doc:** TTY presence does **not** reliably split
CASE A from (B or C) on its own — that was the bug. `$KIRO_AGENT_COMMIT`
is what actually splits CASE B off, and only when you (the agent) set
it correctly, which itself depends on you actually asking in chat and
waiting for a real reply first. Treat CASE A's terminal prompt as
reliable when no env var is set; treat CASE B as sound only to the
extent you follow the rule above every time — there is still no code
in this repo that can independently verify a chat exchange actually
happened.

## Credit calculation rule
`Kiro-Credits` is cumulative *within one episode* (one continuous
credit baseline), not incremental per commit, and not directly
comparable across episodes. To get a ticket's real total: take the
MAX `Kiro-Credits` value per `Kiro-Episode`, then SUM those per-episode
maxes per ticket. Never sum raw `Kiro-Credits` across commits directly
— it double-counts, since each value already includes everything since
that episode's own baseline. See `docs/runbook.md` and
`scripts/calculate-pr-credits.sh` for the reference implementation.

## Time tracking rule (added 2026-08-28)
`Kiro-Elapsed-Minutes` follows the identical max-per-episode-then-sum
rule as `Kiro-Credits` above, for the identical reason: it's cumulative
*within one episode* (minutes since that episode's own
`Kiro-Episode-Started`), not incremental per commit, and not comparable
across episodes. To get a ticket's real total time: take the MAX
`Kiro-Elapsed-Minutes` per `Kiro-Episode`, then SUM those per-episode
maxes per ticket — same two-step logic, same reason it double-counts if
summed raw. `scripts/calculate-pr-credits.sh` computes both totals side
by side per ticket; a commit made before this field existed has no
`Kiro-Episode-Started`/`Kiro-Elapsed-Minutes` (falls back to
`none`/`n/a`) and is excluded only from the elapsed-time total, not from
the credits total — the two are tracked independently.

## Approved tools
- Only use the "atlassian-rovo" and "aws" connections already set up
  in .kiro/settings/mcp.json.

## Workflow
- Always plan first (requirements → design → steps) before coding.
- Use the safer "ask before doing" mode on production branches.
- Two things this project deliberately does **not** do — scope
  decisions, not unfinished work: checking who a Jira ticket is
  *assigned* to (only existence-checking is in scope, once built), and
  any cron/daemon-style background credit-sync watcher (per-commit
  reads plus `credit_confidence` flagging is the accepted trade-off
  instead). See `TODO.md`'s 2026-08-26 "decisions made in conversation"
  entry for the full reasoning behind both.

## Commit hygiene
- Never commit passwords, keys, or .env files.
- **Never use `git add -f` (or any other override) to force-add a file
  git has refused because it's gitignored, without explicit user
  confirmation first.** A gitignore refusal is a deliberate signal —
  something was deliberately excluded (often per-machine ephemeral
  state like `.kiro/current-ticket.json`, never meant to be shared or
  committed) — not an obstacle to route around to make a commit
  succeed. Real incident, 2026-08-27: `.kiro/current-ticket.json` got
  force-added and committed this way; had to be untracked and amended
  back out. If a file you expect to commit is being refused, stop and
  ask the user whether it should actually be tracked before overriding
  anything.
