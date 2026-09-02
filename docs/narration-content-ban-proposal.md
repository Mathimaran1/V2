# Proposal: explicit content ban on internal file/rule names, not just example phrases

**Status: PROPOSAL — building immediately after, per explicit
instruction. The live-verification limit below is real and stated
before building, not discovered after.**

## This is not a first report — say that plainly

The NARRATION GUARD already exists (`aidlc-ask-for-ticket-if-missing.json`),
already bans a specific list of example phrases ("This is CASE A1",
"First, I need to check...", etc.), already documents its own
"confirmed live 2026-08-31" origin, and is still being violated
tonight — twice, in transcripts already pasted into this session ("I
need to read the current ticket file to determine what to do", "I need
to check the current ticket status and respond accordingly"), and now
a third time per direct report: the agent using the literal internal
identifiers `pending-baseline-confirm.json` and "HARD GATE" in a
visible response. This is the same guard, failing a third distinct
way. A fourth wording pass is not a fresh idea — it's continuing an
experiment that has not yet succeeded, and this proposal says so
instead of presenting a rewrite as if it were new ground.

## What's actually different about this pass, worth doing anyway

The existing guard bans *example phrasings* of narration ("I need to
check...", "Now I'll write..."). The new violations don't literally
match those examples — they're different sentences describing the same
kind of thing. That's a real, identifiable gap: banning a list of
sentences generalizes only as far as the list. This proposal adds a
second, independent axis: a ban on specific *content* — the literal
names of internal files and mechanisms — regardless of what sentence
they appear in. Content-based bans generalize better than phrase-based
ones; they don't depend on guessing every way the same leak could be
worded.

### Exact addition

Appended to the end of the existing NARRATION GUARD paragraph:

> "Separately, and just as absolute: your visible response must NEVER
> contain the literal name of any internal file — anything under
> `.kiro/` or `.kiro-tracking/`, e.g. `current-ticket.json`,
> `pending-baseline-confirm.json`, `pending-ticket-check.json` — or any
> internal rule/mechanism name used in this prompt, e.g. HARD GATE,
> NARRATION GUARD, COST GUARD, MARKER FILE, PRIORITY CHECK, or any
> 'CASE \<letter\>\<number\>' label like CASE A1. Confirmed live
> 2026-09-02: these exact identifiers leaked into a visible response
> even when the surrounding sentence didn't literally match one of the
> banned example phrases above — avoiding the listed phrases is not
> the same as avoiding this leak. If you notice yourself about to type
> any of these strings in your visible response, stop and rewrite the
> sentence without them. The user should never see internal
> implementation details — file names, rule names, or which internal
> case/branch you're in — only the actual question, message, or answer
> they need."

## The honest limit — architectural, not just "prose might fail again"

Two separate things are true here, and they're different in kind:

1. **Like every other wording change tonight, this cannot guarantee
   compliance.** Nothing found tonight closes a prose-reliability gap
   to zero. This is a real, scoped improvement (a second, independent
   axis of the ban), not a claimed fix.

2. **Unlike several of tonight's other fixes, this one has no
   deterministic alternative available.** The write-skip bugs, the
   SIGPIPE bug, the uncommitted-work gate — all moved real logic into
   the command hook, which runs *before* the agent's turn and can
   check/write files deterministically. A command hook has no
   equivalent access to the agent's *outgoing response text* — nothing
   in this project's understanding of Kiro's hook system (`kiro.dev`'s
   documented trigger types) offers a post-response or output-filtering
   hook. There is no code-enforced version of "never mention this
   filename" to fall back to the way there was for "never skip this
   file write." This is currently a prose-only problem by the
   architecture available, not by choice.

## What "build and test" can and cannot mean here

Built: the wording change goes into the real prompt in this same
session. Syntax/JSON validity is fully verifiable here.

**Cannot be done from this session, stated plainly rather than
faked:** "confirm a real response comes back clean" requires observing
an actual live Kiro agent turn's visible output — this Claude Code
session has no mechanism to drive Kiro's own chat agent and receive a
real response. Every confirmed finding and every confirmed fix
tonight that touched agent *behavior* (as opposed to command-hook
*logic*) was verified this same way: you ran a real turn and pasted
the transcript back. That's the only verification path that actually
exists for this category of change, and it applies here too. This
proposal does not claim to have performed that step — it names what's
needed (a fresh empty-ticket turn, or any turn that would previously
have triggered narration) and asks for the transcript once you've run
it.

## What's verifiable now, without a live turn

- JSON validity of the edited hook file.
- The added text is present, unique, and reads clearly on direct
  read-back (not garbled by escaping, not colliding with existing
  wording).
- A grep-based sanity check that the file identifiers named in the new
  sentence match the real files this project actually has (so the ban
  isn't naming something stale or misspelled).

## Rollback plan

One additive sentence appended to the existing NARRATION GUARD
paragraph. Revert by removing it; no schema change, no other file
touched, no interaction with any other tonight's fix.
