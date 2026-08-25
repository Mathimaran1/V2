# v1 — Kiro + Jira + AWS Tracking

Company-level project: tracks Kiro usage and code quality per Jira ticket,
from a dev's first commit through the AWS pipeline to an admin-only
dashboard. Full design in [`docs/runbook.md`](docs/runbook.md) and
[`docs/architecture.png`](docs/architecture.png).

**Source repo:** running on GitHub today — this account's AWS CodeCommit
access is blocked (closed to new customers since July 2024, confirmed
against this account). The whole codebase is written to not care which one
it is: see [`docs/source-repo-decision.md`](docs/source-repo-decision.md)
and [`infra/pipeline.source.json`](infra/pipeline.source.json) — that one
file is the only thing that changes to switch to CodeCommit later.

## Build order

1. **Steering** — `.kiro/steering/company-policy.md` (already in place)
2. **MCP → Jira/SonarQube** — `.kiro/settings/mcp.json` (fill in real hosts/tokens)
3. **Specs** — plan each ticket in Kiro before coding
4. **Hooks** — `.kiro/hooks/`, `.githooks/` (already in place, see setup below)
5. **Powers** — check Kiro's Powers catalog before hand-rolling more MCP config
6. **Enterprise settings** — turn on admin reporting only once the workflow works end to end

See `docs/runbook.md` section 0 for the full reasoning behind this order.

## One-time setup

```bash
git init                              # if not already a repo
git config core.hooksPath .githooks
chmod +x .githooks/*
git config commit.template .gitmessage
```

Every dev on the project has to run the `git config core.hooksPath` line
once, or none of the tracking hooks fire on their machine. The
`commit.template` line is optional but recommended — pre-fills a
`Co-authored-by:` line in your editor for pair-programming commits, so it's
one word to fill in rather than something to remember (see `.gitmessage`).

## What still needs to be filled in before this is live

- `.kiro/settings/mcp.json` — real SonarQube host URL
- `.githooks/pre-commit` / `pre-push` — real S3 bucket name (`your-tracking-bucket`)
- `.githooks/pre-push` — real SonarQube project key + host
- AWS side (not yet scaffolded here): PR-gate Lambda, daily/weekly health
  checks, Jira/SonarQube webhook receivers, EventBridge rule for
  CodePipeline, the DuckDB-over-S3 dashboard Lambda — see `docs/runbook.md`
  sections 2 and 4. When this gets built, the pipeline's source stage must
  read from `infra/pipeline.source.json` (see above), not hardcode GitHub
  or CodeCommit.
- `infra/pipeline.source.json` → `github.connectionArn` — real CodeStar
  Connections ARN once one is authorized against the GitHub org/repo.
- Legal sign-off on what's tracked, before turning this on for real (`docs/runbook.md` section 7)

## Layout

```
.kiro/
  steering/company-policy.md   # rules Kiro always follows
  settings/mcp.json            # Jira + SonarQube MCP connections
  hooks/ask-for-ticket-if-missing.json  # Kiro-side hook: ask which ticket (once per branch), and detect mid-session switches
  current-ticket.json          # local, gitignored — current ticket + starting credits
.githooks/
  post-checkout                # clears current-ticket.json on new branch
  pre-commit                   # writes the tracking record + Kiro tag, mirrors to S3
  pre-push                     # SonarQube quality gate, warn/block via SSM
  commit-msg                   # stamps Kiro-Session / Kiro-Credits onto the commit message
.kiro-tracking/                # per-commit tracking JSON + hook-health.log (mostly gitignored in practice)
docs/
  runbook.md                   # full design doc
  architecture.png             # system diagram
  source-repo-decision.md      # why GitHub now / CodeCommit later, and how to switch
infra/
  pipeline.source.json         # single switch point: which repo provider CodePipeline reads from
scripts/
  coverage-report.sh           # local version of "tracked commits ÷ total, per dev" — no AWS needed
```
