# Source repo: GitHub now, CodeCommit later

## Why not CodeCommit today
AWS closed CodeCommit to new customers in July 2024. Tested directly against
this project's AWS account (`143912951401`, `ap-south-1`):

```
$ aws codecommit list-repositories
AccessDeniedException: ...codecommit:ListRepositories...

$ aws codecommit get-repository --repository-name test-check
AccessDeniedException: ...codecommit:GetRepository...
```

Both calls are denied even though the `AWSCodeCommitReadOnly` managed policy
is attached and correctly scoped (`arn:aws:codecommit:ap-south-1:143912951401:*`).
A correctly attached policy denying its own permitted actions isn't an IAM
misconfig — that's the account-level eligibility block. This account is on
the wrong side of the cutoff, so CodeCommit can't be provisioned or read
here regardless of IAM policy.

## The isolation rule
**[`infra/pipeline.source.json`](../infra/pipeline.source.json) is the only
file in this repo that knows which provider CodePipeline reads from.**
Nothing else — hooks, Lambdas, the DuckDB dashboard, the runbook — cares
where the code came from, only that it lands in the pipeline. So:

- The pipeline's source-stage IaC (once built — see `README.md`'s open
  items) must read `provider` from this file, not hardcode a stage type.
- `.githooks/*` already don't reference a remote at all — `git push` just
  goes wherever `origin` points, no code change needed there either.
- Docs and diagrams that say "CodeCommit" should be read as "whatever
  `infra/pipeline.source.json` says" — treat CodeCommit as the eventual,
  not the current, state.

## How to actually switch later
1. Confirm eligibility changed — either an AWS Support exception was
   granted, or the repo now lives in a different, already-grandfathered
   account in the same AWS Organization (with cross-account access wired
   up for the pipeline).
2. Edit `infra/pipeline.source.json`: set `"provider": "codecommit"`,
   fill in `codecommit.repositoryName` / `branch`.
3. Re-apply the pipeline IaC. That's the entire change — one file, one
   deploy. No hook, Lambda, or dashboard code is touched.
4. Optionally: `git remote set-url origin <codecommit-clone-url>` locally
   if devs should push there directly instead of GitHub mirroring to it.

## What "GitHub now" needs when the pipeline gets built
- A CodeStar Connection (Console → Developer Tools → Settings →
  Connections) authorized against the GitHub org/repo.
- Its ARN pasted into `infra/pipeline.source.json` → `github.connectionArn`.
- The PR-gate Lambda (runbook section 2) reads PRs via the GitHub API
  instead of CodeCommit's; same Kiro-tag check either way.
