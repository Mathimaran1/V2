# Kiro + Jira + AWS Tracking — Simple Guide

This explains every file we're creating, and the full step-by-step flow, in plain words.

---

## 0. Build order — what to set up first

Don't build everything in section 1 at once. This is the order that
actually works, each stage depending on the one before it:

1. **Steering (rules)** — write `.kiro/steering/company-policy.md` first.
   No tooling needed, just tells Kiro your conventions.
2. **MCP to Jira (connect)** — set up `.kiro/settings/mcp.json` so Kiro
   can actually read tickets. Nothing downstream works without this.
3. **Specs (plan from tickets)** — once Kiro can see a ticket, have devs
   plan with it (requirements → design → tasks) before coding. This is
   what makes "which ticket" a natural question to ask, not a
   bolt-on step.
4. **Hooks (auto-update Jira + auto-lint)** — only now add the
   automation: `ask-for-ticket-if-missing`, `post-checkout`, `pre-commit`,
   `commit-msg` (all in section 1 below).
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

### `.kiro/steering/company-policy.md`
**Who makes it:** you, one time, saved in the project.
**What it does:** tells Kiro the team's rules automatically, so no one has to repeat them.
```markdown
---
inclusion: always
---
# Company Policy — Kiro Usage Rules

## Ticket linking
- Every plan must mention its Jira ticket ID (e.g. PROJ-123).
- Every commit message must start with "PROJ-123: short description".

## Approved tools
- Only use the "atlassian" and "sonarqube" connections already set up
  in .kiro/settings/mcp.json.

## Workflow
- Always plan first (requirements → design → steps) before coding.
- Use the safer "ask before doing" mode on production branches.

## Commit hygiene
- Never commit passwords, keys, or .env files.
```

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
  switch question is awaiting an answer (see the hook below, CASE B) —
  not part of the steady-state schema, gone again as soon as that
  exchange resolves either way.

### `.kiro/hooks/ask-for-ticket-if-missing.json`
**Who makes it:** you, one time — either through Kiro's Agent Hooks panel ("+ Create Hook"), or hand-written directly in this schema (confirmed: Kiro picks up hand-written files in `.kiro/hooks/` on its own, no UI step required, as long as the shape below is matched exactly).
**What it does:** two jobs in one hook, since both need to fire on every prompt. (1) Asks for the ticket ID when nothing is saved yet (CASE A below). (2) Notices when a dev is planning/working on a *different* ticket than the one saved, without having switched branches — `post-checkout` only clears the file on an actual branch switch, so without this, that scenario silently misattributes credits (CASE B below). Both cases end in a fresh `credits_at_ticket_start` baseline and `episode_id` — a branch switch and a mid-session switch are the two things that should ever start a new episode; this hook is what makes the second one actually happen instead of just being a documented gap (see `TODO.md`).
**Note:** this is Kiro's actual hook schema, confirmed by inspecting what the Agent Hooks UI itself writes to disk — an earlier draft of this file used a made-up shape (`when`/`then`/`promptSubmitted`/`agentAction`) that Kiro silently ignored. If you're adding more hooks later, match this shape, not that one.
```json
{
  "version": "v1",
  "hooks": [
    {
      "name": "Ask for ticket if missing",
      "trigger": "UserPromptSubmit",
      "action": {
        "type": "agent",
        "prompt": "First check .kiro/current-ticket.json. There are two top-level cases.\n\nCASE A — ticket_id is empty or missing: this is a two-step flow across two separate prompts (a hook cannot ask-then-wait-then-save within a single turn) — so branch on the current message: (A1) if the user's current message is exactly a Jira ticket ID matching ^[A-Z][A-Z0-9]*-[0-9]+$ (e.g. ANG-123) or is exactly 'none', treat that message AS the answer to the pending question — read the current credit total AND generate a fresh episode_id by running exactly this command (do not improvise another method — the .vscdb file is binary SQLite, not line/tab-delimited text, and 'sqlite3' CLI is not installed on this machine, so both a raw `cat`/`head` read and a naive Node text-split WILL silently produce a wrong or fabricated number instead of erroring): `python3 -c \"import sqlite3,json,os,time,secrets; con=sqlite3.connect(os.path.expanduser('~/.config/Kiro/User/globalStorage/state.vscdb')); row=con.execute(\\\"SELECT value FROM ItemTable WHERE key='kiro.kiroAgent'\\\").fetchone(); val=row[0]; val=val.decode('utf-8') if isinstance(val,bytes) else val; usage=json.loads(val)['kiro.resourceNotifications.usageState']['usageBreakdowns'][0]['currentUsage']; print(usage); print('ep_'+format(int(time.time()),'x')+secrets.token_hex(3))\"` — this prints two lines: line 1 is the credit total, line 2 is the new episode_id. Use both verbatim, do not read either off of any other command's raw/truncated output and do not generate the episode_id yourself some other way. Then write {\"ticket_id\": <that value>, \"credits_at_ticket_start\": <line 1>, \"episode_id\": <line 2>} into .kiro/current-ticket.json (this fully replaces the file's contents — there is no pending_switch_to to worry about here since the file was empty), briefly confirm it's saved, then continue handling the rest of their request normally — do not ask again. (A2) Otherwise, the message is a normal work request, not an answer to a prior question — stop and ask which Jira ticket they're working on (or 'none' for work with no ticket) before doing anything else with their request, and wait for their next message to be treated as the answer per (A1).\n\nCASE B — ticket_id is non-empty: this is the mid-session ticket-switch case (no branch change has happened, so post-checkout never cleared the file) — also a two-step flow, using a pending_switch_to field in current-ticket.json as the state signal instead of file-emptiness, since the file stays non-empty throughout this whole exchange: (B1) if current-ticket.json ALSO already has a non-empty pending_switch_to field, a switch question was asked on the previous turn — treat the CURRENT message as the answer to it, not as a new request yet. If the message is a clear affirmative (e.g. 'yes', 'switch', 'confirm', or it repeats the pending_switch_to ticket ID), the switch is confirmed: generate a fresh baseline and episode_id for the NEW ticket by running exactly this command: `python3 -c \"import sqlite3,json,os,time,secrets; con=sqlite3.connect(os.path.expanduser('~/.config/Kiro/User/globalStorage/state.vscdb')); row=con.execute(\\\"SELECT value FROM ItemTable WHERE key='kiro.kiroAgent'\\\").fetchone(); val=row[0]; val=val.decode('utf-8') if isinstance(val,bytes) else val; usage=json.loads(val)['kiro.resourceNotifications.usageState']['usageBreakdowns'][0]['currentUsage']; print(usage); print('ep_'+format(int(time.time()),'x')+secrets.token_hex(3))\"` — same two-line output as in (A1). Then write {\"ticket_id\": <pending_switch_to's value>, \"credits_at_ticket_start\": <line 1>, \"episode_id\": <line 2>} into current-ticket.json — this REPLACES the old ticket_id, baseline, and episode_id entirely, and drops the pending_switch_to field (do not carry it over). Briefly confirm the switch happened, then continue with the rest of their request normally. If the message is NOT a clear affirmative (declines, is ambiguous, or is unrelated to the question), default to NOT switching — this is the safe default, since silently switching on an ambiguous reply risks misattributing credits just as badly as never asking at all. Remove only the pending_switch_to field, leave ticket_id, credits_at_ticket_start, and episode_id exactly as they were, briefly note you're staying on the current ticket, then continue with their original request normally. (B2) Otherwise (no pending_switch_to set), check whether the user's CURRENT message clearly indicates they are now working on or actively planning a SPECIFIC different Jira ticket than the one saved — i.e. it mentions another ticket ID matching ^[A-Z][A-Z0-9]*-[0-9]+$ in a context suggesting real work or planning on it (not a passing reference, a comparison to past work, or an example). If so, do NOT proceed with their request yet — ask to confirm: \"You're currently tracked on <the saved ticket_id> — are you switching to <the mentioned ticket ID>?\", and write pending_switch_to set to that mentioned ticket ID into current-ticket.json, merged in alongside the existing ticket_id/credits_at_ticket_start/episode_id (do not touch those three fields yet), then wait for their next message to be treated as the answer per (B1). If no different ticket is clearly indicated, do nothing extra and proceed with the request normally, exactly as before this whole mid-session-switch logic existed."
      },
      "enabled": true
    }
  ]
}
```
**Why the instruction is a two-branch check, not a straight ask-then-save:** a hook injected on `UserPromptSubmit` runs once per prompt and can't pause mid-turn to wait for the user's reply — it can only ask, and that turn ends there. The user's answer arrives as a *separate* prompt, which re-triggers the same hook. Without branching on "is this message the answer or a new request," the hook would just see the file is still empty and ask again forever, never reaching the save step. (This was found by testing: `current-ticket.json`'s mtime never changed across several rounds of answering the question — confirmed the save step was never running.)
**Where the credit number actually comes from:** `~/.config/Kiro/User/globalStorage/state.vscdb` is a SQLite file (local, no network call). Its `ItemTable` has a row keyed `kiro.kiroAgent` whose value is a JSON blob containing `"kiro.resourceNotifications.usageState"` — an account-level running total that climbs across every session and resets monthly. The number is a decimal (e.g. `229.72`), not an integer — any delta math against it has to account for that.
**Caveat worth keeping in mind:** this total is account-wide, not per-ticket — it only becomes a per-ticket number by taking a delta between two snapshots (baseline at ticket start, current at commit time). If a dev switches which ticket they're working on without switching git branch (so `post-checkout` never clears `current-ticket.json`), the delta for both tickets blends together. The hook instruction above is written to catch this by confirming before it overwrites an existing baseline.

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

# 4. Write the record and include it in this same commit
mkdir -p .kiro-tracking
LOGFILE=".kiro-tracking/${TICKET_ID}-$(date +%s).json"
cat > "$LOGFILE" << INNER_EOF
{
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
git add "$LOGFILE"

# 5. Also save a copy to S3, so it's safe even if something happens locally
aws s3 cp "$LOGFILE" "s3://your-tracking-bucket/tracking/" 2>/dev/null || \
  echo "hook_status=failed" >> .kiro-tracking/hook-health.log
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

### `.kiro-tracking/{TICKET_ID}-{timestamp}.json`
**Who makes it:** the pre-commit file above, every single commit. **This is the real tracking data.**
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

### `.kiro-tracking/hook-health.log`
**Who makes it:** the pre-commit file, every commit.
**What it does:** so if a hook secretly breaks, you see it in this log instead of just seeing silence.

### `.githooks/commit-msg`
**Who makes it:** you, one time.
**What it does:** writes the same tracking info directly into the commit message, so anyone reading git history can see it without opening a file.
```bash
#!/bin/bash
# NOTE: must read one whole file, not `cat *.json | tail -1` — pre-commit writes
# each record pretty-printed across multiple lines, so `tail -1` on concatenated
# files grabs a lone trailing "}" and jq fails on it (confirmed by testing: both
# trailers below came out empty, not even their "none"/"n/a" fallback).
#
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

LATEST_LOGFILE=$(ls -t .kiro-tracking/*.json 2>/dev/null | head -1)
SESSION_ID=$(jq -r '.kiro_session_id // "none"' "$LATEST_LOGFILE" 2>/dev/null)
CREDITS=$(jq -r '.credits_used_so_far // "n/a"' "$LATEST_LOGFILE" 2>/dev/null)
echo "" >> "$1"
echo "Kiro-Session: $SESSION_ID" >> "$1"
echo "Kiro-Credits: $CREDITS" >> "$1"
```

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
   two lines onto the real commit message:
   ```
   PROJ-123: fix login bug

   Kiro-Session: 8f3a1c2e-...
   Kiro-Credits: 42
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
