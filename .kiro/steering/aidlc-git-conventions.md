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
`none`/`n/a` fallbacks apply when a field can't be resolved — see
`docs/runbook.md` for the exact per-field rules.

## Credit calculation rule
`Kiro-Credits` is cumulative *within one episode* (one continuous
credit baseline), not incremental per commit, and not directly
comparable across episodes. To get a ticket's real total: take the
MAX `Kiro-Credits` value per `Kiro-Episode`, then SUM those per-episode
maxes per ticket. Never sum raw `Kiro-Credits` across commits directly
— it double-counts, since each value already includes everything since
that episode's own baseline. See `docs/runbook.md` and
`scripts/calculate-pr-credits.sh` for the reference implementation.

## Approved tools
- Only use the "atlassian-rovo" and "aws" connections already set up
  in .kiro/settings/mcp.json.

## Workflow
- Always plan first (requirements → design → steps) before coding.
- Use the safer "ask before doing" mode on production branches.

## Commit hygiene
- Never commit passwords, keys, or .env files.
