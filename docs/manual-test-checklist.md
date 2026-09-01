# Manual Test Checklist

Run this after any change to `.githooks/` or `.kiro/hooks/`, and once
when setting up a new repo, to confirm everything still works end to
end.

Every test below is written to be run **in order**, on a disposable
branch, and undone by the **Cleanup** section at the end — so this
file can be re-run repeatedly with no leftover residue in the repo.

---

## 0. Prerequisites — do this first, every time

- [ ] Back up your real tracking state and switch to a scratch branch:
  ```bash
  cp .kiro/current-ticket.json /tmp/current-ticket.json.bak 2>/dev/null || true
  git checkout -b test-hooks-manual
  ```
  **Expect:** clean new branch, backup file exists (or the `|| true`
  silently no-ops if you had no ticket set yet).

- [ ] Confirm hooks are actually wired up before testing them:
  ```bash
  git config core.hooksPath
  ```
  **Expect:** prints `.githooks`. If empty, run
  `git config core.hooksPath .githooks && chmod +x .githooks/*` first.

---

## 1. Consent gate

Only relevant on a machine that has never committed here before. Your
marker (`~/.kiro-tracking-consent-ack`) likely already exists — skip
straight to section 2 unless you want to see this fresh.

- [ ] Simulate a first-time machine:
  ```bash
  mv ~/.kiro-tracking-consent-ack ~/.kiro-tracking-consent-ack.bak
  git commit --allow-empty -m "test: consent gate"
  ```
  **Expect:** commit blocks and prompts you to type `I agree`.

- [ ] Restore your real marker:
  ```bash
  mv ~/.kiro-tracking-consent-ack.bak ~/.kiro-tracking-consent-ack
  ```

---

## 2. Tickets

- [ ] **Empty-ticket block.** No ticket has ever been chosen →
  `pre-commit` refuses:
  ```bash
  rm -f .kiro/current-ticket.json
  git commit --allow-empty -m "test: should be blocked"
  ```
  **Expect:** commit fails (non-zero exit), clear message that a
  ticket must be set via Kiro chat first.

- [ ] **Fast-path hook.** In Kiro chat (not the terminal), with the
  ticket still unset, send a plain message: `hi`
  **Expect:** Kiro's entire reply is just the ticket question — no
  narration, no MCP/Jira call made (near-zero cost).

- [ ] **Ticket validation (real vs fake).** Reply with a fake ID first:
  `ANG-999999`
  **Expect:** Kiro calls `getAccessibleAtlassianResources`, then
  validates via Jira, and tells you it doesn't exist rather than
  saving it.
  Then reply with a real ticket ID from your Jira instance.
  **Expect:** Kiro asks you to click your profile icon to refresh
  credits, then confirms and writes `.kiro/current-ticket.json`.

- [ ] **Fuzzy match.** Clear the ticket again and reply with bad
  spacing/case, e.g. `ang - 123`:
  ```bash
  rm -f .kiro/current-ticket.json
  ```
  **Expect:** Kiro asks *"Did you mean ANG-123?"* rather than
  silently accepting or rejecting it.

- [ ] **Explicit `none`.** Clear the ticket, reply `none` in chat:
  ```bash
  rm -f .kiro/current-ticket.json
  ```
  **Expect:** saved as a real, explicit choice — check:
  ```bash
  cat .kiro/current-ticket.json
  ```
  should show `"ticket_id": "none"` with a real credit baseline and
  `episode_id` (not a silently-defaulted empty value).

- [ ] **Commit succeeds once a ticket/none is set, with trailers:**
  ```bash
  git commit --allow-empty -m "test: should succeed"
  git log -1
  ```
  **Expect:** commit goes through; message ends with `Kiro-Ticket`,
  `Kiro-Episode`, `Kiro-Credits`, `Kiro-Confidence`, `Kiro-Session`,
  `Kiro-Episode-Started`, `Kiro-Elapsed-Minutes` trailers.

---

## 3. Profile-click ask (credit refresh prompt)

This is `pre-commit`'s own prompt — distinct from `post-commit`'s
switch question in section 4. It fires on essentially every commit
made directly at a real terminal (not one run by an agent with
`KIRO_AGENT_COMMIT` set).

- [ ] **Answered in time:**
  ```bash
  git commit --allow-empty -m "test: profile click prompt"
  ```
  **Expect:** terminal shows *"Please click your profile icon to
  refresh your credits, then press Enter to continue (5 min
  timeout):"*. Press Enter — commit proceeds normally, no log line
  added to `.kiro-tracking/hook-health.log` for this case.

- [ ] **Timeout path** (optional — takes 5 real minutes):
  ```bash
  git commit --allow-empty -m "test: profile click timeout"
  # let the prompt sit untouched for 5 minutes
  tail -1 .kiro-tracking/hook-health.log
  ```
  **Expect:** commit still proceeds after the timeout; log line reads
  `hook_status=pre-commit-refresh-prompt-timeout`.

---

## 4. Switch question (`post-commit`) + pending-ticket validation

- [ ] **Decline a switch:**
  Right after any commit above, watch the terminal.
  **Expect:** *"Working on a different ticket now? (y/n) (5 min
  timeout)"*. Answer `n`.
  ```bash
  cat .kiro/current-ticket.json   # unchanged
  ```

- [ ] **Accept a switch, deferred validation:**
  Commit again, then when asked, answer `y` and type a real ticket ID.
  **Expect:** `.kiro/current-ticket.json` is left untouched for now;
  instead:
  ```bash
  cat .kiro/pending-ticket-check.json
  ```
  shows `{"typed_ticket": "<your ID>", "flagged_at": "..."}`.

- [ ] **Validation happens in chat, not the terminal:**
  Send any message in Kiro chat.
  **Expect:** before answering anything else, Kiro validates the
  typed ID for real via `atlassian-rovo`, confirms or rejects the
  switch, and deletes the pending file:
  ```bash
  cat .kiro/pending-ticket-check.json   # should error — file gone
  ```

---

## 5. Credits & confidence

- [ ] **Low confidence (too fresh):** immediately after setting a new
  ticket, commit right away:
  ```bash
  git commit --allow-empty -m "test: low confidence" 
  git log -1 | grep Kiro-Confidence
  ```
  **Expect:** `Kiro-Confidence: low`.

- [ ] **High confidence (real refresh):** physically click your Kiro
  sidebar profile icon, wait a few seconds, then commit:
  ```bash
  git commit --allow-empty -m "test: high confidence"
  git log -1 | grep Kiro-Confidence
  ```
  **Expect:** `Kiro-Confidence: high`.

- [ ] **Aggregation is max-per-episode-then-sum, not a raw sum:**
  ```bash
  scripts/calculate-pr-credits.sh --range master..test-hooks-manual
  ```
  **Expect:** one total per ticket, matching max-per-episode-then-sum
  math (see README §4) — not a flat sum of every commit's
  `Kiro-Credits` value.

- [ ] **Coverage report:**
  ```bash
  scripts/coverage-report.sh "$(git config user.email)" test-hooks-manual
  ```
  **Expect:** a tracked-commits ÷ total-commits percentage for this
  branch.

---

## 6. Episodes (branch-switch boundary)

- [ ] **Branch switch clears the ticket:**
  ```bash
  git checkout master
  git checkout test-hooks-manual
  cat .kiro/current-ticket.json    # expect: missing or empty
  ```
  **Expect:** file cleared by `post-checkout`, forcing the ticket
  question again on your next Kiro message.

- [ ] **Known bug — `rebase` also clears it (confirm it's still
  present, or that it's been fixed):**
  ```bash
  # with a ticket set:
  git rebase HEAD~1
  cat .kiro/current-ticket.json    # currently expected: also cleared
  ```
  If this has been fixed since the README was last updated, note that
  down — this checklist doubles as a regression check for it.

---

## 7. Secrets

- [ ] **Local state files never get tracked:**
  ```bash
  git status --ignored | grep -E \
    "current-ticket\.json|pending-ticket-check\.json|pending-baseline-confirm\.json|\.kiro-tracking/"
  ```
  **Expect:** every match appears only under "Ignored files" — none
  ever show up as stageable/tracked.

- [ ] **A Jira token never lands in a commit or tracked file:**
  ```bash
  export JIRA_API_TOKEN="test-fake-token-123"
  git commit --allow-empty -m "test: token should not leak"
  git log -1 -p | grep -i "test-fake-token-123"
  unset JIRA_API_TOKEN
  ```
  **Expect:** no output — the fake token never appears anywhere in the
  commit.

- [ ] **Missing Jira credentials silently no-op, never block or crash:**
  ```bash
  unset JIRA_BASE_URL JIRA_EMAIL JIRA_API_TOKEN
  git commit --allow-empty -m "test: no jira creds"
  ```
  **Expect:** commit still succeeds normally — existence-checking that
  needs those vars just no-ops rather than blocking anyone.

- [ ] **No live secrets sitting in tracked MCP config:**
  ```bash
  grep -rniE "token|api[_-]?key|secret|password" .kiro/settings/mcp.json
  ```
  **Expect:** no literal secret values — only placeholders, env-var
  references, or no matches at all.

---

## 8. `pre-push` (SonarQube gate)

- [ ] ```bash
  git push origin test-hooks-manual --dry-run
  ```
  **Expect:** a warning that the SonarQube gate is disabled (no real
  token or Docker/Java runtime configured yet) — a soft warning, not a
  hard block, per current known-limitations state.

---

## 9. Bootstrap hook (`aidlc-bootstrap-git-hooks.json`)

Its trigger (`PostFileSave`) is flagged in the README as **not yet
independently confirmed** to fire in Kiro's runtime — this is the one
most worth verifying yourself.

- [ ] ```bash
  git config --unset core.hooksPath
  # now save any file inside Kiro's editor
  git config core.hooksPath
  ```
  **Expect:** prints `.githooks` again, restored automatically by the
  hook. If it prints nothing, the bootstrap hook's trigger still isn't
  firing — note this down, it's a known open question, not a new bug.

---

## Cleanup — always run this last

```bash
git checkout test-case-a          # or whatever your real working branch is
git branch -D test-hooks-manual
cp /tmp/current-ticket.json.bak .kiro/current-ticket.json 2>/dev/null || true
rm -f /tmp/current-ticket.json.bak
```

- [ ] Confirm your real ticket state is back:
  ```bash
  cat .kiro/current-ticket.json
  ```
  should match what it was before you started (or be absent, if it
  was absent before).
