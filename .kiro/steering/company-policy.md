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
