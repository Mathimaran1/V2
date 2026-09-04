# Jira MCP structural unavailability → hard stop (Bug 4)

## Status
Approved to build directly (2026-09-04) — no live transcript available for
this one; the user explicitly confirmed the gap was found by inspecting the
shipped instruction text, not by witnessing a live occurrence, and asked to
proceed on that basis rather than withhold a fix waiting for evidence that
doesn't exist. Documented here anyway, matching this project's standing
practice of a written design for every non-trivial fix — approval already
given, this is the record, not a request for it.

**Update (2026-09-04, same day):** built, live-tested 5/5 in an isolated
scratch repo (`validated`→true, `skipped_transient`→false, `none`/missing
→n/a, and the "any false wins" aggregation case), committed as `bc39d57`
after a real self-inflicted JSON-escaping bug was caught and fixed
mid-build. See TODO.md for the full test log. This line was stale
("Approved to build directly") after landing — caught during a later
full-project consistency sweep.

## Evidence (real, from `HEAD`'s shipped `aidlc-ask-for-ticket-if-missing.json`)
The same fallback sentence appears three times — PRIORITY CHECK, CASE A1,
CASE C1 — each lumping every non-"clear not-found" MCP outcome into one
bucket:

> *"If the MCP call itself fails for any OTHER reason (network error,
> timeout, ambiguous response ...): do NOT block — ... proceed exactly as
> if it had passed."*

None of the three distinguishes "one lookup timed out" (fine to proceed
cautiously — the connection itself is fine, just a hiccup) from "the
`atlassian-rovo` connection isn't there at all in this workspace" (proceeding
means every ticket typed for the rest of the session gets silently treated
as validated, with zero real Jira check ever happening).

## Design

### Part 1 — wording split (prevention attempt)
In all three sites, replace the single bucket with two explicit branches:

- **Transient** (a specific lookup's own network error, timeout, or an
  ambiguous/unclear response to that one call) → unchanged: proceed
  cautiously, exactly as today.
- **Structurally unavailable** — `getAccessibleAtlassianResources` itself
  errors, or returns no resources / an empty list (as opposed to one
  `getJiraIssue` call failing) → **HARD STOP**: tell the user plainly,
  *"Jira validation isn't available in this workspace right now — please
  check the atlassian-rovo connection before continuing,"* do NOT save
  anything, do NOT establish a baseline, do NOT treat the ticket as
  validated. Wait for the user's next message instead of proceeding.

Named honestly, not oversold: this is a wording-only prevention attempt, the
same category of fix Bug 1 already proved doesn't reliably hold (3/3 skips
survived an equally explicit wording fix). No claim this will hold better —
only that it's strictly more correct than what's shipped now, and it's the
only prevention lever available (command hooks have zero Jira/MCP
visibility — confirmed repeatedly this project — so there's no deterministic
way to even detect "is the connection up" outside the agent's own tool call).

### Part 2 — detectability (the honest fallback, mirroring Kiro-Confirmed)
Since Part 1 can't be trusted to hold on its own, add a new trailer,
`Kiro-Jira-Validated`, following the exact pattern already proven for
`Kiro-Confirmed`: not prevention, visibility after the fact.

- Extend the three existing baseline-write commands (the ones that already
  write `ticket_id`/`credits_at_ticket_start`/`episode_id` in one bundled
  `python3 -c` call) to also accept a `jira_validation_status` field, one of
  `"validated"` (existence check succeeded for real) / `"skipped_transient"`
  (one lookup failed, proceeded per the fallback) / `"none"` (ticket_id is
  `none`, nothing to validate). The agent substitutes this the same way it
  already substitutes the ticket ID — one more value in an already-mandatory
  single command, not a new separate step to remember (same "bundle into
  what's already unskippable" reasoning as Option A2).
- `.githooks/pre-commit` reads `jira_validation_status` from
  `current-ticket.json` (same pattern as `ask_confirmed`/
  `ask_confirmed_gap_seconds`), passes it through `KIRO_COMMIT_DATA`.
- `.githooks/commit-msg` emits `Kiro-Jira-Validated: true` (validated) /
  `false` (skipped_transient) / `n/a` (none, or pre-existing commits before
  this trailer existed) — `true`/`false` naming chosen to match
  `Kiro-Confirmed`'s existing convention rather than inventing new words for
  the same shape.
- `scripts/calculate-pr-credits.sh` gets the same presence-sentinel +
  per-ticket "any false wins" aggregation already built for
  `Kiro-Confirmed`, reusing the pattern rather than a new one.

Explicitly NOT the same guarantee as `Kiro-Confirmed`: this value is
agent-written, not command-hook-derived, because there's no command-hook-
visible signal for "was Jira actually reachable" the way there is for "how
much time passed." A skipped HARD STOP that also fails to set this field
correctly is invisible — that residual gap is real, stated here rather than
hidden, and is the same reliability ceiling this whole project has been
mapping all night, not a new one.

## Failure modes
- Agent hits structural unavailability, HARD STOP wording doesn't fire
  (same prose-reliability gap as Bug 1) → old behavior (silent
  "proceed as if passed") — but if the agent still sets
  `jira_validation_status: skipped_transient` correctly, this is visible in
  the trailer. If it doesn't, this specific occurrence is invisible — no
  claim otherwise.
- Real MCP timeout on one lookup — must still fall into "transient," not the
  new hard-stop branch. Test this explicitly, not just the new branch, to
  avoid a regression where a normal transient blip now incorrectly blocks.

## Live test plan
Two different kinds of testing, honestly separated:
1. **Plumbing (testable from this session, no live Kiro chat needed):**
   hand-craft `current-ticket.json` with each of the three
   `jira_validation_status` values, run a real commit through the real
   `pre-commit`/`commit-msg` hooks, confirm the trailer value matches. Run
   `calculate-pr-credits.sh` against a mix of tickets/episodes, confirm the
   aggregation surfaces an unconfirmed one correctly, same shape as
   `Kiro-Confirmed`'s own 8-case test plan.
2. **Prose behavior (NOT testable from this session — no way to drive a
   real Kiro chat turn):** whether the HARD STOP wording actually fires on
   a genuine structural-unavailability turn, and whether it's correctly
   distinguished from a genuine transient timeout. Flagged explicitly as
   "awaiting a real live transcript," not claimed passing.

## Rollback plan
Revert the four touched files (`aidlc-ask-for-ticket-if-missing.json`,
`.githooks/pre-commit`, `.githooks/commit-msg`,
`scripts/calculate-pr-credits.sh`) to their pre-this-change state. No data
migration needed — `Kiro-Jira-Validated` is additive, older commits simply
lack the trailer and read as `n/a`, same as every other trailer added this
way this project.
