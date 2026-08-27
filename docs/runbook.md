# Kiro + Jira + AWS Tracking — Simple Guide

This explains every file we're creating, and the full step-by-step flow, in plain words.

---

## 0. Build order — what to set up first

Don't build everything in section 1 at once. This is the order that
actually works, each stage depending on the one before it:

1. **Steering (rules)** — write `.kiro/steering/aidlc-git-conventions.md` first.
   No tooling needed, just tells Kiro your conventions.
2. **MCP to Jira (connect)** — set up `.kiro/settings/mcp.json` so Kiro
   can actually read tickets. Nothing downstream works without this.
3. **Specs (plan from tickets)** — once Kiro can see a ticket, have devs
   plan with it (requirements → design → tasks) before coding. This is
   what makes "which ticket" a natural question to ask, not a
   bolt-on step.
4. **Hooks (auto-update Jira + auto-lint)** — only now add the
   automation: `aidlc-ask-for-ticket-if-missing`, `aidlc-bootstrap-git-hooks`,
   `post-checkout`, `pre-commit`, `post-commit`, `commit-msg` (all in section 1 below).
5. **Powers** — before building any custom SonarQube or Jira
   integration by hand, check Kiro's Powers catalog first. If a
   Jira or SonarQube power already exists, install it instead of
   maintaining your own MCP config — less to keep updated later.
6. **Enterprise settings (turn on last)** — only once the workflow
   itself works end to end, turn on the admin-side reporting: per-user
   activity reports, model governance, MCP allowlisting. Turning these
   on first, before the workflow is proven, just gives you noisy data
   about a broken process.

Everything below this section is the detail for stages 1–4. Stage 5 is
a quick catalog check, not something to build. Stage 6 is a console
toggle in the Kiro admin console.

---

## 1. The files, in the order they get made

### `.kiro/steering/aidlc-git-conventions.md`
**Who makes it:** you, one time, saved in the project.
**What it does:** tells Kiro the team's rules automatically, so no one has to repeat them.
```markdown
---
inclusion: always
---
# AI DLC Git Conventions — Kiro Usage Rules

## Ticket linking
- Every plan must mention its Jira ticket ID (e.g. PROJ-123).
- Every commit message must start with "PROJ-123: short description".

## Commit message trailer format
Every commit gets six machine-readable trailers, stamped automatically
by `.githooks/commit-msg` — nothing to type by hand:
```
Kiro-Ticket: PROJ-123
Kiro-Episode: ep_68aabbcc1a2b3c
Kiro-Credits: 42
Kiro-Confidence: high
Kiro-Session: 8f3a1c2e-...
Kiro-Source: kiro_session
```
`none`/`n/a` fallbacks apply when a field can't be resolved.

## Credit calculation rule
`Kiro-Credits` is cumulative *within one episode*, not incremental per
commit. Take the MAX per `Kiro-Episode`, then SUM those maxes per
ticket — never sum raw `Kiro-Credits` across commits directly.

## Approved tools
- Only use the "atlassian-rovo" and "aws" connections already set up
  in .kiro/settings/mcp.json.

## Workflow
- Always plan first (requirements → design → steps) before coding.
- Use the safer "ask before doing" mode on production branches.

## Commit hygiene
- Never commit passwords, keys, or .env files.
```
(Consolidated 2026-08-25 from the original `company-policy.md` — same
core rules, renamed, plus the trailer-format and credit-calculation
rules made explicit as steering content instead of living only in
`commit-msg` and this doc. Also fixed the approved-tools names, which
had drifted stale against `mcp.json`'s real `atlassian-rovo`/`aws`
entries.)

### `.kiro/settings/mcp.json`
**Who makes it:** you, one time.
**What it does:** connects Kiro to Jira and SonarQube. Both are required — SonarQube is not optional, because the quality check results feed the dashboard and the merge check.
```json
{
  "mcpServers": {
    "atlassian": {
      "url": "https://mcp.atlassian.com/v1/sse",
      "disabled": false,
      "autoApprove": ["getJiraIssue", "searchJiraIssuesUsingJql"]
    },
    "sonarqube": {
      "url": "https://your-sonarqube-host/mcp",
      "disabled": false,
      "autoApprove": ["getQualityGateStatus", "getProjectIssues"]
    }
  }
}
```

### `.kiro/current-ticket.json`
**Who makes it:** a Kiro hook, automatically.
**What it does:** remembers "which ticket am I working on right now."
```json
{ "ticket_id": "PROJ-123", "credits_at_ticket_start": 200, "episode_id": "ep_68aabbcc1a2b3c" }
```
- Gets filled in when the dev answers Kiro's question "which ticket?"
- Gets emptied automatically when the dev switches to a new branch.
- Briefly holds a fourth field, `pending_switch_to`, while a mid-session
  switch question is awaiting an answer (see the hook below, CASE C) —
  not part of the steady-state schema, gone again as soon as that
  exchange resolves either way.

### Three cases can start a new episode — as of 2026-08-26
There are now three triggers that generate a fresh `episode_id` and
baseline, not two — **CASE B was added and the old CASE B was renamed to
CASE C** (see `TODO.md`'s 2026-08-26 restructure entry for the full
test record):
- **CASE A** (below, in `ask-for-ticket-if-missing.json`) — branch
  switch: `post-checkout` clears the file, the next ask-ticket prompt
  regenerates it.
- **CASE B** (`.githooks/post-commit`, documented further down) — a
  direct, deterministic "working on a different ticket now? (y/n)"
  question after every commit. **This is the primary mechanism now,**
  not CASE C — it doesn't depend on an AI correctly reading intent from
  conversation.
- **CASE C** (below, in `ask-for-ticket-if-missing.json`) — the
  AI-based mid-conversation detection that used to be the only
  mid-session mechanism. Kept as a secondary, best-effort safety net for
  catching a switch *before* anything's been committed — softer by
  design, since it depends on the AI recognizing a switch from natural
  language rather than asking directly.

### `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`
**Who makes it:** you, one time — either through Kiro's Agent Hooks panel ("+ Create Hook"), or hand-written directly in this schema (confirmed: Kiro picks up hand-written files in `.kiro/hooks/` on its own, no UI step required, as long as the shape below is matched exactly).
**What it does:** two of the three episode-starting cases, since both need to fire on every prompt. (1) Asks for the ticket ID when nothing is saved yet (CASE A below). (2) Notices when a dev is planning/working on a *different* ticket than the one saved, without having switched branches or answered CASE B's post-commit question yet — this is the softer, secondary safety net (CASE C below), not the primary mid-session-switch mechanism (that's CASE B, in `.githooks/post-commit` — see further down). Both cases in this file end in a fresh `credits_at_ticket_start` baseline and `episode_id`.
**Note:** this is Kiro's actual hook schema, confirmed by inspecting what the Agent Hooks UI itself writes to disk — an earlier draft of this file used a made-up shape (`when`/`then`/`promptSubmitted`/`agentAction`) that Kiro silently ignored. If you're adding more hooks later, match this shape, not that one.
```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "Ask for ticket if missing (CASE A + CASE C)",
      "trigger": "UserPromptSubmit",
      "action": {
        "type": "agent",
        "prompt": "First check .kiro/current-ticket.json. This hook handles two of the three cases that can start a new episode \u2014 CASE A and CASE C. (CASE B \u2014 a direct, deterministic post-commit question, the primary switch-detection mechanism \u2014 lives entirely in .githooks/post-commit, not in this AI-driven hook. CASE C below is the softer secondary safety net that can catch a switch mid-conversation, before anything has even been committed yet.)\n\nCASE A \u2014 ticket_id is empty or missing: this is a two-step flow across two separate prompts (a hook cannot ask-then-wait-then-save within a single turn) \u2014 so branch on the current message: (A1) if the user's current message is exactly a Jira ticket ID matching ^[A-Z][A-Z0-9]*-[0-9]+$ (e.g. ANG-123) or is exactly 'none', treat that message AS the answer to the pending question \u2014 read the current credit total AND generate a fresh episode_id by running exactly this command (do not improvise another method \u2014 the .vscdb file is binary SQLite, not line/tab-delimited text, and 'sqlite3' CLI is not installed on this machine, so both a raw `cat`/`head` read and a naive Node text-split WILL silently produce a wrong or fabricated number instead of erroring): `python3 -c \"import sqlite3,json,os,time,secrets; con=sqlite3.connect(os.path.expanduser('~/.config/Kiro/User/globalStorage/state.vscdb')); row=con.execute(\\\"SELECT value FROM ItemTable WHERE key='kiro.kiroAgent'\\\").fetchone(); val=row[0]; val=val.decode('utf-8') if isinstance(val,bytes) else val; usage=json.loads(val)['kiro.resourceNotifications.usageState']['usageBreakdowns'][0]['currentUsage']; print(usage); print('ep_'+format(int(time.time()),'x')+secrets.token_hex(3))\"` \u2014 this prints two lines: line 1 is the credit total, line 2 is the new episode_id. Use both verbatim, do not read either off of any other command's raw/truncated output and do not generate the episode_id yourself some other way. Then write {\"ticket_id\": <that value>, \"credits_at_ticket_start\": <line 1>, \"episode_id\": <line 2>} into .kiro/current-ticket.json (this fully replaces the file's contents \u2014 there is no pending_switch_to to worry about here since the file was empty), briefly confirm it's saved, then continue handling the rest of their request normally \u2014 do not ask again. (A2) Otherwise, the message is a normal work request, not an answer to a prior question \u2014 stop and ask which Jira ticket they're working on (or 'none' for work with no ticket) before doing anything else with their request, and wait for their next message to be treated as the answer per (A1).\n\nCASE C \u2014 ticket_id is non-empty: this is the mid-session ticket-switch case (no branch change has happened, so post-checkout never cleared the file) \u2014 also a two-step flow, using a pending_switch_to field in current-ticket.json as the state signal instead of file-emptiness, since the file stays non-empty throughout this whole exchange: (C1) if current-ticket.json ALSO already has a non-empty pending_switch_to field, a switch question was asked on the previous turn \u2014 treat the CURRENT message as the answer to it, not as a new request yet. If the message is a clear affirmative (e.g. 'yes', 'switch', 'confirm', or it repeats the pending_switch_to ticket ID), the switch is confirmed: generate a fresh baseline and episode_id for the NEW ticket by running exactly this command: `python3 -c \"import sqlite3,json,os,time,secrets; con=sqlite3.connect(os.path.expanduser('~/.config/Kiro/User/globalStorage/state.vscdb')); row=con.execute(\\\"SELECT value FROM ItemTable WHERE key='kiro.kiroAgent'\\\").fetchone(); val=row[0]; val=val.decode('utf-8') if isinstance(val,bytes) else val; usage=json.loads(val)['kiro.resourceNotifications.usageState']['usageBreakdowns'][0]['currentUsage']; print(usage); print('ep_'+format(int(time.time()),'x')+secrets.token_hex(3))\"` \u2014 same two-line output as in (A1). Then write {\"ticket_id\": <pending_switch_to's value>, \"credits_at_ticket_start\": <line 1>, \"episode_id\": <line 2>} into current-ticket.json \u2014 this REPLACES the old ticket_id, baseline, and episode_id entirely, and drops the pending_switch_to field (do not carry it over). Briefly confirm the switch happened, then continue with the rest of their request normally. If the message is NOT a clear affirmative (declines, is ambiguous, or is unrelated to the question), default to NOT switching \u2014 this is the safe default, since silently switching on an ambiguous reply risks misattributing credits just as badly as never asking at all. Remove only the pending_switch_to field, leave ticket_id, credits_at_ticket_start, and episode_id exactly as they were, briefly note you're staying on the current ticket, then continue with their original request normally. (C2) Otherwise (no pending_switch_to set), check whether the user's CURRENT message clearly indicates they are now working on or actively planning a SPECIFIC different Jira ticket than the one saved \u2014 i.e. it mentions another ticket ID matching ^[A-Z][A-Z0-9]*-[0-9]+$ in a context suggesting real work or planning on it (not a passing reference, a comparison to past work, or an example). If so, do NOT proceed with their request yet \u2014 ask to confirm: \"You're currently tracked on <the saved ticket_id> \u2014 are you switching to <the mentioned ticket ID>?\", and write pending_switch_to set to that mentioned ticket ID into current-ticket.json, merged in alongside the existing ticket_id/credits_at_ticket_start/episode_id (do not touch those three fields yet), then wait for their next message to be treated as the answer per (C1). If no different ticket is clearly indicated, do nothing extra and proceed with the request normally, exactly as before this whole mid-session-switch logic existed."
      },
      "enabled": true
    }
  ]
}
```
**Why the instruction is a two-branch check, not a straight ask-then-save:** a hook injected on `UserPromptSubmit` runs once per prompt and can't pause mid-turn to wait for the user's reply — it can only ask, and that turn ends there. The user's answer arrives as a *separate* prompt, which re-triggers the same hook. Without branching on "is this message the answer or a new request," the hook would just see the file is still empty and ask again forever, never reaching the save step. (This was found by testing: `current-ticket.json`'s mtime never changed across several rounds of answering the question — confirmed the save step was never running.)
**Where the credit number actually comes from:** `~/.config/Kiro/User/globalStorage/state.vscdb` is a SQLite file (local, no network call). Its `ItemTable` has a row keyed `kiro.kiroAgent` whose value is a JSON blob containing `"kiro.resourceNotifications.usageState"` — an account-level running total that climbs across every session and resets monthly. The number is a decimal (e.g. `229.72`), not an integer — any delta math against it has to account for that.
**Caveat worth keeping in mind:** this total is account-wide, not per-ticket — it only becomes a per-ticket number by taking a delta between two snapshots (baseline at ticket start, current at commit time). If a dev switches which ticket they're working on without switching git branch (so `post-checkout` never clears `current-ticket.json`), the delta for both tickets blends together. The hook instruction above is written to catch this by confirming before it overwrites an existing baseline.

### `.kiro/hooks/aidlc-bootstrap-git-hooks.json`
**Who makes it:** you, one time — same as the ask-for-ticket hook above (hand-written, same schema, picked up by Kiro automatically).
**What it does:** checks whether this repo's git hooks are actually live on *this* machine — both `.githooks/pre-commit` existing AND `git config core.hooksPath` already equal to `.githooks` have to be true, since the files can exist while a fresh clone still hasn't pointed git at them. If either is missing, it recreates all five `.githooks/` scripts (`pre-commit`, `post-checkout`, `post-commit`, `commit-msg`, `pre-push`) from what's already committed elsewhere in the repo's history rather than rewriting them from scratch — the real scripts carry fixes for bugs found by testing (see `TODO.md`) that a reinvented version would silently reintroduce — then `chmod +x`s them and runs `git config core.hooksPath .githooks`. This is what makes "clone the repo, hooks just work" true instead of relying on every dev remembering the one-time step by hand. (`post-commit` added to this list 2026-08-26 alongside the CASE B hook itself — a bootstrap that recreated the other four but not this one would silently leave CASE B missing on every freshly-set-up machine.)

**Trigger is `PostFileSave`, not `sessionStarted` — changed 2026-08-25.** The original version used `sessionStarted`, on the assumption that "runs once when a session begins" was the natural fit for a one-time bootstrap check. Testing disproved that (see `TODO.md`): Kiro's Agent Hooks panel doesn't even list `aidlc-bootstrap-git-hooks.json` when `sessionStarted` is its trigger, and an end-to-end test (fresh session, hooks deliberately torn down first) confirmed it never fires at all. Using the panel's own "+ Create Hook" button defaulted to `PostFileSave`, which suggested that trigger is one Kiro's UI actually offers — so this hook was switched to it as the next thing to try. **This has not yet been confirmed end-to-end working** (unlike the `sessionStarted` failure, which was directly tested) — treat it as the current best guess, not a verified fix, until someone actually watches it fire.
```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "aidlc-bootstrap-git-hooks",
      "trigger": "PostFileSave",
      "action": {
        "type": "agent",
        "prompt": "Check whether this repo's git hooks are actually set up: does .githooks/pre-commit exist, AND does `git config core.hooksPath` already equal '.githooks'? Both must be true — if either is missing, the hooks aren't live even if the files exist. If both are already true, do nothing and proceed normally. If either is missing: (1) create the .githooks/ folder if it doesn't exist; (2) write .githooks/pre-commit, .githooks/post-checkout, .githooks/post-commit, .githooks/commit-msg, AND .githooks/pre-push with their real, current content — read it from what's already committed in this repo's git history if these files exist elsewhere (e.g. a prior commit, or docs/runbook.md's copies of them), do not invent new content or improvise a simplified version, since the real scripts contain fixes for several bugs found by testing (see TODO.md) that a rewritten-from-scratch version would silently reintroduce; recreate all five, not just a subset — a dev missing post-commit silently loses CASE B (the primary mid-session ticket-switch detector, added 2026-08-26 — see TODO.md), and a dev missing pre-push has no SonarQube gate hook at all, either of which is worse than having it present but disabled; (3) run `chmod +x .githooks/*`; (4) run `git config core.hooksPath .githooks`; (5) tell the user what was set up and why (first clone / hooks weren't configured on this machine yet). See .kiro/steering/aidlc-git-conventions.md for the conventions these hooks enforce.\""
      },
      "enabled": true
    }
  ]
}
```
**Note:** unlike `sessionStarted` (fires once, nothing to answer), `PostFileSave` fires on *every file save* — a much noisier trigger for a check that only ever needs to do real work once per machine. The check itself is cheap (two conditions, both fast local checks) and a no-op the moment hooks are already live, so repeated firing is wasteful but not harmful — worth revisiting if a real once-per-session trigger turns out to exist after all.

### `.githooks/post-checkout`
**Who makes it:** you, one time.
**What it does:** empties the saved ticket the moment the dev switches to a new branch, so Kiro knows to ask again.
```bash
#!/bin/bash
if [ "$3" = "1" ]; then
  echo "{}" > .kiro/current-ticket.json
  echo "New branch — Kiro will ask for the ticket next time."
fi
```

### `.githooks/pre-commit`
**Who makes it:** you, one time. **This is the most important file — it writes the actual tracking record.**
```bash
#!/bin/bash
# 0. Consent check — must happen before any tracking activity at all,
# before even gitleaks, since the point is "seen the notice before being
# tracked," not "seen it before being tracked, unless this particular
# commit happens to be clean." A per-USER marker (not per-repo), since
# consent is about the person, not any one project — versioned so a
# future change to what's tracked can force a re-prompt by bumping it.
CONSENT_VERSION="v1"
CONSENT_FILE="$HOME/.kiro-tracking-consent-ack"
if ! grep -q "^$CONSENT_VERSION|" "$CONSENT_FILE" 2>/dev/null; then
  echo "" >&2
  echo "📋 This project tracks Kiro AI usage and credit spend per commit," >&2
  echo "   linked to your Jira ticket and git identity (see docs/runbook.md" >&2
  echo "   section 6 for exactly what's recorded, section 7 for who sees it)." >&2
  echo "" >&2
  read -p "Type 'I agree' to continue (required once per machine): " CONSENT_ANSWER
  if [ "$CONSENT_ANSWER" != "I agree" ]; then
    echo "❌ Commit blocked — consent not given. Re-run and type 'I agree' exactly to proceed." >&2
    exit 1
  fi
  echo "$CONSENT_VERSION|$(date -u +%Y-%m-%dT%H:%M:%SZ)|$(git config user.email)" > "$CONSENT_FILE"
  echo "✅ Consent recorded at $CONSENT_FILE — won't ask again unless this notice changes." >&2
fi

# 1. Check for passwords/keys first — stops the commit if it finds any
gitleaks protect --staged || exit 1

# 2. Find the ticket ID: saved file -> branch name -> ask in terminal
TICKET_ID=$(cat .kiro/current-ticket.json 2>/dev/null | jq -r '.ticket_id // empty')
SOURCE="kiro_session"

if [ -z "$TICKET_ID" ]; then
  TICKET_ID=$(git branch --show-current | grep -oE '^[A-Z]+-[0-9]+')
  SOURCE="branch_name"
fi

if [ -z "$TICKET_ID" ]; then
  read -p "No ticket found. Enter ticket ID (or 'none'): " TICKET_ID
  SOURCE="manual_entry"
fi

# Fail closed, not silently: hit for real (see TODO.md) — a blank read
# (no TTY in an automated context, or a human hitting Enter blank) used
# to sail through and write a malformed record ("ticket_id": "", filename
# starting with "-"). Same posture as the gitleaks check above: block the
# commit rather than write bad tracking data.
if [ -z "$TICKET_ID" ]; then
  echo "❌ No ticket ID resolved — not saved in .kiro/current-ticket.json," >&2
  echo "   branch name didn't match a ticket pattern, and nothing was" >&2
  echo "   entered at the prompt. Commit blocked rather than writing a" >&2
  echo "   malformed tracking record. Answer Kiro's ticket question first," >&2
  echo "   name your branch TICKET-123-..., or re-run and type a real" >&2
  echo "   ticket ID (or 'none') at the prompt." >&2
  exit 1
fi

# 3. Get credit numbers from the real local sources (no kiro-session-info —
#    that command doesn't exist; confirmed by inspecting the actual files):
#    - session id: most recently modified ~/.kiro/sessions/*/*/session.json
#    - credits:    ~/.config/Kiro/User/globalStorage/state.vscdb, key
#                   "kiro.kiroAgent" (JSON) -> "kiro.resourceNotifications
#                   .usageState".usageBreakdowns[0].currentUsage
SESSION_FILE=$(ls -t "$HOME"/.kiro/sessions/*/*/session.json 2>/dev/null | head -1)
SESSION_ID=$(jq -r '.id // empty' "$SESSION_FILE" 2>/dev/null)

CREDITS_NOW=$(python3 -c "
import sqlite3, json, sys
try:
    con = sqlite3.connect('$HOME/.config/Kiro/User/globalStorage/state.vscdb')
    row = con.execute(\"SELECT value FROM ItemTable WHERE key='kiro.kiroAgent'\").fetchone()
    val = row[0]
    if isinstance(val, bytes):
        val = val.decode('utf-8')
    usage = json.loads(val)['kiro.resourceNotifications.usageState']['usageBreakdowns'][0]['currentUsage']
    print(usage)
except Exception:
    sys.exit(1)
" 2>/dev/null)
CREDITS_START=$(cat .kiro/current-ticket.json 2>/dev/null | jq -r '.credits_at_ticket_start // empty')
EPISODE_ID=$(cat .kiro/current-ticket.json 2>/dev/null | jq -r '.episode_id // empty')

# Credits are decimals (e.g. 229.72) — bash's $(( )) only does integers and
# would silently truncate/break here, so use awk for the subtraction instead.
CREDITS_DELTA="null"
if [ -n "$CREDITS_NOW" ] && [ -n "$CREDITS_START" ]; then
  CREDITS_DELTA=$(awk -v now="$CREDITS_NOW" -v start="$CREDITS_START" 'BEGIN{printf "%.4f", now-start}')
fi

# 3b. Confidence flag: the usage cache backing CREDITS_NOW is periodically
# synced, not live (confirmed by testing — see TODO.md), so a commit made
# soon after the baseline was set can read a stale number and show 0.0000
# even when real work happened. We don't have an exact, confirmed refresh
# interval (Kiro's dashboard docs say ~5 min, but our own observed lag once
# ran to ~30 min, so treat 5 min as a floor, not a guarantee) — so flag low
# confidence whenever EITHER signal is present, erring toward under- rather
# than over-claiming precision:
#   - less than 5 min has passed since current-ticket.json's baseline was
#     set (using the file's own mtime as a free proxy — nothing else writes
#     to it besides the ask-ticket hook and post-checkout's reset)
#   - the delta computed out to exactly 0, which is exactly the lag symptom
# credits_used_so_far being cumulative-since-baseline (not per-commit — see
# "Why max, not sum" further below in this doc) means a low-confidence
# read here is always superseded by a later high-confidence one on this
# ticket.
CREDIT_CONFIDENCE="high"
if [ "$CREDITS_DELTA" = "null" ]; then
  CREDIT_CONFIDENCE="low"
elif [ -f .kiro/current-ticket.json ]; then
  BASELINE_SET_AT=$(stat -c %Y .kiro/current-ticket.json 2>/dev/null || echo 0)
  NOW_EPOCH=$(date +%s)
  ELAPSED=$((NOW_EPOCH - BASELINE_SET_AT))
  if [ "$ELAPSED" -lt 300 ] || [ "$CREDITS_DELTA" = "0.0000" ]; then
    CREDIT_CONFIDENCE="low"
  fi
fi

# JSON-quote the session id, or fall back to null. NOTE: the old
# ${VAR:+\"$VAR\"}${VAR:-null} one-liner pattern is broken when VAR IS set —
# ":-null" then returns $VAR itself (not "null"), producing duplicated
# output like "sess_x"sess_x instead of "sess_x". Use an explicit if instead.
if [ -n "$SESSION_ID" ]; then
  SESSION_ID_JSON="\"$SESSION_ID\""
else
  SESSION_ID_JSON="null"
fi

# Same null-quoting pattern for episode_id — will genuinely be empty for
# any current-ticket.json baseline set before this field existed, so this
# is expected, not an error.
if [ -n "$EPISODE_ID" ]; then
  EPISODE_ID_JSON="\"$EPISODE_ID\""
else
  EPISODE_ID_JSON="null"
fi

# 4. Hand the trailer values to commit-msg — no intermediate JSON file.
# REMOVED 2026-08-27: this used to write a brand-new
# ".kiro-tracking/${TICKET_ID}-$(date +%s).json" file EVERY commit and
# `git add` it, so the folder accumulated one committed file per commit
# forever. Grepped the whole repo first to confirm commit-msg's
# `ls -t .kiro-tracking/*.json | head -1` was the ONLY reader anywhere;
# calculate-pr-credits.sh already reads trailers from git history, never
# these files. So the file was pure hop-across-hooks plumbing.
#
# pre-commit and commit-msg are separate git-invoked processes — a shell
# variable set here doesn't survive into commit-msg's process — so this
# writes the values as plain key=value lines into a file inside .git/
# itself: never tracked, never committed, one file, overwritten every
# commit. commit-msg sources it directly and deletes it right after.
GIT_DIR=$(git rev-parse --git-dir)
cat > "$GIT_DIR/KIRO_COMMIT_DATA" << INNER_EOF
KIRO_TICKET_ID="$TICKET_ID"
KIRO_TICKET_SOURCE="$SOURCE"
KIRO_SESSION_ID="$SESSION_ID"
KIRO_CREDITS_DELTA="$CREDITS_DELTA"
KIRO_CREDIT_CONFIDENCE="$CREDIT_CONFIDENCE"
KIRO_EPISODE_ID="$EPISODE_ID"
INNER_EOF

# 4b. Optional debug convenience copy — ONE file per ticket, overwritten
# every commit (not accumulated), gitignored, never `git add`-ed, never
# read by anything. Just lets a human glance at the last commit's
# numbers without decoding trailers.
mkdir -p .kiro-tracking
DEBUG_FILE=".kiro-tracking/${TICKET_ID}.json"
cat > "$DEBUG_FILE" << INNER_EOF
{
  "_comment": "Debug convenience only — overwritten every commit, not read by any hook or script.",
  "ticket_id": "$TICKET_ID",
  "source_of_ticket_id": "$SOURCE",
  "kiro_session_id": $SESSION_ID_JSON,
  "kiro_used": $([ -n "$SESSION_ID" ] && echo true || echo false),
  "credits_used_so_far": $CREDITS_DELTA,
  "credit_confidence": "$CREDIT_CONFIDENCE",
  "episode_id": $EPISODE_ID_JSON,
  "dev": "$(git config user.email)",
  "branch": "$(git branch --show-current)",
  "commit_time": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
INNER_EOF

# 5. S3 upload removed 2026-08-25 — the AWS role is read-only, this line
# was failing every single commit (see hook-health.log's alternating
# ok/failed before this change). The commit message trailers (see
# commit-msg) are the durable, authoritative record — git push and
# reading commit messages back don't need any AWS write access at all.
# Health logging kept, unconditionally "ok" now — nothing here can fail
# once the S3 attempt is gone.
echo "hook_status=ok" >> .kiro-tracking/hook-health.log
```
**Prerequisite:** this now needs `python3` (standard on most dev machines) in addition to `jq`, `gitleaks`, and the AWS CLI — no `sqlite3` CLI binary required, since Python's built-in `sqlite3` module reads the file directly.

### `.githooks/pre-push`
**Who makes it:** you, one time. **This is the SonarQube quality gate — it runs before code ever reaches CodeCommit, not after.**
```bash
#!/bin/bash
# Mode is a single flag you control — start in "warn", switch to "block" once trusted
MODE=$(aws ssm get-parameter --name /kiro-tracking/sonarqube-gate-mode \
  --query 'Parameter.Value' --output text 2>/dev/null || echo "warn")

TICKET_ID=$(cat .kiro/current-ticket.json 2>/dev/null | jq -r '.ticket_id // empty')

# Run the scan and ask SonarQube for the quality gate result
sonar-scanner -Dsonar.projectKey=YOUR_PROJECT \
  -Dsonar.host.url=https://your-sonarqube-host \
  -Dsonar.token="$SONARQUBE_TOKEN" > /tmp/sonar-scan.log 2>&1

GATE_STATUS=$(curl -s -u "$SONARQUBE_TOKEN": \
  "https://your-sonarqube-host/api/qualitygates/project_status?projectKey=YOUR_PROJECT" \
  | jq -r '.projectStatus.status')

# Record the result alongside the commit log, regardless of pass/fail
echo "{\"ticket_id\": \"$TICKET_ID\", \"gate_status\": \"$GATE_STATUS\", \"time\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
  > ".kiro-tracking/${TICKET_ID}-gate-$(date +%s).json"
aws s3 cp ".kiro-tracking/${TICKET_ID}-gate-"*.json "s3://your-tracking-bucket/tracking/" 2>/dev/null

if [ "$GATE_STATUS" != "OK" ]; then
  if [ "$MODE" = "block" ]; then
    echo "❌ SonarQube gate failed — push blocked. See /tmp/sonar-scan.log"
    exit 1
  else
    echo "⚠️ SonarQube gate failed — push allowed (warn mode). Please fix soon."
  fi
fi
```
Start `MODE` at `warn` in AWS Parameter Store. Only flip it to `block` once
you've watched the false-positive rate for a few weeks — same rollout
pattern as the PR-gate Lambda.

### `.kiro-tracking/{TICKET_ID}.json`
**Who makes it:** the pre-commit file above, every commit — overwriting the same file each time. **Debug convenience only, not the real tracking data anymore.**

Until 2026-08-27 this was `{TICKET_ID}-{timestamp}.json`, a brand-new file every commit, `git add`-ed and kept forever. Removed after confirming (grep, across the whole repo) that the only thing that ever read these files was `commit-msg`'s "latest file" lookup — nothing else depended on the history piling up. **The real record now is each commit's own `Kiro-*` trailers** (see `commit-msg` below); `calculate-pr-credits.sh` reads those from git history directly, never this file. pre-commit hands the values to `commit-msg` via a transient `$(git rev-parse --git-dir)/KIRO_COMMIT_DATA` file instead — never tracked, deleted right after `commit-msg` reads it.

This one is gitignored, purely for a human to glance at:
```json
{
  "_comment": "Debug convenience only — overwritten every commit, not read by any hook or script.",
  "ticket_id": "PROJ-123",
  "source_of_ticket_id": "kiro_session",
  "kiro_session_id": "8f3a1c2e-...",
  "kiro_used": true,
  "credits_used_so_far": 42,
  "credit_confidence": "high",
  "dev": "jane.doe@company.com",
  "branch": "PROJ-123-fix-login",
  "commit_time": "2026-08-24T10:15:00Z"
}
```

### `.kiro-tracking/hook-health.log`
**Who makes it:** the pre-commit file, every commit.
**What it does:** so if a hook secretly breaks, you see it in this log instead of just seeing silence.

### `.githooks/commit-msg`
**Who makes it:** you, one time.
**What it does:** writes the same tracking info directly into the commit message, so anyone reading git history can see it without opening a file.
```bash
#!/bin/bash
# Guard: don't rescue an empty message into looking non-empty. Confirmed by
# testing (found while adding a commit.template): git's own "abort on empty
# message" check runs AFTER commit-msg, using whatever this hook produces —
# so unconditionally appending trailers below meant a blank/comments-only
# editor buffer (nothing typed, or a template left unfilled) still
# "succeeded" with a commit whose only content was these two trailer lines,
# silently defeating that safety net. If there's no real message content
# once comments and blank lines are stripped, leave the file untouched so
# git's own check still fires correctly.
REAL_CONTENT=$(grep -v '^#' "$1" | grep -v '^[[:space:]]*$')
if [ -z "$REAL_CONTENT" ]; then
  exit 0
fi

# Trailer values come from pre-commit via a transient file inside .git/ —
# REMOVED 2026-08-27: this used to read `ls -t .kiro-tracking/*.json |
# head -1`, the "latest" of an ever-accumulating, permanently-committed
# JSON file per commit. Confirmed by grep first that this line was the
# only reader of those files anywhere in the repo, so pre-commit now
# hands values across directly instead — see pre-commit's step 4.
# Defaults below match the old jq "// fallback" behavior for a value
# that's missing or never set.
GIT_DIR=$(git rev-parse --git-dir)
DATA_FILE="$GIT_DIR/KIRO_COMMIT_DATA"
KIRO_TICKET_ID="" KIRO_TICKET_SOURCE="" KIRO_SESSION_ID=""
KIRO_CREDITS_DELTA="" KIRO_CREDIT_CONFIDENCE="" KIRO_EPISODE_ID=""
[ -f "$DATA_FILE" ] && . "$DATA_FILE"
rm -f "$DATA_FILE"

TICKET="${KIRO_TICKET_ID:-none}"
EPISODE="${KIRO_EPISODE_ID:-none}"
CREDITS="${KIRO_CREDITS_DELTA:-n/a}"
[ "$CREDITS" = "null" ] && CREDITS="n/a"
CONFIDENCE="${KIRO_CREDIT_CONFIDENCE:-n/a}"
SESSION_ID="${KIRO_SESSION_ID:-none}"
SOURCE="${KIRO_TICKET_SOURCE:-n/a}"
echo "" >> "$1"
echo "Kiro-Ticket: $TICKET" >> "$1"
echo "Kiro-Episode: $EPISODE" >> "$1"
echo "Kiro-Credits: $CREDITS" >> "$1"
echo "Kiro-Confidence: $CONFIDENCE" >> "$1"
echo "Kiro-Session: $SESSION_ID" >> "$1"
echo "Kiro-Source: $SOURCE" >> "$1"
```

### `.githooks/post-commit`
**Who makes it:** you, one time. Added 2026-08-26 — see `TODO.md`'s
2026-08-26 restructure entry for the full test record, including the
agent-initiated-commit gap this hook's TTY guard was written to close.
**What it does:** CASE B, the primary mid-session ticket-switch
detector. Runs right after every successful commit and asks directly —
deterministic, not an AI guess at intent. "n" (or default/empty)
leaves everything untouched; "y" asks for the new ticket, generates a
fresh `episode_id` (same scheme as CASE A/C), reads the current credit
total as the new baseline, and overwrites `current-ticket.json`. Since
this runs *after* the commit, the switch only affects the *next*
commit — the one that triggered the question still carries the old
ticket/episode, confirmed by testing.
```bash
#!/bin/bash
# CASE B: deterministic, non-AI mid-session ticket-switch check. Runs
# right after every successful commit — this is the PRIMARY, reliable
# switch-detection mechanism (CASE C in the ask-ticket hook, AI-based
# and mid-conversation, is the softer secondary safety net for catching
# a switch before anything has been committed yet).
#
# Same episode_id generation scheme as CASE A/C, so every episode_id
# looks the same regardless of which case created it: 'ep_' + hex
# unix-timestamp + 3 random hex bytes.

# TTY availability check: NOT `[ -t 0 ]`. Confirmed by testing (see
# TODO.md) that stdin is not a reliable signal here either way — a real
# human-typed `git commit` in an actual interactive terminal STILL shows
# `[ -t 0 ]` as false for this hook's stdin (same root cause pre-commit
# already hit and worked around). The only signal that was actually true
# for the human case and actually false for a script/agent running
# `git commit` as a subprocess with no controlling terminal at all is
# whether /dev/tty itself is openable — it fails outright (ENXIO) when
# there's no controlling terminal, which is exactly the no-TTY case this
# guards against.
if { : < /dev/tty; } 2>/dev/null; then
  HAS_TTY=1
else
  HAS_TTY=0
  mkdir -p .kiro-tracking
  echo "hook_status=post-commit-switch-check-skipped-no-tty ts=$(date -u +%Y-%m-%dT%H:%M:%SZ) commit=$(git rev-parse HEAD)" >> .kiro-tracking/hook-health.log
fi

if [ "$HAS_TTY" = "1" ]; then
  read -p "Working on a different ticket now? (y/n) " SWITCH_ANSWER < /dev/tty
fi

if [ "$HAS_TTY" = "1" ] && { [ "$SWITCH_ANSWER" = "y" ] || [ "$SWITCH_ANSWER" = "Y" ]; }; then
  read -p "New ticket ID (or 'none'): " NEW_TICKET < /dev/tty
  if [ -n "$NEW_TICKET" ]; then
    RESULT=$(python3 -c "
import sqlite3, json, os, time, secrets
con = sqlite3.connect(os.path.expanduser('~/.config/Kiro/User/globalStorage/state.vscdb'))
row = con.execute(\"SELECT value FROM ItemTable WHERE key='kiro.kiroAgent'\").fetchone()
val = row[0]
val = val.decode('utf-8') if isinstance(val, bytes) else val
usage = json.loads(val)['kiro.resourceNotifications.usageState']['usageBreakdowns'][0]['currentUsage']
print(usage)
print('ep_' + format(int(time.time()), 'x') + secrets.token_hex(3))
" 2>/dev/null)
    CREDITS_NOW=$(echo "$RESULT" | sed -n '1p')
    NEW_EPISODE=$(echo "$RESULT" | sed -n '2p')
    if [ -n "$CREDITS_NOW" ] && [ -n "$NEW_EPISODE" ]; then
      echo "{\"ticket_id\": \"$NEW_TICKET\", \"credits_at_ticket_start\": $CREDITS_NOW, \"episode_id\": \"$NEW_EPISODE\"}" > .kiro/current-ticket.json
      echo "✅ Switched to $NEW_TICKET — new episode $NEW_EPISODE, baseline $CREDITS_NOW credits." >&2
    else
      echo "⚠️  Could not read the current credit baseline — NOT switching, current-ticket.json left untouched." >&2
    fi
  else
    echo "No ticket entered — staying on the current ticket." >&2
  fi
fi
# "n", empty/default answer, or anything else: do nothing at all —
# current-ticket.json untouched, same episode continues.
```
**No-TTY fallback, spelled out:** when `/dev/tty` can't be opened at
all (no controlling terminal — the confirmed case for an AI agent
running `git commit` as a subprocess, Kiro's own or otherwise), the
question is skipped rather than risking a hang on a `read` that will
never receive input, or a wrong "no TTY" false-positive from checking
`[ -t 0 ]` instead (that check was tested directly and found to read
false even for a genuine human-typed commit — see `TODO.md`). The skip
is logged to `.kiro-tracking/hook-health.log` with a timestamp and the
commit SHA so it's a visible, auditable gap, not an invisible one.
Practical consequence: **a commit made entirely by an AI agent never
gets asked about a ticket switch at the terminal-hook level.** This is
mitigated as of 2026-08-26, but at the *chat* level, not the hook
level: `.kiro/steering/aidlc-git-conventions.md` now instructs the
agent to ask the same switch question directly in the conversation,
immediately after any commit it makes itself — see that file's "CASE B,
agent-initiated-commit counterpart" section. That's a behavioral rule,
not code, so it can in principle be missed; this log entry is exactly
the backup for when it is. See `TODO.md`'s entry for this fix for the
real tested transcript.

### One-time step every dev has to do
```bash
git config core.hooksPath .githooks
```
Without this, none of the hooks above will run on that dev's machine.

---

## 2. The parts that live on AWS, not on the dev's laptop

| Part | Runs when | What it's for |
|---|---|---|
| PR check (Lambda) | Every time a Pull Request is opened/updated | Looks for the Kiro tag on every commit. Missing tag → warns at first, later can block the merge. One setting controls warn vs block, so you can turn on blocking only once you trust it. |
| Daily coverage check | Once a day | Counts how many commits actually have tracking data vs. total commits. Tells you "tracking is broken" instead of confusing it with "not using Kiro." A local, on-demand version of the same idea (`scripts/coverage-report.sh`, no AWS needed) already exists — this row is that same metric, run automatically and across the whole team instead of one dev checking their own repo by hand. |
| Weekly health check | Once a week | Tests if reading Kiro's credit number still works, in case a Kiro update changed something. |
| Jira update rule | When the pipeline or SonarQube finishes | Posts the result back onto the ticket automatically. |
| SonarQube alert | When the quality check finishes | Tells AWS the pass/fail result. |
| Dashboard puller | On a schedule | Logs into Jira, Kiro's usage reports, the pipeline, SonarQube, and the tracking files — puts it all together by ticket ID, for admins only. |

---

## 3. The full flow, start to finish

```
1. Dev agrees to the tracking notice (one time, when first setting up Kiro)
2. Jira gives a ticket to a dev → dev makes a branch named after it
3. Switching branch clears the saved ticket
4. Dev opens Kiro → Kiro asks which ticket → dev answers → it's saved,
   along with the starting credit count
5. Dev keeps working, maybe across several sessions or days —
   no more asking, since the ticket is already saved
6. Dev commits →
     a. checks for passwords/keys, stops if it finds any
     b. finds the ticket ID (saved file, or branch name, or just asks)
     c. writes the tracking record
     d. also saves a copy to AWS S3
     e. stamps the commit message itself
7. Dev pushes → pre-push hook runs the SonarQube scan and quality gate
   BEFORE the code reaches AWS at all:
     - gate passes → push proceeds
     - gate fails → warn mode: push proceeds anyway, flagged
                    block mode: push is stopped, dev must fix first
   Either way, the gate result is logged to S3 right here, not later
8. Code reaches AWS CodeCommit (only if the gate allowed it)
9. CodeCommit automatically starts CodePipeline — build and deploy,
   quality is already handled at this point
10. Dev opens a Pull Request → the check looks for the Kiro tag on
    every commit → warns or blocks depending on current setting
11. Jira gets updated with the ticket's status automatically
12. Dev switches to the next ticket's branch → the cycle starts again
13. Separately, on a schedule: everything (Jira, Kiro usage, pipeline,
    SonarQube gate results, tracking files) gets pulled together into
    the admin-only dashboard, matched up by ticket ID
14. The daily and weekly checks run on their own, catching problems
    early instead of you finding out later
```

---

## 4. Getting live ticket/build status (webhooks + DuckDB)

This is separate from everything above — it's how the **admin dashboard**
finds out about status changes, not something that runs on a dev's laptop.

### Why webhooks, not polling
The dashboard shouldn't have to keep asking Jira "did anything change yet?"
every few minutes. Instead, each source tells us the moment something
happens — that's a webhook.

| Source | How it sends updates | Setup needed |
|---|---|---|
| Jira | Automation rule → "Send web request" (built into Jira, no extra tool) | Point it at our endpoint |
| SonarQube | Built-in webhook (Administration → Webhooks) | Point it at our endpoint |
| CodePipeline / CodeCommit | Already pushes events into AWS EventBridge automatically | Add a rule that catches the events we care about |

### What receives them
```
Jira webhook       ─┐
SonarQube webhook   ─┼→ API Gateway → Lambda → writes a small JSON file to S3
CodePipeline event  ─┘   (via EventBridge)
```
Example file the Lambda writes:
```
s3://your-bucket/events/jira/PROJ-123-2026-08-24T10-15-00.json
```
```json
{ "ticket_id": "PROJ-123", "source": "jira", "status": "Done", "time": "2026-08-24T10:15:00Z" }
```
No database write here — just a file landing in S3, same pattern as the
git commit tracking logs.

### How the dashboard reads it all — DuckDB, not a separate database
DuckDB can query the JSON files directly where they sit in S3, and join
them by `ticket_id` with plain SQL — no need to load them into another
database first:
```sql
WITH episode_totals AS (
  SELECT ticket_id, episode_id,
         max(credits_used_so_far) AS episode_credits,
         max(commit_time)         AS episode_last_commit
  FROM read_json_auto('s3://your-bucket/events/**/*.json')
  GROUP BY ticket_id, episode_id
)
SELECT ticket_id,
       sum(episode_credits)    AS total_credits,
       max(episode_last_commit) AS last_commit
FROM episode_totals
GROUP BY ticket_id;
```
**Why `max` per episode, then `sum` across episodes — not one flat `max()` or
`sum()`:** `credits_used_so_far` in each commit's tracking JSON is *cumulative
since that baseline*, not incremental since the previous commit — `pre-commit`
only ever reads `credits_at_ticket_start`, it never rewrites it, so every
commit under the same *baseline* recomputes the delta against the same fixed
starting point. Within one continuous stretch of work (one `episode_id`), the
most recent commit's value already *is* that stretch's total — `sum`ing within
an episode would double-count. But a ticket can have *more than one* baseline
over its life (reopened after being closed, or — before this was tracked —
`"none"` restarting on every use): each reopen gets a fresh `episode_id`, and
a flat `max(credits_used_so_far)` across the whole ticket would silently drop
every episode but whichever one happened to peak highest, not just risk being
stale. Grouping by `(ticket_id, episode_id)` first, then summing those
per-episode maxes, gets both right: correct within an episode, correct across
episodes. (Confirmed by testing that both failure modes are real — see
`TODO.md`.) This also means a commit made shortly after a baseline is set can
show `0.0000` if the underlying usage-tracking cache hasn't synced yet — that's
fine and self-corrects, since it's the latest commit *within that episode*
that matters, not any one commit in isolation. Records with `episode_id: null`
(written before this field existed) won't group correctly — treat those as
their own single-commit episodes, or backfill before relying on this query
over old data.
This one query can pull together webhook events, the git commit tracking
logs, and Kiro's usage reports, all at once, since they're all just files
in S3.

### Where this runs
- **Small scale:** DuckDB runs inside a Lambda (it's a lightweight engine,
  not a server to host) — the dashboard calls that Lambda, which queries
  S3 fresh and returns the result.
- **If it gets slow as files pile up:** add one scheduled job (hourly)
  that runs the query once and saves a single summary file. The
  dashboard reads that summary instead of recomputing every time.

---

## 6. Every login/auth point, the commit log, and the Kiro tag — all in one place

### OAuth and auth, by location
| Where | What kind | What it's for |
|---|---|---|
| Dev signs into Kiro | AWS IAM Identity Center (SSO) | Assigns the Kiro license, identifies which dev is working |
| Kiro ↔ Jira | Atlassian OAuth 2.0 (3LO) | Lets Kiro read/write the dev's own tickets, using the dev's own login |
| Kiro ↔ SonarQube | Dedicated service token, not OAuth — vaulted in AWS Secrets Manager, rotated on schedule | Read-only access to quality-gate results |
| MCP layer ↔ everything | OAuth 2.1 via AWS IAM Identity Center, `client_credentials` grant (no human login) | Lets the dashboard pull from all four sources on a schedule, as its own identity, not any dev's |

The dev's own OAuth logins (rows 2–3) only ever act as that dev. The
dashboard's OAuth (row 4) is a separate, dedicated identity — that
separation is what keeps the dashboard admin-only.

### The commit log, recap
Every commit writes this (see section 1 for the full script):
```json
{
  "ticket_id": "PROJ-123",
  "source_of_ticket_id": "kiro_session",
  "kiro_session_id": "8f3a1c2e-...",
  "kiro_used": true,
  "credits_used_so_far": 42,
  "credit_confidence": "high",
  "dev": "jane.doe@company.com",
  "branch": "PROJ-123-fix-login",
  "commit_time": "2026-08-24T10:15:00Z"
}
```

### The Kiro tag mechanism, step by step
1. **At commit time**, `commit-msg` reads the log file above and appends
   six lines onto the real commit message:
   ```
   PROJ-123: fix login bug

   Kiro-Ticket: PROJ-123
   Kiro-Episode: ep_68aabbcc1a2b3c
   Kiro-Credits: 42
   Kiro-Confidence: high
   Kiro-Session: 8f3a1c2e-...
   Kiro-Source: kiro_session
   ```
2. This tag can only be produced by a real local hook run — nothing
   generates it remotely, so a commit made without hooks configured has
   no tag at all.
3. **At PR time**, the PR-gate Lambda (section 2) reads every commit's
   message in the PR, looking for `Kiro-Session:`. Missing → flagged
   (warn mode) or blocked (block mode, once trusted).
4. **Honest limit:** the tag proves a Kiro session existed for that
   commit — it does not prove the code inside it wasn't written
   somewhere else first and pasted in. It raises the cost of faking it;
   it doesn't make faking it impossible (see the earlier discussion on
   detection layers and behavioral pattern checks).

---

## 7. What still needs a real person, not a script
- Getting legal's OK on what's tracked, before turning this on — the
  *decision* of what's acceptable to track still needs a person; only the
  mechanical "did every dev actually see the notice" part is now enforced
  by `pre-commit`'s consent check (§1, `.githooks/pre-commit`) rather than
  living solely in Kiro's own first-run screen, which a dev committing
  through plain git would never see
- Deciding what "good" usage looks like, and treating low numbers as
  a conversation, not an automatic punishment
- Reviewing changes to these hook files like real code before merging them
