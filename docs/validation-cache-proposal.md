# Proposal: local Jira validation cache (Idea 1)

**Status: TRIED AND ROLLED BACK (2026-09-01).** Built exactly as
designed below, live-tested twice, and **failed on correctness both
times** — not a cost miss like the dispatcher-split, something more
serious: a real ticket was accepted without ever being checked against
Jira. Full findings, the two root causes chased down, the fixes
attempted, and the final rollback are recorded in `TODO.md`'s
2026-09-01 "Idea 1... FAILED both times... rolled back" entry.
`aidlc-ask-for-ticket-if-missing.json`, `scripts/ticket-gate-fastpath.sh`,
and `.gitignore` are all back to their exact pre-Idea-1 state, verified
byte-for-byte and by re-running the original regression suite, not just
assumed clean from reverting the diff.

The design below is kept for the record, not as a plan to re-attempt:
the first failure (a stale, self-generated cache timestamp) was fixed
and is a real, generally-useful lesson — never let a model write "the
current timestamp" as free text, always bundle a real `date`/clock
call, the same rule this project already learned once for the
credits-baseline read. The second failure is the one that actually
matters and is still open: it happened with the cache file confirmed
absent, meaning the caching mechanism itself could not have been the
direct cause — the leading (unconfirmed) theory is that a ticket
validated many times already in a long conversation gets skipped on
its own, a risk that may exist in the *original* instructions
independent of anything this proposal added. See TODO.md's open item:
this needs testing in a fresh, short session before anyone trusts
either this feature's design or the base validation flow's reliability
in a long-running one.

---

*(Original proposal preserved below, unedited.)*

## The insight

A Jira ticket only needs to be validated as *existing* once. Issue
keys don't get reused, and deletion is rare — once `ANG-123` has been
confirmed real, it stays real for all practical purposes. Today,
every single ticket switch re-validates from scratch, even for a
ticket validated an hour ago in the same session.

## Feasibility — the three questions asked, answered with evidence

**1. Where does the check have to live to actually save a turn, not
just move work around?**

It doesn't save a whole turn, and it's important to say that plainly.
Per `kiro.dev/docs/hooks/actions/` (already confirmed while
investigating the dispatcher-split proposal): on `Prompt Submit`, the
agent hook's prompt is *appended to the user's message and sent as one
combined request* — that request always happens once a ticket-related
message reaches the hook. A cache check cannot prevent that turn from
occurring, the same reason the dispatcher-split's "skip the agent hook
entirely" framing turned out to be wrong.

What a cache check *can* do: live in `scripts/ticket-gate-fastpath.sh`
(a command hook, runs before the agent hook's prompt is appended, and
— confirmed by the same docs — costs zero credits, runs locally), check
the candidate ticket ID against the cache, and if it's a recent hit,
emit a stdout note (the same mechanism already proven for
`FUZZY_TICKET_MATCH`: "on exit 0, stdout is added to the agent's
context"). The agent hook's own instructions then skip
`getAccessibleAtlassianResources`/`getJiraIssue` when it sees that
note, going straight to the refresh-ask/baseline-capture steps.

**So this saves the two Jira MCP tool calls within a turn that still
happens — not the turn itself.** That's a smaller win than "skip
validation entirely," but it's real and it's the only part of
validation that command-hook mechanics can actually reach.

**2. Does a command hook have access to the user's message text to
extract a ticket ID? Confirmed how?**

Checked `kiro.dev/docs/hooks/actions/` directly for this — **it does
not document the stdin shape at all.** `scripts/ticket-gate-fastpath.sh`
already flags this exact gap in its own comments ("NOT YET
LIVE-VERIFIED... the exact stdin JSON shape read below").

What tips this from "unknown" to "likely, with real evidence": that
same script's `FUZZY_TICKET_MATCH` mechanism has been observed
working correctly across multiple live tests earlier in this session
(e.g., `amd-123` → "Did you mean AMD-123?"). That only happens if the
command hook is genuinely reading real message text from stdin. This
is circumstantial, not a documented guarantee — worth one decisive
live check before trusting it for a new use case, not worth re-deriving
from scratch since it's already effectively been running in production.

**3. What's the real risk of a stale cache?**

Low, and bounded. This is an *existence* check only (already this
project's explicit scope — see `aidlc-git-conventions.md`'s
assignment-checking-is-out-of-scope decision). Jira issue keys are
essentially permanent: an issue can be resolved, closed, or archived
without ever stopping to "exist." The only way a cached "exists" entry
goes wrong is an actual deletion after caching — uncommon in normal
team workflows. Worst case on a stale hit: a since-deleted ticket gets
tracked as if `getJiraIssue` had passed — functionally identical to
what already happens today whenever Jira validation can't be performed
for any other reason (the existing "MCP call failed, proceed anyway"
fallback already accepts this exact risk elsewhere in the same hook).
A 24-hour window is conservative given how rarely this class of
staleness actually happens; there's no evidence a shorter window would
meaningfully reduce risk.

## Estimated savings — from this session's own real transcripts

| Turn type | Observed credits |
|---|---|
| Turns that called `getAccessibleAtlassianResources` + `getJiraIssue` | 0.62, 0.69, 0.78 |
| Turns with no tool calls (pure question/reasoning) | 0.07, 0.09, 0.10, 0.48 |

That's roughly **0.3–0.6 credits saved per cache hit** — not a
transformative number on its own, but real, and it compounds for any
team where the same handful of active tickets get switched between
repeatedly through a day.

## Design

**`.kiro/validated-tickets.json`:**
```json
{"ANG-123": "2026-08-31T10:00:00Z", "ANG-4571": "2026-08-31T09:15:00Z"}
```

**`scripts/ticket-gate-fastpath.sh` extension:** when the message
contains a candidate ticket ID (exact or fuzzy-normalized — reusing
the same extraction already built for `FUZZY_TICKET_MATCH`), look it
up in the cache. If found and within the window, emit
`CACHED_VALID_TICKET: <ID> validated at <timestamp>, skip Jira
validation` on stdout and exit 0.

**Hook prompt addition (small, additive — not a restructure):** in
CASE A1 and C1's validation steps, check for a `CACHED_VALID_TICKET`
note for this exact ID before calling Jira; if present, skip
`getAccessibleAtlassianResources`/`getJiraIssue` and treat it as
validated. After any successful validation — cached or fresh — write
(or refresh) that ticket's entry in `.kiro/validated-tickets.json`.

This is deliberately a small addition to the existing monolithic
prompt, not a restructure — the dispatcher-split already showed that
restructuring this file introduces cost and correctness risk that
isn't worth it for the savings involved. This proposal doesn't repeat
that mistake.

## Failure mode

A cache hint gets written but the agent calls Jira anyway (ignores the
note) — wastes the intended savings but is not incorrect, low
severity, easy to notice (transcript still shows the MCP calls). The
more consequential failure — a bad or stale entry causing a truly
invalid ticket to be silently accepted — is bounded by the staleness
analysis above and is no worse than an existing accepted fallback in
this hook already.

## Live test plan

1. Validate a real ticket fresh (cache empty) — confirm
   `.kiro/validated-tickets.json` gets a real entry written.
2. Within the cache window, switch to a *different* ticket, then
   mention the first ticket again (or restart the switch flow to it)
   — confirm the transcript shows `CACHED_VALID_TICKET` in context and
   **no** `getAccessibleAtlassianResources`/`getJiraIssue` calls, and
   compare the credit number against a fresh validation's cost.
3. A cache entry for a ticket that's since been deleted from Jira (or
   simulate by hand-editing the cache with a fake but plausible entry)
   — confirm it's accepted (expected, documented risk) rather than
   silently erroring.
4. Confirm the fastpath script's existing CASE A2 blocking behavior
   (empty ticket, unrelated message) is unaffected by this addition.

## Rollback plan

Three things touched: `scripts/ticket-gate-fastpath.sh`'s addition,
the hook prompt's small addition, and the new cache file. All isolated
and additive to the existing (already-restored) monolithic hook — no
restructure like the dispatcher split, so rollback is deleting the
cache file and reverting the two small script/prompt diffs, not
restoring a large backup.
