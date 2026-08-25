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
{ "ticket_id": "PROJ-123" }
```
- Gets filled in when the dev answers Kiro's question "which ticket?"
- Gets emptied automatically when the dev switches to a new branch.

### `.kiro/hooks/ask-for-ticket-if-missing.json`
**Who makes it:** you, one time — either through Kiro's Agent Hooks panel ("+ Create Hook"), or hand-written directly in this schema (confirmed: Kiro picks up hand-written files in `.kiro/hooks/` on its own, no UI step required, as long as the shape below is matched exactly).
**What it does:** asks for the ticket ID when a new session starts, but only if nothing is saved yet.
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
        "prompt": "First check .kiro/current-ticket.json. If it already holds a non-empty ticket_id, do nothing extra and proceed with the user's request normally. If it is empty, this is a two-step flow across two separate prompts (a hook cannot ask-then-wait-then-save within a single turn) — so branch on the current message: (1) if the user's current message is exactly a Jira ticket ID matching ^[A-Z][A-Z0-9]*-[0-9]+$ (e.g. ANG-123) or is exactly 'none', treat that message AS the answer to the pending question — read the current credit total from ~/.config/Kiro/User/globalStorage/state.vscdb (the ItemTable row with key 'kiro.kiroAgent' holds a JSON value; read its 'kiro.resourceNotifications.usageState'.usageBreakdowns[0].currentUsage field), write {\"ticket_id\": <that value>, \"credits_at_ticket_start\": <that number>} into .kiro/current-ticket.json, briefly confirm it's saved, then continue handling the rest of their request normally — do not ask again. (2) Otherwise, the message is a normal work request, not an answer to a prior question — stop and ask which Jira ticket they're working on (or 'none' for work with no ticket) before doing anything else with their request, and wait for their next message to be treated as the answer per branch (1). Caveat: if current-ticket.json already holds a different, non-empty ticket_id (i.e. the dev is switching tickets without switching git branch, so post-checkout never cleared it), ask the user to confirm before overwriting the baseline — otherwise credits from the two tickets will blend together in the delta calculation."
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

# Credits are decimals (e.g. 229.72) — bash's $(( )) only does integers and
# would silently truncate/break here, so use awk for the subtraction instead.
CREDITS_DELTA="null"
if [ -n "$CREDITS_NOW" ] && [ -n "$CREDITS_START" ]; then
  CREDITS_DELTA=$(awk -v now="$CREDITS_NOW" -v start="$CREDITS_START" 'BEGIN{printf "%.4f", now-start}')
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
| Daily coverage check | Once a day | Counts how many commits actually have tracking data vs. total commits. Tells you "tracking is broken" instead of confusing it with "not using Kiro." |
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
SELECT ticket_id,
       sum(credits_used_so_far) AS total_credits,
       max(commit_time)         AS last_commit,
       any_value(status)        AS latest_status
FROM read_json_auto('s3://your-bucket/events/**/*.json')
GROUP BY ticket_id;
```
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
- Getting legal's OK on what's tracked, before turning this on
- Deciding what "good" usage looks like, and treating low numbers as
  a conversation, not an automatic punishment
- Reviewing changes to these hook files like real code before merging them
