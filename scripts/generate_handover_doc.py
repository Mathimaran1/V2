#!/usr/bin/env python3
"""Generate the Vantage Project Handover Word document."""

from docx import Document
from docx.shared import Inches, Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_ORIENT
import os

doc = Document()

# ── Global style tweaks ──────────────────────────────────────────────
style = doc.styles["Normal"]
font = style.font
font.name = "Calibri"
font.size = Pt(11)
pf = style.paragraph_format
pf.space_after = Pt(4)
pf.space_before = Pt(2)

for level in range(1, 4):
    hs = doc.styles[f"Heading {level}"]
    hs.font.color.rgb = RGBColor(0x1A, 0x3C, 0x6E)

def add_code_block(doc, code, label=None):
    """Add a code block styled with Courier New, shaded."""
    if label:
        p = doc.add_paragraph()
        r = p.add_run(label)
        r.bold = True
        r.font.size = Pt(10)
    for line in code.strip().split("\n"):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        p.paragraph_format.left_indent = Cm(1)
        r = p.add_run(line)
        r.font.name = "Courier New"
        r.font.size = Pt(8.5)
        r.font.color.rgb = RGBColor(0x33, 0x33, 0x33)

def add_table(doc, headers, rows):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = "Light Grid Accent 1"
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    for i, h in enumerate(headers):
        cell = table.rows[0].cells[i]
        cell.text = h
        for p in cell.paragraphs:
            for r in p.runs:
                r.bold = True
                r.font.size = Pt(10)
    for ri, row in enumerate(rows):
        for ci, val in enumerate(row):
            cell = table.rows[ri + 1].cells[ci]
            cell.text = str(val)
            for p in cell.paragraphs:
                for r in p.runs:
                    r.font.size = Pt(10)
    return table

# ╔═══════════════════════════════════════════════════════════════════╗
# ║  TITLE PAGE                                                      ║
# ╚═══════════════════════════════════════════════════════════════════╝
doc.add_paragraph()
doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("VANTAGE")
r.bold = True
r.font.size = Pt(36)
r.font.color.rgb = RGBColor(0x1A, 0x3C, 0x6E)

p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("AI-Assisted Development Cost Tracking Dashboard")
r.font.size = Pt(18)
r.font.color.rgb = RGBColor(0x55, 0x55, 0x55)

doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Complete Project Handover & Demo Brief")
r.font.size = Pt(14)
r.font.color.rgb = RGBColor(0x33, 0x33, 0x33)

doc.add_paragraph()
p = doc.add_paragraph()
p.alignment = WD_ALIGN_PARAGRAPH.CENTER
r = p.add_run("Prepared: September 2026\nVerified against the running app, not memory")
r.font.size = Pt(11)
r.font.color.rgb = RGBColor(0x77, 0x77, 0x77)

doc.add_page_break()

# ╔═══════════════════════════════════════════════════════════════════╗
# ║  TABLE OF CONTENTS (manual)                                      ║
# ╚═══════════════════════════════════════════════════════════════════╝
doc.add_heading("Table of Contents", level=1)
toc_items = [
    "Part A — Demo Script",
    "  A.1  The Pitch",
    "  A.2  Safe to Click Live (4 confirmed)",
    "  A.3  Risky — Do Not Click Unless Prepared",
    "  A.4  Closing Line",
    "Part B — Full Honest Detail",
    "  B.1  What This Tool Is",
    "  B.2  What's Built and Working",
    "  B.3  What's Under Construction",
    "  B.4  How Commits Work End to End",
    "  B.5  The Credit Formula",
    "  B.6  Full Feature List",
    "  B.7  How Jira, MCP, and .kiro/ Connect",
    "Part C — Architecture & Project Layout",
    "  C.1  Architecture Overview",
    "  C.2  Project File Layout",
    "  C.3  Tech Stack",
    "Part D — Backend Deep Dive",
    "  D.1  FastAPI Application (main.py)",
    "  D.2  CodeCommit Service",
    "  D.3  S3 Usage / Developer Pipeline",
    "  D.4  Credit Calculator",
    "  D.5  DuckDB + Parquet Design",
    "  D.6  Environment Variables (backend/.env)",
    "Part E — Frontend",
    "  E.1  Vite + React + TypeScript",
    "  E.2  Pages & Data Sources",
    "  E.3  Jira OAuth (3LO + PKCE)",
    "Part F — Git Hooks (Complete Source)",
    "  F.1  pre-commit",
    "  F.2  commit-msg",
    "  F.3  post-commit",
    "  F.4  post-checkout",
    "  F.5  pre-push",
    "Part G — Kiro Configuration",
    "  G.1  Steering File (aidlc-git-conventions.md)",
    "  G.2  Agent Hook — Ask for Ticket",
    "  G.3  Agent Hook — Bootstrap Git Hooks",
    "  G.4  Command Hook — Fast-Path Ticket Gate",
    "  G.5  MCP Configuration (.kiro/settings/mcp.json)",
    "Part H — Credit Tracking Mechanics",
    "  H.1  Episode Boundaries (3 Cases)",
    "  H.2  Profile Button Click Requirement",
    "  H.3  Credit Confidence Logic",
    "  H.4  Max-Per-Episode-Then-Sum Formula",
    "  H.5  Time Tracking",
    "Part I — Operational Playbook",
    "  I.1  Setup Instructions",
    "  I.2  Running the Backend",
    "  I.3  Running the Frontend",
    "  I.4  Refreshing Data",
    "  I.5  Calculating PR Credits",
    "  I.6  Known Limitations",
    "Part J — Scripts",
    "  J.1  calculate-pr-credits.sh",
    "  J.2  ticket-gate-fastpath.sh (summary)",
]
for item in toc_items:
    p = doc.add_paragraph(item)
    p.paragraph_format.space_after = Pt(1)
    if not item.startswith(" "):
        for r in p.runs:
            r.bold = True

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# PART A — DEMO SCRIPT
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Part A — Demo Script", level=1)
doc.add_paragraph("Read this first. Use it tomorrow.")

doc.add_heading("A.1  The Pitch — One Sentence", level=2)
p = doc.add_paragraph()
r = p.add_run('"Vantage watches how much AI-assisted coding actually costs, per Jira ticket, by reading the real signal already sitting in your git history — no one has to fill out a timesheet for it."')
r.italic = True

doc.add_heading("A.2  Safe to Click Live — 4 Confirmed", level=2)

doc.add_heading("1. Overview — the real ticket list", level=3)
doc.add_paragraph("Click: Overview (home page)")
doc.add_paragraph('"These three tickets — ANG-123, ANG-4571, ANG-4634 — are real. 29 commits on ANG-123 alone, and that 30.71 credits figure came straight out of the actual git trailers on those commits, computed live by the backend just now."')

doc.add_heading("2. Ticket detail → Commits tab", level=3)
doc.add_paragraph("Click: ANG-123 → Commits tab")
doc.add_paragraph('"Every one of these 29 rows is a real CodeCommit commit, walked live over the branch history. The Kiro trailers you see on each one — episode, credits, confidence — are written automatically by a git hook at commit time, not entered by hand."')

doc.add_heading("3. Users page — real S3 usage data", level=3)
doc.add_paragraph("Click: Users in the sidebar. Switch the date filter between Last 1 day / Last 30 days / Last 90 days.")
doc.add_paragraph('"145 real developers, pulled from 323 real daily usage-report files. Watch the credits column actually change as I switch the window — that\'s a real date filter against real files, not a relabeled static number. Lifetime credits next to it never moves, because it isn\'t scoped to the period."')

doc.add_heading("4. Ticket detail → SonarQube tab", level=3)
doc.add_paragraph("Click: any ticket → SonarQube tab")
doc.add_paragraph('"This one\'s honest about not being wired up yet — \'SonarQube isn\'t connected.\' I\'d rather show you a real empty state than a fabricated quality score."')

doc.add_heading("A.3  Risky — Do Not Click Unless Prepared", level=2)

p = doc.add_paragraph()
r = p.add_run("⚠ Jira tab — OAuth login")
r.bold = True
doc.add_paragraph("The scope bug (read:issue-details:jira → read:jira-work) is fixed in code and verified against Atlassian's real API spec. But it has NOT been re-tested end to end with a real login since the fix, and two frontend dev servers running at once (ports 5173 and 5174) caused the original 'missing code/state/verifier' failure — Jira only ever redirects back to 5174.")
doc.add_paragraph("Before the demo: close any tab on port 5173, keep only 5174, and do one real login yourself to confirm. If you don't get to it, skip the Jira tab live.")

p = doc.add_paragraph()
r = p.add_run("⚠ Users page → clicking into a developer row")
r.bold = True
doc.add_paragraph("The Users list is real. The drill-down page is still the old mock page — it will show 'Developer not found' because it doesn't know about real S3 developer IDs yet. Workaround: stay on the list view, don't click into a row.")

doc.add_heading("A.4  Closing Line", level=2)
p = doc.add_paragraph()
r = p.add_run('"Ticket tracking and CodeCommit-backed views — Overview, Commits, and the Users/S3 pipeline — are built and tested end to end, with real numbers behind every figure on screen today. Jira is code-complete and one login test away; SonarQube and the individual developer drill-down are the next phase."')
r.italic = True

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# PART B — FULL HONEST DETAIL
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Part B — Full Honest Detail", level=1)
doc.add_paragraph("Not for reading aloud — background for questions.")

doc.add_heading("B.1  What This Tool Is", level=2)
doc.add_paragraph("Vantage is an internal observability dashboard for AI-assisted development. It answers: how much did the AI actually contribute to this ticket, and what did it cost in credits? It's for engineering managers and team leads who fund Kiro/AI-assisted work and want per-ticket, per-developer cost visibility without asking anyone to self-report — the signal is pulled from git history and the vendor's own usage reports, not a form.")

doc.add_heading("B.2  What's Built and Working — With Evidence", level=2)

doc.add_paragraph("Git hooks — .githooks/, confirmed present on disk: commit-msg, post-checkout, post-commit, pre-commit, pre-push. pre-commit blocks in three real cases: no ticket ever chosen (exit 1), gitleaks finds a secret (exit 1), or consent declined (exit 1). commit-msg writes the real trailers and deliberately does nothing if the message has no real content.")

doc.add_paragraph("Backend — FastAPI on :8000. Six routers: tickets, commits, pullrequests, refresh, jira, developers. Commits/PRs from local Parquet populated by refresh_data.py's real CodeCommit walk.")

doc.add_paragraph("S3 usage pipeline — bucket kiro-prompts-log-metadata, 323 real daily CSV files (KIRO_IDE, PLUGIN, KIRO_CLI), downloaded concurrently (~7s), cached in-memory (5 min TTL), aggregated into 145 real developers. Three on-disk CSV snapshots: developers_1d.csv, developers_30d.csv, developers_90d.csv.")

doc.add_heading("Frontend Pages — Real Data vs. Mock", level=3)
add_table(doc,
    ["Page", "Data Source", "Status"],
    [
        ["Overview", "GET /api/tickets", "Real"],
        ["Ticket → Commits", "GET /api/commits/:id", "Real"],
        ["Ticket → Pull Requests", "GET /api/pullrequests/:id", "Real (0 PRs on ANG-123 — real, not broken)"],
        ["Ticket → Jira", "Live Atlassian OAuth + REST v3", "Code-complete, untested since fix"],
        ["Ticket → SonarQube", 'Hardcoded "not connected"', "Honest stub"],
        ["Users (list)", "GET /api/developers", "Real"],
        ["Developer detail", "Mock array, 10 fake IDs", 'Mock — "not found" for real users'],
    ]
)

doc.add_heading("B.3  What's Under Construction", level=2)
doc.add_paragraph("Jira OAuth — scope bug fixed (read:issue-details:jira → read:jira-work). Second bug ('missing code/state/verifier') caused by two frontend dev servers on different ports. Unverified end-to-end since fix.")
doc.add_paragraph("SonarQube — no backend route exists (404). SONARQUBE_URL/TOKEN blank in .env. Frontend shows honest 'not connected' state. Blocked on getting a real SonarQube server URL and token.")
doc.add_paragraph("Coverage % — email-match logic is real but there's no email overlap between S3 usage data and the one tracked repo's commit authors. Column removed from UI rather than shown permanently empty.")
doc.add_paragraph("Other gaps: developer drill-down page; Overview date-range filter (honestly disabled); no persistent commit/PR cache beyond last refresh_data.py run.")

doc.add_heading("B.4  How Commits Work End to End", level=2)
doc.add_paragraph("Real example — ticket ANG-123, commit 7aa2ae5:")
add_code_block(doc, """ANG-123: Update hook logic and conventions documentation

Kiro-Ticket: ANG-123
Kiro-Episode: ep_6a9004015a45d5
Kiro-Credits: 2.18
Kiro-Confidence: low
Kiro-Session: sess_d135c328-da9c-4df7-96d9-295006eed3e0
Kiro-Source: kiro_session
Kiro-Jira-Validated: n/a""")
doc.add_paragraph("Seven trailers, written automatically by commit-msg. Blocks outright: no ticket chosen, secret caught by gitleaks, consent declined. Informs only: Kiro-Confidence: low (credit delta suspicious) and Kiro-Jira-Validated (whether ticket was confirmed against real Jira).")

doc.add_heading("B.5  The Credit Formula", level=2)
doc.add_paragraph('Max-per-episode, then sum. Within an episode, Kiro-Credits is a running cumulative total — the last commit already contains everything spent before it. Summing every commit\'s credits would double-count.')
doc.add_paragraph("Illustration: episode ep_A commits at 1.0 → 2.5 → 4.0; episode ep_B commits at 0.8 → 1.6. Total = max(4.0) + max(1.6) = 5.6, not 1.0+2.5+4.0+0.8+1.6 = 9.9.")
p = doc.add_paragraph()
r = p.add_run("Real confirmed total for ANG-123 across 29 commits: 30.71 credits.")
r.bold = True

doc.add_heading("B.6  Full Feature List", level=2)
add_table(doc,
    ["Feature", "Status"],
    [
        ["Git hooks (consent, secret scan, ticket gate)", "WORKING"],
        ["Kiro-* trailer writing", "WORKING"],
        ["Max-per-episode credit aggregation", "WORKING"],
        ["Live CodeCommit read (per-ticket branch walk)", "WORKING"],
        ["Overview (ticket list)", "WORKING"],
        ["Ticket detail → Commits / Pull Requests", "WORKING"],
        ["Ticket detail → Jira", "PARTIAL"],
        ["Ticket detail → SonarQube", "NOT STARTED"],
        ["Users list (real S3 usage + date filter)", "WORKING"],
        ["Developer drill-down", "NOT STARTED"],
        ["Coverage % (usage ↔ commit email match)", "PARTIAL — logic real, data doesn't overlap yet"],
        ["Local Parquet cache (commits/PRs)", "WORKING"],
        ["Real on-disk CSV snapshots (developers)", "WORKING"],
        ["Overview date-range filter", "NOT STARTED (honestly disabled)"],
    ]
)

doc.add_heading("B.7  How Jira, MCP, and .kiro/ Connect — And Why", level=2)
doc.add_paragraph("Two completely separate Jira connections exist, on purpose:")
doc.add_paragraph("1. .kiro/settings/mcp.json's atlassian-rovo MCP server — gives the AI agent read access to Jira/Confluence during development. Every mutating tool (create/edit/transition issues, post comments) is explicitly disabled. This is the AGENT's own development-time connection.")
doc.add_paragraph("2. The frontend's own OAuth 2.0 (3LO) + PKCE flow in jiraAuth.ts — the END USER's Atlassian login, letting the deployed dashboard show real ticket data. No MCP involved.")
doc.add_paragraph("The aws MCP server (mcp-proxy-for-aws, read-only, codecommit-role/kiro-s3-readonly profiles) is the agent's own AWS access, distinct from the backend's boto3 STS-assume-role calls using static keys in backend/.env.")
doc.add_paragraph("Why .kiro/ hooks: tracking happens at commit time, locally, before code leaves the machine — a git hook is the one guaranteed execution point.")
doc.add_paragraph("Why DuckDB + Parquet: no long-running write workload. refresh_data.py periodically pulls from CodeCommit and writes a file; the API layer only reads. DuckDB queries Parquet with real SQL (joins, aggregation) with zero server process to run.")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# PART C — ARCHITECTURE & LAYOUT
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Part C — Architecture & Project Layout", level=1)

doc.add_heading("C.1  Architecture Overview", level=2)
add_code_block(doc, """Jira ticket --> Kiro (asks which ticket, tracks credits) --> git hooks
   (assigns          (.kiro/hooks/, .kiro/steering/)         (.githooks/)
    work)                                                         |
                                                                  v
                                                    commit, stamped with
                                                    Kiro-Ticket/Episode/
                                                    Credits/Confidence/
                                                    Session/Source trailers
                                                                  |
                                          +---------------------------+
                                          v                           v
                                  git push -> pre-push        PR opened -> PR-gate
                                  (SonarQube gate --           (AWS Lambda -- NOT BUILT)
                                   currently disabled)
                                          |
                                          v
                              GitHub today (CodeCommit blocked for this AWS account)
                                          |
                                          v
                          Admin dashboard (DuckDB over Parquet -- THIS IS VANTAGE)""")

doc.add_heading("C.2  Project File Layout", level=2)
add_code_block(doc, """.kiro/
  steering/aidlc-git-conventions.md     # rules Kiro always follows
  settings/mcp.json                     # atlassian-rovo (Jira), aws (read-only)
  hooks/aidlc-ask-for-ticket-if-missing.json   # CASE A + C episode start
  hooks/aidlc-ask-for-ticket-fastpath.json     # command hook, zero-cost gate
  hooks/aidlc-bootstrap-git-hooks.json         # auto-setup .githooks/
  hooks/aidlc-session-greeting.json            # session start greeting
  current-ticket.json                   # gitignored — current ticket + credits baseline
  pending-ticket-check.json             # gitignored — deferred Jira validation
  pending-baseline-confirm.json         # gitignored — mid-dialogue marker
  consent-version                       # single source of truth for consent version string

.githooks/
  pre-commit      # consent + gitleaks + ticket gate + credit read + trailer handoff
  commit-msg      # stamps Kiro-* trailers onto commit message
  post-commit     # CASE B episode boundary (ticket switch question)
  post-checkout   # CASE A — clears current-ticket.json on branch switch
  pre-push        # SonarQube gate (currently disabled)

.kiro-tracking/     # gitignored — debug JSON per ticket + hook-health.log

backend/
  main.py                               # FastAPI app
  .env                                  # AWS credentials, repo config (gitignored)
  requirements.txt                      # fastapi, uvicorn, boto3, duckdb, pandas, pyarrow
  routes/
    tickets.py, commits.py, pullrequests.py, refresh.py, jira.py, developers.py
  services/
    codecommit_service.py               # real CodeCommit branch walk
    s3_usage_service.py                 # real S3 usage report pipeline
    credit_calculator.py                # max-per-episode-then-sum
    duckdb_service.py                   # DuckDB over Parquet
    pullrequests_service.py
  data/
    commits.parquet                     # generated by refresh_data.py
    pullrequests.parquet
    developers_1d.csv, developers_30d.csv, developers_90d.csv   # S3 snapshots
  scripts/
    refresh_data.py                     # populates Parquet from CodeCommit

vantage-frontend/
  package.json                          # React 19, Vite 8, TypeScript 6, recharts
  src/
    App.tsx                             # router + layout
    pages/Overview/, TicketDetail/, Users/, DeveloperDetail/, Auth/
    services/api.ts, jiraApi.ts, jiraAuth.ts, mockData.ts
    types/index.ts

scripts/
  calculate-pr-credits.sh              # per-ticket credit total from trailers
  ticket-gate-fastpath.sh              # command hook fast-path
  coverage-report.sh
  bootstrap-git-hooks-check.sh

docs/
  runbook.md                           # full design doc
  architecture.png
  *.md                                 # various proposal/investigation docs

infra/
  pipeline.source.json                 # repo provider switch (GitHub / CodeCommit)""")

doc.add_heading("C.3  Tech Stack", level=2)
add_table(doc,
    ["Layer", "Technology", "Notes"],
    [
        ["Frontend", "React 19 + TypeScript 6 + Vite 8", "lucide-react icons, recharts charts, react-router-dom v6"],
        ["Backend", "Python FastAPI + Uvicorn", "DuckDB for Parquet queries, boto3 for AWS"],
        ["Data storage", "Parquet (commits/PRs) + CSV (developers)", "No traditional database — DuckDB queries files directly"],
        ["AWS - CodeCommit", "boto3 STS assume-role", "codecommit-role profile, ap-south-1"],
        ["AWS - S3 Usage", "boto3 STS assume-role", "kiro-s3-readonly profile, us-east-1 bucket"],
        ["Jira (agent)", "atlassian-rovo MCP", "Read-only, mutating tools disabled"],
        ["Jira (frontend)", "OAuth 2.0 3LO + PKCE", "jiraAuth.ts / jiraApi.ts"],
        ["Git hooks", "Bash", "5 hooks in .githooks/"],
        ["Secret scanning", "gitleaks", "Runs in pre-commit"],
        ["Kiro hooks", "JSON + agent/command types", "UserPromptSubmit, PostFileSave, SessionStart triggers"],
        ["Linting", "oxlint", "Frontend only"],
    ]
)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# PART D — BACKEND DEEP DIVE
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Part D — Backend Deep Dive", level=1)

doc.add_heading("D.1  FastAPI Application", level=2)
doc.add_paragraph("Entry point: backend/main.py. Six routers registered:")
add_table(doc,
    ["Router", "Endpoint(s)", "Data Source"],
    [
        ["tickets", "GET /api/tickets", "DuckDB over commits.parquet (grouped by Kiro-Ticket)"],
        ["commits", "GET /api/commits/:ticketId", "DuckDB over commits.parquet"],
        ["pullrequests", "GET /api/pullrequests/:ticketId", "DuckDB over pullrequests.parquet"],
        ["refresh", "POST /api/refresh, POST /api/refresh/:ticketId", "Triggers CodeCommit walk → Parquet"],
        ["jira", "GET /api/jira/* + OAuth callback", "Proxies to Atlassian REST v3"],
        ["developers", "GET /api/developers?days=1|30|90", "Live S3 usage pipeline"],
    ]
)

doc.add_heading("D.2  CodeCommit Service (codecommit_service.py)", level=2)
doc.add_paragraph("Real AWS CodeCommit access for the repo specified in CODECOMMIT_REPO_NAME / CODECOMMIT_BRANCH env vars. Uses STS assume-role (AWS_CODECOMMIT_ROLE_ARN) because the base IAM user has no codecommit:* permissions.")
doc.add_paragraph("History walk: CodeCommit has no 'git log' equivalent — only GetBranch (head commit id) and GetCommit (one commit + parents). History is walked manually following parents back from branch head, up to max_commits_walked (default 500).")
doc.add_paragraph("Trailer parsing finds the message's last blank-line-delimited block and only reads trailers from there — immune to the grep bug that scripts/calculate-pr-credits.sh documents.")
doc.add_paragraph("Returns commits oldest-first, filtered by Kiro-Ticket trailer matching the requested ticket_id.")

doc.add_heading("D.3  S3 Usage / Developer Pipeline (s3_usage_service.py)", level=2)
doc.add_paragraph("Real per-developer usage from S3 bucket kiro-prompts-log-metadata. 323 daily CSV files across three client types (KIRO_IDE, PLUGIN, KIRO_CLI), going back to April 2026.")
doc.add_paragraph("Two cache layers:")
doc.add_paragraph("1. In-process TTL cache (5 min) of raw rows — serves repeated requests without re-hitting S3")
doc.add_paragraph("2. On-disk CSV snapshots (developers_1d.csv, developers_30d.csv, developers_90d.csv) — written every real refresh, human-readable evidence files")
doc.add_paragraph("Concurrent download (~7s for 323 files, vs ~90s sequential). 20 worker threads.")
doc.add_paragraph("Per-developer aggregation: SUM(Credits_Used) over date-filtered rows. Two independent numbers per developer: creditsUsed (period-filtered) and lifetimeCreditsUsed (all-time).")
doc.add_paragraph("Uses a separate STS role (AWS_KIRO_S3_ROLE_ARN) into a different AWS account than CodeCommit. S3 client pinned to us-east-1 (bucket's real region).")

doc.add_heading("D.4  Credit Calculator (credit_calculator.py)", level=2)
doc.add_paragraph("Port of the frontend's computeCreditsUsed(): MAX-PER-EPISODE-THEN-SUM. Groups commits by Kiro-Episode, takes max Kiro-Credits within each episode, sums across episodes.")
doc.add_paragraph("Also provides jira_validation_summary(): 'false anywhere wins' — if any commit for a ticket has kiroJiraValidated == False, the whole ticket shows as unvalidated.")

doc.add_heading("D.5  DuckDB + Parquet Design", level=2)
doc.add_paragraph("No traditional database. refresh_data.py walks CodeCommit and writes commits.parquet / pullrequests.parquet. The API layer reads these via DuckDB — real SQL (joins, aggregation, filtering) with zero server process.")
doc.add_paragraph("This design fits because there's no long-running write workload: the refresh script runs periodically, the API only reads.")

doc.add_heading("D.6  Environment Variables (backend/.env)", level=2)
doc.add_paragraph("The .env file is gitignored and contains real AWS credentials. Required variables:")
add_table(doc,
    ["Variable", "Purpose"],
    [
        ["AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY", "Base IAM user credentials (no direct CodeCommit access)"],
        ["AWS_REGION", "ap-south-1 (CodeCommit region)"],
        ["AWS_CODECOMMIT_ROLE_ARN", "Role to assume for CodeCommit access (account 143912951401)"],
        ["AWS_KIRO_S3_ROLE_ARN", "Role to assume for S3 usage data (account 456166332425)"],
        ["CODECOMMIT_REPO_NAME", "e.g. HCM-ALCS-BE-AIDLC-TEST"],
        ["CODECOMMIT_BRANCH", "e.g. v1-import"],
        ["KIRO_USAGE_S3_BUCKET", "kiro-prompts-log-metadata"],
        ["KIRO_USAGE_S3_PREFIX", "Path prefix for usage CSV files"],
        ["JIRA_CLIENT_ID / JIRA_CLIENT_SECRET", "Atlassian OAuth app credentials"],
        ["JIRA_REDIRECT_URI", "Must match exactly one frontend dev server port"],
        ["SONARQUBE_URL / SONARQUBE_TOKEN", "Currently blank — SonarQube not connected"],
    ]
)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# PART E — FRONTEND
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Part E — Frontend", level=1)

doc.add_heading("E.1  Vite + React + TypeScript", level=2)
doc.add_paragraph("Located in vantage-frontend/. Built with Vite 8, React 19, TypeScript 6. Linted with oxlint.")
doc.add_paragraph("Key dependencies: react-router-dom (routing), recharts (charts), lucide-react (icons).")
doc.add_paragraph("Dev server: npm run dev (Vite on port 5173 or 5174). Build: npm run build (tsc + vite build).")
doc.add_paragraph("Vite proxy forwards /api/* to http://localhost:8000 (the FastAPI backend).")

doc.add_heading("E.2  Pages & Data Sources", level=2)
add_table(doc,
    ["Page", "Route", "Real Data?"],
    [
        ["Overview", "/", "Yes — GET /api/tickets"],
        ["Ticket Detail", "/tickets/:id", "Yes — commits, PRs tabs real; Jira untested; SonarQube stub"],
        ["Users", "/users", "Yes — GET /api/developers?days=N"],
        ["Developer Detail", "/developers/:id", "No — mock data, shows 'Developer not found'"],
        ["Auth Callback", "/auth/callback", "Jira OAuth redirect landing"],
    ]
)

doc.add_heading("E.3  Jira OAuth (3LO + PKCE)", level=2)
doc.add_paragraph("Flow: jiraAuth.ts generates PKCE code_verifier/challenge → redirects to Atlassian authorize URL → callback exchanges code for token → jiraApi.ts calls REST v3 /rest/api/3/issue/{key}.")
doc.add_paragraph("Scope fix: changed from read:issue-details:jira to read:jira-work (what the API actually requires).")
doc.add_paragraph("Known issue: JIRA_REDIRECT_URI must match exactly one running dev server port. Two servers = 'missing code/state/verifier' error.")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# PART F — GIT HOOKS (Complete Source)
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Part F — Git Hooks (Complete Source)", level=1)
doc.add_paragraph("All five hooks live in .githooks/ and are activated via: git config core.hooksPath .githooks")

doc.add_heading("F.1  pre-commit", level=2)
doc.add_paragraph("The most important hook — handles consent, secret scanning, ticket validation, credit reading, confidence calculation, and trailer handoff to commit-msg.")
doc.add_paragraph("Key behaviors:")
doc.add_paragraph("• Consent check: one-time 'I agree' prompt per machine, versioned via .kiro/consent-version")
doc.add_paragraph("• gitleaks protect --staged: blocks commit if secrets found")
doc.add_paragraph("• Ticket gate: blocks commit (exit 1) if no ticket_id has ever been set")
doc.add_paragraph("• KIRO_AGENT_COMMIT env var: skips terminal prompts when agent is committing")
doc.add_paragraph("• 5-minute timeout on all terminal prompts (read -t 300)")
doc.add_paragraph("• Credit read from ~/.config/Kiro/User/globalStorage/state.vscdb via python3")
doc.add_paragraph("• Credit confidence: high/low based on cache freshness (timestamp-based) and delta value")
doc.add_paragraph("• Writes KIRO_COMMIT_DATA to .git/ for commit-msg to source")

doc.add_heading("F.2  commit-msg", level=2)
doc.add_paragraph("Sources KIRO_COMMIT_DATA from .git/, appends seven Kiro-* trailers to the commit message. Guards against empty messages (won't rescue a blank message into looking non-empty).")
doc.add_paragraph("Trailers written: Kiro-Ticket, Kiro-Episode, Kiro-Credits, Kiro-Confidence, Kiro-Session, Kiro-Source, Kiro-Jira-Validated.")

doc.add_heading("F.3  post-commit", level=2)
doc.add_paragraph("CASE B episode boundary: asks 'Working on a different ticket now? (y/n)' after every successful commit.")
doc.add_paragraph("• Checks KIRO_AGENT_COMMIT first — skips terminal question for agent commits")
doc.add_paragraph("• 5-minute timeout on the question")
doc.add_paragraph("• 'y' → asks for new ticket ID → defers real ticket to .kiro/pending-ticket-check.json for Jira validation; 'none' → immediate switch with real baseline")
doc.add_paragraph("• Uncommitted-work gate: warns if new dirty files exist before allowing a switch to 'none'")

doc.add_heading("F.4  post-checkout", level=2)
doc.add_paragraph("CASE A: clears .kiro/current-ticket.json on branch switch ($3=1). Also clears pending-ticket-check.json and pending-baseline-confirm.json. Lightweight consent marker check (log-only, never blocks).")

doc.add_heading("F.5  pre-push", level=2)
doc.add_paragraph("SonarQube quality gate — currently disabled with a warning banner. The real gate logic exists below the early exit but uses placeholder values (YOUR_PROJECT, your-sonarqube-host). Consent marker check (log-only).")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# PART G — KIRO CONFIGURATION
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Part G — Kiro Configuration", level=1)

doc.add_heading("G.1  Steering File", level=2)
doc.add_paragraph("File: .kiro/steering/aidlc-git-conventions.md")
doc.add_paragraph("Inclusion: always (front-matter: inclusion: always)")
doc.add_paragraph("This file defines all the rules the AI agent follows automatically. Key sections:")
doc.add_paragraph("• Ticket linking: every commit starts with TICKET-ID: description")
doc.add_paragraph("• Ticket assignment is mandatory: real ticket or explicit 'none', never silent")
doc.add_paragraph("• Commit message trailer format: eight Kiro-* trailers")
doc.add_paragraph("• Episode boundaries: three cases (A=branch switch, B=post-commit, C=AI-detected)")
doc.add_paragraph("• Refresh before baseline: profile icon click required before credit reads")
doc.add_paragraph("• Before committing: MANDATORY profile icon click, three-case A/B/C split")
doc.add_paragraph("• Credit calculation rule: max-per-episode-then-sum")
doc.add_paragraph("• Time tracking rule: same pattern for Kiro-Elapsed-Minutes")
doc.add_paragraph("• Approved tools: only atlassian-rovo and aws MCP connections")
doc.add_paragraph("• Reasoning-Response Consistency Check: compare reasoning against response before sending")

doc.add_heading("G.2  Agent Hook — Ask for Ticket (aidlc-ask-for-ticket-if-missing.json)", level=2)
doc.add_paragraph("Trigger: UserPromptSubmit (fires on every user message)")
doc.add_paragraph("Type: agent (full AI turn)")
doc.add_paragraph("Purpose: handles CASE A (empty ticket → ask) and CASE C (mid-session switch detection)")
doc.add_paragraph("Key mechanisms in the prompt:")
doc.add_paragraph("• HARD GATE: if no ticket set and message isn't a ticket ID, ONLY ask the ticket question")
doc.add_paragraph("• COST GUARD: minimize MCP calls — only call Jira when actively validating a candidate")
doc.add_paragraph("• NARRATION GUARD: never expose internal file names, rule names, or case labels to user")
doc.add_paragraph("• MARKER FILE: .kiro/pending-baseline-confirm.json signals mid-dialogue to fast-path")
doc.add_paragraph("• PRIORITY CHECK: validates pending-ticket-check.json (from post-commit's switch flow)")
doc.add_paragraph("• CASE A1: ticket ID answer → Jira validation → profile click → baseline capture")
doc.add_paragraph("• CASE A2: non-answer → ask the bare ticket question")
doc.add_paragraph("• CASE C1: pending switch confirmation → validate → switch")
doc.add_paragraph("• CASE C2: detect different ticket mention → uncommitted-work check → ask to confirm")
doc.add_paragraph("• Fuzzy matching: 'ang-123' or 'ANG - 123' normalized, confirmed with 'Did you mean?'")
doc.add_paragraph("• Jira validation: existence-check only, not assignment-check; cloudId via getAccessibleAtlassianResources")

doc.add_heading("G.3  Agent Hook — Bootstrap Git Hooks (aidlc-bootstrap-git-hooks.json)", level=2)
doc.add_paragraph("Trigger: PostFileSave")
doc.add_paragraph("Type: agent")
doc.add_paragraph("Purpose: auto-setup .githooks/ on fresh clones. Checks if .githooks/pre-commit exists AND core.hooksPath is set. Recreates all five hooks from repo history if missing.")
doc.add_paragraph("Note: trigger was changed from sessionStarted (confirmed never fires) to PostFileSave. Not yet confirmed working end-to-end.")

doc.add_heading("G.4  Command Hook — Fast-Path Ticket Gate (aidlc-ask-for-ticket-fastpath.json)", level=2)
doc.add_paragraph("Trigger: UserPromptSubmit (fires before the agent hook)")
doc.add_paragraph("Type: command (runs scripts/ticket-gate-fastpath.sh)")
doc.add_paragraph("Purpose: zero-cost gate for the common case (empty ticket + non-answer message). Exit 2 blocks the prompt with the ticket question in stderr — zero agent tokens spent.")
doc.add_paragraph("Also handles: pre-switch commit gate (auto-commits to preserve episode credits before switch), uncommitted-work gate, session-start greeting exception, fuzzy ticket matching, candidate detection logging.")

doc.add_heading("G.5  MCP Configuration", level=2)
doc.add_paragraph("File: .kiro/settings/mcp.json")
add_code_block(doc, """{
  "mcpServers": {
    "atlassian-rovo": {
      "url": "https://mcp.atlassian.com/v1/mcp/authv2",
      "disabled": false,
      "autoApprove": [],
      "disabledTools": [
        "createJiraIssue", "editJiraIssue", "transitionJiraIssue",
        "addCommentToJiraIssue", "createConfluencePage",
        "updateConfluencePage", "createConfluenceFooterComment",
        "createConfluenceInlineComment"
      ]
    },
    "aws": {
      "command": "uvx",
      "args": [
        "mcp-proxy-for-aws@1.6.4",
        "https://aws-mcp.us-east-1.api.aws/mcp",
        "--profile", "codecommit-role", "kiro-s3-readonly",
        "--region", "ap-south-1", "--read-only"
      ],
      "env": { "AWS_REGION": "ap-south-1", "AWS_DEFAULT_REGION": "ap-south-1" },
      "disabled": false,
      "autoApprove": []
    }
  }
}""")
doc.add_paragraph("atlassian-rovo: read-only access to Jira/Confluence. All mutating tools explicitly disabled.")
doc.add_paragraph("aws: read-only via mcp-proxy-for-aws, scoped to codecommit-role and kiro-s3-readonly profiles, pinned to ap-south-1.")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# PART H — CREDIT TRACKING MECHANICS
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Part H — Credit Tracking Mechanics", level=1)

doc.add_heading("H.1  Episode Boundaries — Three Cases", level=2)
doc.add_paragraph("A fresh episode_id and credits_at_ticket_start baseline gets generated by exactly three triggers:")

p = doc.add_paragraph()
r = p.add_run("CASE A — Branch switch.")
r.bold = True
doc.add_paragraph("post-checkout clears current-ticket.json on any branch checkout. The next ask-ticket prompt regenerates it. Code-enforced (real hook, cannot be forgotten).")

p = doc.add_paragraph()
r = p.add_run("CASE B — Post-commit direct question (primary, reliable).")
r.bold = True
doc.add_paragraph("post-commit asks 'Working on a different ticket now? (y/n)' after every commit. Deterministic, not AI-based. 'y' → asks for new ticket → defers to Kiro chat for Jira validation. Agent-commit and no-TTY cases skip and log. 5-minute timeout.")

p = doc.add_paragraph()
r = p.add_run("CASE C — AI-detected mid-conversation switch (secondary, best-effort).")
r.bold = True
doc.add_paragraph("The ask-for-ticket hook watches conversation for signs of a switch to a different ticket before anything's been committed. Softer than CASE B — depends on AI recognizing intent from natural language. Safety net, not primary mechanism.")

doc.add_paragraph("All three produce episode_id values in the same format ('ep_' + hex(unix_timestamp) + 3 random hex bytes).")

doc.add_heading("H.2  Profile Button Click Requirement", level=2)
doc.add_paragraph("CRITICAL: Kiro's credit cache (state.vscdb) is stale for up to ~30 minutes. A human physically clicking the profile icon in the sidebar forces a real resync. Calling the dashboard command programmatically does NOT force a resync — the button and the command are wired to different code paths.")
doc.add_paragraph("This matters in two places:")
doc.add_paragraph("1. Before establishing a NEW baseline (Ask #1): when any episode-starting case writes a fresh credits_at_ticket_start. A stale baseline poisons every commit for the rest of that episode.")
doc.add_paragraph("2. Before every commit's own credit read (Ask #2): pre-commit's terminal/chat prompt. Only affects that single commit's number.")
doc.add_paragraph("Three-way split mirrors episode boundaries: CASE A (terminal prompt, 5-min timeout), CASE B (agent asks in chat, MANDATORY FIRST STEP before any git commit), CASE C (no human present, confidence correctly goes low).")

doc.add_heading("H.3  Credit Confidence Logic", level=2)
doc.add_paragraph("Every commit gets a 'high' or 'low' confidence flag, using two signals:")
doc.add_paragraph("• Cache freshness: state.vscdb's internal timestamp. Under 2 min old → HIGH (override). Over 10 min old → LOW (override). Between 2-10 min → falls through to elapsed heuristic.")
doc.add_paragraph("• Elapsed-since-baseline heuristic (fallback): less than 5 min since baseline set, or delta is exactly 0.0000 → LOW.")

doc.add_heading("H.4  Max-Per-Episode-Then-Sum Formula", level=2)
doc.add_paragraph("Kiro-Credits is cumulative WITHIN one episode, not incremental per commit. To get a ticket's real total:")
doc.add_paragraph("Step 1: For each unique (ticket, episode) pair, take the MAX Kiro-Credits value")
doc.add_paragraph("Step 2: SUM those per-episode maxes per ticket")
doc.add_paragraph("Never sum raw Kiro-Credits across commits — it double-counts. Reference implementation: scripts/calculate-pr-credits.sh and backend/services/credit_calculator.py.")

doc.add_heading("H.5  Time Tracking", level=2)
doc.add_paragraph("Kiro-Episode-Started: fixed UTC timestamp, written once per episode alongside credits_at_ticket_start.")
doc.add_paragraph("Kiro-Elapsed-Minutes: recalculated fresh every commit (current time minus episode_started_at). Same max-per-episode-then-sum aggregation as credits.")
doc.add_paragraph("A commit predating this field has no Kiro-Episode-Started/Kiro-Elapsed-Minutes — excluded only from elapsed-time total, not from credits total.")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# PART I — OPERATIONAL PLAYBOOK
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Part I — Operational Playbook", level=1)

doc.add_heading("I.1  Setup Instructions", level=2)
add_code_block(doc, """# One-time per machine:
git config core.hooksPath .githooks
chmod +x .githooks/*
git config commit.template .gitmessage   # optional

# Backend:
cd backend
pip install -r requirements.txt
# Copy .env from a teammate (contains real AWS credentials — never committed)

# Frontend:
cd vantage-frontend
npm install""")

doc.add_heading("I.2  Running the Backend", level=2)
add_code_block(doc, """cd backend
uvicorn main:app --reload --port 8000""")
doc.add_paragraph("Health check: GET http://localhost:8000/api/health → {\"status\": \"ok\"}")

doc.add_heading("I.3  Running the Frontend", level=2)
add_code_block(doc, """cd vantage-frontend
npm run dev""")
doc.add_paragraph("Opens on http://localhost:5174 (or 5173). Vite proxy forwards /api/* to :8000.")
doc.add_paragraph("IMPORTANT: Only run ONE dev server at a time. Two servers break Jira OAuth redirect.")

doc.add_heading("I.4  Refreshing Data", level=2)
doc.add_paragraph("Commits/PRs: POST /api/refresh (all tracked tickets) or POST /api/refresh/{ticketId} (one ticket). This calls refresh_data.py which walks CodeCommit and writes Parquet files.")
doc.add_paragraph("Developer usage: GET /api/developers triggers S3 fetch if cache is expired (5-min TTL). force_refresh=true to bypass cache.")

doc.add_heading("I.5  Calculating PR Credits", level=2)
add_code_block(doc, """# By local commit range:
scripts/calculate-pr-credits.sh --range <base>..<head>

# By GitHub PR (needs gh CLI):
scripts/calculate-pr-credits.sh --repo <owner/repo> --pr <number>""")

doc.add_heading("I.6  Known Limitations", level=2)
add_table(doc,
    ["Gap", "Status", "Notes"],
    [
        ["git rebase clears current-ticket.json", "Open", "post-checkout's $3=1 fires on rebase too"],
        ["git cherry-pick skips all hooks", "Open", "Standard git behavior, cannot fix locally"],
        ["--no-verify bypasses tracking", "Open", "Only server-side PR-gate could catch this"],
        ["Developer drill-down shows 'not found'", "Open", "Mock data, needs real S3 developer IDs"],
        ["Overview date-range filter", "Not started", "Users page has the real version already"],
        ["SonarQube integration", "Not started", "No real token/URL configured yet"],
        ["calculate-pr-credits.sh trailer parsing", "Known bug", "Matches ANY line starting with trailer name, not just trailing block"],
    ]
)

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# PART J — SCRIPTS
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Part J — Key Scripts", level=1)

doc.add_heading("J.1  calculate-pr-credits.sh", level=2)
doc.add_paragraph("Calculates total Kiro credits per ticket from git trailer history. Two modes: --range (local commits, works now) and --repo/--pr (GitHub PR via gh CLI, untested — no remote configured).")
doc.add_paragraph("Aggregation: same max-per-episode-then-sum as the backend. Also surfaces Jira validation status per ticket ('false anywhere wins').")

doc.add_heading("J.2  ticket-gate-fastpath.sh (summary)", level=2)
doc.add_paragraph("~715 lines of bash. The command hook that sits in front of the agent hook, handling zero-cost deterministic cases. Key responsibilities:")
doc.add_paragraph("• Empty ticket + non-answer message: exit 2 with ticket question (zero agent cost)")
doc.add_paragraph("• Pre-switch commit gate: auto-commits empty commit to capture episode credits before a ticket switch")
doc.add_paragraph("• Uncommitted-work gate: blocks switch if new dirty files exist since episode start")
doc.add_paragraph("• Fuzzy ticket matching: normalizes 'ang - 123' → 'ANG-123', writes marker file")
doc.add_paragraph("• Candidate detection logging: append-only .kiro/candidate-detection-log.jsonl with 24h pruning")
doc.add_paragraph("• Session-start greeting exception detection")
doc.add_paragraph("• Stale marker detection and recovery")
doc.add_paragraph("• Kiro-Confirmed gap-seconds computation (ask_confirmed / ask_confirmed_gap_seconds)")

doc.add_page_break()

# ══════════════════════════════════════════════════════════════════════
# APPENDIX — GITIGNORE
# ══════════════════════════════════════════════════════════════════════
doc.add_heading("Appendix A — .gitignore", level=1)
add_code_block(doc, """.env
**/.env
backend/__pycache__/
backend/**/__pycache__/
backend/data/*.parquet
backend/data/tracked_tickets.txt
.kiro/current-ticket.json
.kiro/pending-ticket-check.json
.kiro/pending-baseline-confirm.json
.kiro/candidate-detection-log.jsonl
.kiro/pending-session-greeting.json
/tmp/sonar-scan.log
.kiro-tracking/
.DS_Store
*.swp
.claude/""")

doc.add_heading("Appendix B — requirements.txt", level=1)
add_code_block(doc, """fastapi
uvicorn[standard]
boto3
python-dotenv
httpx
duckdb
pandas
pyarrow""")

doc.add_heading("Appendix C — package.json (frontend)", level=1)
add_code_block(doc, """{
  "name": "vantage-frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "oxlint",
    "preview": "vite preview"
  },
  "dependencies": {
    "lucide-react": "^1.40.0",
    "react": "^19.2.8",
    "react-dom": "^19.2.8",
    "react-router-dom": "^6.30.6",
    "recharts": "^2.15.4"
  },
  "devDependencies": {
    "@types/node": "^24.13.3",
    "@types/react": "^19.2.18",
    "@types/react-dom": "^19.2.4",
    "@vitejs/plugin-react": "^6.1.0",
    "oxlint": "^1.79.0",
    "typescript": "~6.0.2",
    "vite": "^8.2.2"
  }
}""")

# ── Save ──────────────────────────────────────────────────────────────
output_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "Vantage_Project_Handover.docx")
doc.save(output_path)
print(f"Saved to {output_path}")
