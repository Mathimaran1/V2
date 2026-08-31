#!/bin/bash
# Deterministic command-type replacement for aidlc-bootstrap-git-hooks.json's
# former agent hook. Added 2026-08-31 after confirming live that this
# PostFileSave-triggered hook was firing a full paid agent turn on every
# single file save from OTHER hooks (e.g. the ticket-switch flow's own
# marker-file writes) — even though its own check is two deterministic
# conditions, and its recovery path just needs to restore already-committed
# files from git history, no reasoning required. See docs/runbook.md:256,
# which already flagged PostFileSave as "a much noisier trigger... worth
# revisiting" before this was ever fixed.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

HOOKS_PATH="$(git config core.hooksPath 2>/dev/null || true)"

if [ -f .githooks/pre-commit ] && [ "$HOOKS_PATH" = ".githooks" ]; then
  # Already live — say nothing, cost nothing. This is the overwhelming
  # majority case: every file save on a machine that's already set up.
  exit 0
fi

# Either .githooks/pre-commit is missing, or core.hooksPath isn't pointed
# at .githooks — recreate all five scripts from what's already committed
# at HEAD, same reasoning the original agent hook used: a rewritten-from-
# scratch version would silently reintroduce bugs the real scripts already
# fix (see TODO.md). Recreate all five, not a subset — missing post-commit
# silently loses CASE B, missing pre-push loses the SonarQube gate.
mkdir -p .githooks
if ! git checkout HEAD -- \
  .githooks/pre-commit .githooks/post-checkout .githooks/post-commit \
  .githooks/commit-msg .githooks/pre-push 2>/dev/null; then
  echo "aidlc-bootstrap-git-hooks: .githooks/ scripts are missing AND not recoverable from HEAD — needs manual attention, could not auto-bootstrap." >&2
  exit 1
fi
chmod +x .githooks/*
git config core.hooksPath .githooks
echo "aidlc-bootstrap-git-hooks: git hooks weren't configured on this machine — restored .githooks/{pre-commit,post-checkout,post-commit,commit-msg,pre-push} from HEAD, chmod +x'd them, and set core.hooksPath=.githooks."
exit 0
