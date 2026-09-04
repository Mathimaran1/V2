# Bug 3 — reasoning/output divergence: root-cause investigation and proposal

## Status
Investigation and proposal only. **No fix built.** Awaiting review before
implementation, per explicit instruction.

## Evidence — full reconstructed context

### The confirmed incident
`~/.kiro/sessions/c7ade37360669479/sess_19e1d0da-2c2c-4464-b27e-cba760534299/messages.jsonl`,
messages 31 (Reasoning) and 32 (Say). Logged in full in `TODO.md`,
2026-09-04, "Bug 3 CONFIRMED". User message: `"hi"`.

### Which instruction version was active — verified, not assumed
`git log --format='%H %ai' -- .kiro/hooks/aidlc-ask-for-ticket-if-missing.json`
shows the file was last committed at `28ee3ed` (2026-09-02 13:14:21
+0530) before this session ran (2026-09-04 05:23–05:25 UTC = 10:53–10:55
IST) — the next commit, `bc39d57`, landed at 11:49 IST, well after. So
`28ee3ed`'s exact committed text was active. Pulled via `git show
28ee3ed:.kiro/hooks/aidlc-ask-for-ticket-if-missing.json` and quoted
below.

### The precursor session — where the marker actually came from
A second, earlier session in the same workspace,
`sess_f69605a3-7c2a-429d-90dd-dba8cb9d3d40` (05:19–05:21 UTC, ending
~2 minutes before the confirmed incident's session began), shows the
real origin: the user typed `ANG-123`, validation hit a real ambiguous
MCP response (worth noting on its own — a live, real instance of Bug
4's exact "proceed as if passed" fallback firing, unprompted, tangential
evidence for that bug too), the agent asked "Please click your profile
icon to refresh your credits, then let me know when ready," and wrote
`pending-baseline-confirm.json` — then the session ended before any
reply arrived. This is a real, independent, retroactive confirmation
that Bug 5's trigger (B) targets a real recurring shape: a session
boundary colliding with a still-open marker, here happening naturally,
not staged.

### The full turn — six reasoning cycles, not one
The confirmed incident's turn ("hi") produced **six** Reasoning→Say
cycles before the final visible response (messages 6/7, 11/12, 16/17,
21/22, 26/27, 31/32) — five of the six `Say`s were empty (`"\n\n\n"`,
internal steps), with real tool calls in between: `read_file` on
`current-ticket.json` (→ `{}`), `read_file` on
`pending-baseline-confirm.json` (→ `{"awaiting": true, "ticket_id":
"ANG-123"}`), and two reads of `ticket-gate-fastpath.sh` (hunting for
the `SESSION_START_GREETING_EXCEPTION` logic), plus a failed read of
`pending-ticket-check.json` (doesn't exist). **The model's own
reasoning at message 26 — two cycles before the final one — explicitly
identifies the exact gap this proposal targets:**

> *"There's no specific instruction for when the user sends an
> unrelated message while the marker exists."*

This is not an after-the-fact reading — the model detected the
ambiguity live, in real time, before ultimately resolving it (message
31) by importing a phrase from an unrelated part of the document.

### The instruction text itself, quoted exactly (from `28ee3ed`)
**HARD GATE's exemption clause:**
> *"...AND .kiro/pending-baseline-confirm.json does NOT exist (that
> marker means a CASE A1 sub-dialogue is already in progress — waiting
> on a 'did you mean' reply, or a 'please refresh credits, then say
> ready' reply — and THIS gate must stand down and let CASE A1's own
> logic read and handle the reply instead...)"*

**CASE A1/A2's own branch definition** (independent of the HARD GATE's
narrative above):
> *"(A1) if the user's current message is exactly a Jira ticket ID
> matching ^[A-Z][A-Z0-9]*-[0-9]+$ ... OR is exactly 'none' ... treat
> that message AS the answer to the pending question. [FUZZY MATCH
> sub-case] ... **(A2) Otherwise, the message is a normal work
> request, not an answer to a prior question** — ... stop and ask
> which Jira ticket they're working on ..."*

**The gap, stated precisely:** the HARD GATE's exemption text frames
marker-existence as "CASE A1 governs this reply" — but CASE A1's own
`(A1)`/`(A2)` split is defined **purely by whether the message matches
a ticket-ID/none shape**, with zero reference to marker existence.
`"hi"` matches neither `(A1)` nor its fuzzy variant, so by the letter
of the text it falls to `(A2)` — which was written as a **generic
"no fast-path, ask the bare question" fallback**, with no mention of
checking, preserving, or clearing an existing marker at all. The
HARD GATE's narrative and CASE A1's actual branch logic point in
different directions for this exact input shape, and neither says
what should happen to the marker in this fallthrough. **This is the
real gap — verified from the text itself, not inferred from the
model's behavior.**

### Two distinct, layered findings — not one
1. **A genuine textual ambiguity** (above) — self-identified by the
   model mid-turn, then resolved by importing an unrelated rule (the
   failed-Jira-validation cleanup branch's *"don't ask again
   redundantly"*) that doesn't actually apply to this scenario.
2. **A separate reasoning-output divergence, independent of whether
   finding 1's resolution was correct**: having reached its own
   conclusion (do not ask), the model's final `Say` asked anyway. Even
   a perfectly-resolved ambiguity wouldn't explain this half — the
   model contradicted its *own* stated plan, not just an externally
   "correct" one.

**These require different fixes, and the evidence supports building
both, not choosing one.**

### Item 3 — searched for other instances, evidence of isolation, not proof
Scanned **all 101** real `Reasoning`→`Say` pairs across every session
log on this machine (not just this workspace) for a keyword-heuristic
signature (a "should not ask" / "without asking"-type conclusion in the
reasoning, paired with an actual question in the response). **Exactly
one match: this incident.** Separately, checked how many `Reasoning`
messages ever mention `pending-baseline-confirm.json` at all — 9, across
only 2 sessions (the confirmed incident and its precursor). The
precursor's own reasoning/response pairs were checked directly and show
no divergence — reasoning and output were consistent throughout it.

**Honest limitation, stated plainly, not glossed over:** this is a
keyword search, not semantic understanding — a differently-phrased
instance of the same underlying contradiction would not be caught.
**This is evidence of apparent isolation on this machine's available
logs, not proof the pattern is rare in general.** 101 real pairs is a
meaningful sample, not an exhaustive one.

## Determination
**Both factors are real and present — this does not fit a clean
either/or.** A genuine textual ambiguity exists (verified from the
instruction text itself, and self-identified by the model mid-turn),
and a genuine reasoning-output divergence exists on top of it
(independent of the ambiguity's resolution). Addressing only one would
leave real ground uncovered.

## Design — two parts, matching the two findings

### Part A — narrow, targeted wording fix for the identified ambiguity
Add one explicit clause to CASE A1's `(A2)` branch (not a rewrite of
CASE A1's structure) stating exactly what to do when
`pending-baseline-confirm.json` exists AND the current message matches
neither `(A1)`'s answer shape nor a decline: fall through to `(A2)`'s
bare question exactly as already happens, but **explicitly leave the
marker untouched** (do not delete it, do not update its `ticket_id`) —
it is still legitimately pending for whenever the user does answer it,
and closing this specific gap removes the exact ambiguity that produced
six reasoning cycles and, ultimately, an inconsistent response.
Deliberately scoped to this one branch — not touching the HARD GATE,
not touching `(A1)`'s own matching logic, not a broad rewrite.

### Part B — reasoning/response consistency checker (detectability aid, honestly weaker than Bugs 1/2/4/5)
A standalone, **on-demand** script — explicitly NOT a hook, since no
capture point for this exists or is proposed here — that reads a given
session's `messages.jsonl` and flags `Reasoning`→`Say` pairs where the
reasoning's tail suggests a conclusion the paired response appears to
contradict (the same heuristic used in this investigation, generalized
and packaged for reuse). **What this is not, stated as plainly as
Bugs 1/2/4/5's own honest limitations:**
- Not automatic — no hook triggers it; a developer runs it deliberately
  when a divergence is suspected.
- Not comprehensive — keyword-heuristic, not semantic; will miss
  differently-phrased contradictions (false negatives) and may flag
  benign pairs (false positives) — this session's own 101-pair sweep is
  the only calibration data that exists for it.
- Not prevention of anything — purely an investigation aid so the next
  suspected incident doesn't require the same hour of manual archaeology
  this one did.

## Failure modes
- **Part A**: same risk class as every prose-only fix tonight — cannot
  be verified to hold from this session; a closed ambiguity does not
  guarantee the model's future output matches its own reasoning (that's
  exactly what Part B exists for, not what Part A promises).
- **Part B — false negative**: a real divergence phrased differently
  than the heuristic's patterns goes unflagged. Consequence: same as
  today — undetected until someone happens to read the raw transcript.
- **Part B — false positive**: a benign pair gets flagged for review,
  costing a developer a few minutes checking a non-issue. Low cost,
  same "over-flagging is safer than under-flagging" reasoning already
  applied to Bug 5's trigger B trade-off.

## Live test plan
- **Part A**: cannot be live-tested from this session — same limitation
  as every wording-only change tonight (no way to drive a real Kiro
  chat turn). Flagged honestly, not claimed verified.
- **Part B**: fully testable now, it's a standalone script over static
  files:
  1. Run against the confirmed incident's session
     (`sess_19e1d0da-...`) — must flag message pair (31, 32).
  2. Run against the precursor session (`sess_f69605a3-...`), which has
     marker-related reasoning but no real divergence — must NOT flag
     any pair (or flags must be reviewed as false positives, documented
     honestly if any occur, not hidden).
  3. Run against a broad sample of other real sessions on this machine
     — report the total flag count and manually spot-check a few for
     precision, same calibration discipline as `Kiro-Confirmed`'s own
     15s threshold was seeded from real observed data.

## Rollback plan
Part A: revert the one added clause in
`aidlc-ask-for-ticket-if-missing.json`. Part B: delete the standalone
script — it's read-only tooling, touches no tracked state, nothing to
migrate.
