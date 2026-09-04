# cloudId-guessing detectability (Bug 2)

## Status
Approved to build (2026-09-04), same shape as Bug 4's `Kiro-Jira-Validated`
trailer, after the user confirmed the real reproduction was a first-call
guess, not a reuse-turn — ruling out the cache-and-inject mitigation
considered earlier.

**Update (2026-09-04, same day):** built, live-tested 5/5 in an isolated
scratch repo, committed as `5ff9232` (originally hand-typed trailer lines
caused a real duplicate-trailer bug, fixed via `git commit --amend`,
final clean commit `0cedf55`). See TODO.md for the full test log. This
line was stale ("Approved to build") for a while after landing — caught
during a later full-project consistency sweep, not by design.

## Evidence
Root cause already conclusively established (see TODO.md, 2026-09-04): the
HCM-ALCS-BE-AIDLC-TEST reproduction is NOT a stale-copy/deployment issue —
`json.load()` equality confirmed the shipped instruction text is byte-for-
byte identical (modulo em-dash re-serialization) to `v1`'s, with the
"call `getAccessibleAtlassianResources` first" rule present and correctly
worded 4 times. This is a genuine new occurrence of the same
prose-reliability failure as Bugs 1 and 3 — on the first Jira call of the
session, so a cache-once/reuse-later mitigation (which would help a LATER
call in the same conversation) does not apply to what was actually
reported.

## Design
No prevention is buildable here — command hooks have zero Jira/MCP
visibility (confirmed repeatedly this project), so there is no way to
verify or supply a real cloudId from outside the agent's own tool-call
chain, first call or otherwise. This mirrors Bug 4's Part 2 exactly:
make the failure **detectable after the fact**, not prevented.

- Extend the same three bundled baseline-write commands (already carrying
  `jira_validation_status` from Bug 4) with one more field,
  `cloud_id_confirmed`: `true` if `getAccessibleAtlassianResources` was
  actually called this conversation (fresh, or reused from an earlier
  confirmed call) and its returned cloudId is what was used for the
  validation call; `false` if the agent proceeded without ever calling it
  — i.e. guessed, hardcoded, or otherwise fabricated a cloudId value.
- `.githooks/pre-commit` reads it, same pattern as `jira_validation_status`.
- `.githooks/commit-msg` emits `Kiro-CloudId-Confirmed: true`/`false`/`n/a`
  — same true/false/n/a convention as `Kiro-Confirmed` and
  `Kiro-Jira-Validated`, `n/a` for missing/old baselines.
- `scripts/calculate-pr-credits.sh` gets the same presence-sentinel +
  per-ticket "any false wins" aggregation, third time reusing this exact
  pattern.

Explicitly NOT a fix for the underlying guess — same honest limitation as
`Kiro-Jira-Validated`: this is agent-written, not command-hook-derived, so
a guess that also fails to record `cloud_id_confirmed: false` correctly is
invisible. Stated here, not hidden.

## Failure modes
- Agent guesses a cloudId AND correctly records `cloud_id_confirmed: false`
  — the intended, useful case: guess wasn't prevented, but is now visible
  in the trailer and in `calculate-pr-credits.sh`'s aggregate output.
- Agent guesses a cloudId and ALSO fails to flag it (same reliability gap
  as everything else prose-driven in this project) — invisible, no false
  claim of coverage made anywhere in this doc or the commit message.

## Live test plan
Plumbing only, same as Bug 4 — no live Kiro chat available from this
session: hand-craft `current-ticket.json` with `cloud_id_confirmed` true/
false/missing, run real commits through the real `pre-commit`/`commit-msg`
hooks in an isolated scratch repo, confirm the trailer. Run
`calculate-pr-credits.sh` against a mix including one ticket with two
episodes (one true, one false) to confirm the false wins.

## Rollback plan
Revert the four touched files
(`aidlc-ask-for-ticket-if-missing.json`, `.githooks/pre-commit`,
`.githooks/commit-msg`, `scripts/calculate-pr-credits.sh`). Additive only
— older commits simply lack the trailer and read as `n/a`.
