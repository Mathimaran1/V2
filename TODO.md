# Open items — check before this goes further

Things that were deliberately parked mid-setup, or decisions that haven't
been made yet. Not bugs — just don't assume any of these are "done."

## Decide before creating any repo
- [ ] **Where does this repo actually live?** Company code (tracks devs'
      AI usage + credit spend) currently only exists locally, and the plan
      discussed was pushing to a *personal* GitHub account (`Mathimaran1`).
      Worth a quick check with whoever owns the AWS/Jira accounts on
      whether this belongs in a company-owned org/repo instead — same
      reason who sees the tracking data matters (see `docs/runbook.md`
      section 7, legal sign-off).
- [ ] **AWS account ID in `docs/source-repo-decision.md`** (`143912951401`).
      Not a credential by itself, but combined with the role name
      (`CodeInCity-AI-Assisted-POC`, visible elsewhere) it narrows things
      down. Redact before any public push; lower priority if staying
      private, but still worth cleaning up.

## Disabled, not fixed — re-enabling is a deliberate decision
- [ ] **SonarQube quality gate is OFF** (`.githooks/pre-push`, top of
      file — hard `exit 0` before the real scan logic). No real
      SonarQube host/token exists yet. The hook now prints a loud warning
      on every push while this is true. To re-enable: delete the
      `echo`/`exit 0` block at the top of `pre-push`, then fill in a real
      `sonar.host.url`, `SONARQUBE_TOKEN`, and `sonar.projectKey`
      (currently `YOUR_PROJECT`/`your-sonarqube-host` placeholders).

## Untested
- [x] **Jira (`atlassian-rovo` in `.kiro/settings/mcp.json`) connection
      verified 2026-08-25** — asked Kiro to list Jira projects and got
      real data back from `teamlease-tech.atlassian.net` (13 projects:
      ALCS, ANG, BENEFITAPP, DLK, GTMS, GTMS1, HCM, HCMDWS, HH, HI, HT,
      JP, PL). `PROJ` in `company-policy.md`'s `PROJ-123` example was
      confirmed to be just a placeholder, not a real key. Real project
      is **ANG** (ALCS-NG) — swap `PROJ-123` → `ANG-123` in
      `company-policy.md` before the ticket-linking rule is actually
      followable. Deliberately not touching Jira/this file further for
      now — revisit when ready.

## Found by actually testing the hooks end-to-end (2026-08-25)
- [x] **`.kiro/hooks/ask-ticket.json` used a made-up schema and never
      ran.** Kiro's real hook shape (confirmed from what its own Agent
      Hooks UI writes to disk) is `{version, hooks: [{name, trigger,
      action: {type, prompt}, enabled}]}`, not the `when`/`then`/
      `promptSubmitted`/`agentAction` shape this repo had. Fixed: real
      file is now `.kiro/hooks/ask-for-ticket-if-missing.json`; confirmed
      hand-written files in `.kiro/hooks/` are picked up on their own, no
      need to create hooks through the UI every time.
- [x] **The ask-then-save flow needs two prompts, not one.** A
      `UserPromptSubmit` hook can't ask a question and then wait for the
      reply within a single turn — the original instruction assumed it
      could, so it just re-asked forever and `credits_at_ticket_start`
      never got saved (confirmed: file's mtime never changed across
      several rounds of answering). Fixed by rewriting the instruction to
      branch on whether the current message *is* the pending answer.
- [x] **Reading credits without a bundled instruction lets the agent
      improvise, and it can silently produce a wrong number.** With no
      `sqlite3` CLI installed, the agent fell back to `cat`-ing the raw
      binary `.vscdb` file and pulled a number (`168.77`) out of the
      garbled output — not a real read, just noise that looked plausible.
      Fixed by putting the exact working `python3 -c ...` command
      (same one `pre-commit` already uses) directly in the hook
      instruction, so it's run verbatim instead of guessed.
- [x] **`commit-msg` used `cat *.json | tail -1 | jq`, which broke.**
      `pre-commit` writes each record pretty-printed across multiple
      lines, so `tail -1` on concatenated files grabs a lone trailing
      `}` — jq fails outright on that, so both trailers came out
      *empty*, not even their `"none"`/`"n/a"` fallback. Fixed to read
      one whole file (most recent by mtime) instead of a `tail`ed
      fragment.
- [x] **`credits_used_so_far` can read `0.0000` right after setting a
      baseline, even when real work happened in between — confirmed lag,
      not a permanent freeze, and the mechanism is now confirmed (not
      guessed).** Isolated with a controlled test: polled the SQLite
      `kiro.kiroAgent.currentUsage` value every 15s for ~10 min while
      doing Kiro actions, and cross-checked jumps against
      `~/.config/Kiro/logs/<session>/window*/exthost/kiro.kiroAgent/
      q-client.log`. Three jumps (235.49→237.14→237.61→237.73) each
      landed within ~15s of a logged `GetUsageLimitsCommand` call from
      `CodeWhispererRuntimeClient` — an AWS API call, not a local editor
      command and not a fixed timer. **Confirmed:** `state.vscdb` is just
      a cache of whatever that AWS call last returned; it updates
      whenever Kiro's client happens to make that call (correlates with
      activity, no clean fixed interval), not specifically on new
      sessions and not on a documented schedule. (The profile ARN and
      IAM Identity Center user ID visible in that log line are
      account-identifying — redact before any public push, same as the
      existing AWS account ID note above.) **Because it's a real network
      call, not a local command: don't try to force-trigger it from
      `pre-commit`** — would mean replicating Kiro's own AWS auth inside
      a git hook, adding real latency and a hard network dependency to
      every commit. The `credit_confidence` flag below is the right
      amount of engineering for this; forcing the sync isn't. Earlier
      open GitHub issues (kirodotdev/Kiro #7806, #6880, #7005) about
      usage-display staleness remain relevant context, just no longer
      the only source we have on the mechanism itself.
      **Practical effect, corrected:**
      `credits_used_so_far` is cumulative *since the ticket's baseline*,
      not incremental since the previous commit — `pre-commit` only ever
      reads `credits_at_ticket_start`, it never rewrites it. So a
      stale/lagging cache doesn't lose data, it just means an early
      commit under a ticket can read `0.0000` while a later commit (once
      the cache catches up) shows the real running total, which by then
      already includes everything from every earlier commit on that
      ticket. **The fix this implies:** anything that reports a ticket's
      total cost (the DuckDB dashboard query in `docs/runbook.md`, or any
      manual read of these logs) must take the *last/max* commit's
      `credits_used_so_far` per ticket, never sum across commits —
      summing would double-count, since each value already contains the
      whole history. (Already fixed in `docs/runbook.md`'s dashboard
      query: was `sum(...)`, now `max(...)`.)
- [x] **Mitigation shipped:** `pre-commit` now writes a `credit_confidence`
      field (`"high"`/`"low"`) on every tracking record — low whenever
      the delta computed out to exactly `0.0000`, or fewer than 5 minutes
      had passed since `current-ticket.json`'s baseline was set (using the
      file's own mtime, no schema change needed). Confirmed by testing: a
      commit made ~51 min after baseline, with a real non-zero delta,
      correctly came back `"high"`.
- **Two corrections on the research behind this**, worth keeping in mind
  for anything gathered via web search rather than a direct page fetch:
  - Kiro GitHub issue #8524 ("no way to export/programmatically access
    per-response credit consumption") is real and says what it was quoted
    as saying — but it is **not** marked duplicate. That claim came from
    misreading a search snippet's UI chrome (a button label) as the
    issue's status; the actual page just shows `pending-triage`. Fetch
    the real page before repeating a status claim like that again.
  - The "updated every 5 minutes" figure is the *account dashboard's*
    documented cadence per that issue's own wording — it's *consistent
    with*, but not *confirmed to be*, the same mechanism as the local
    `state.vscdb` row we read (our one direct observation showed a ~30 min
    gap before it updated, which a 5-min cadence doesn't contradict, but
    doesn't prove either). Treat 5 min as a plausible floor, not a
    verified fact about this specific file — that's why `pre-commit`'s
    confidence check above doesn't just trust it blindly.
- **Parked, not forgotten:** reconciling tracked credits against Kiro's
  official daily per-user CSV report (written to S3) was suggested as a
  validation step, but that report only exists once *Enterprise settings*
  are turned on — which `docs/runbook.md` section 0 deliberately puts
  *last* in the build order, after the workflow already works end to end.
  Revisit this once that stage is actually reached, not before.
- **Investigated and ruled out:** the third-party PyPI package `kiro-usage`
  (real package, not fabricated — installed and tested directly via
  `uv tool install kiro-usage`, not just read about). Its README claims
  IDE tracking, but its own `--help` labels all metrics **"(CLI only)"**,
  and its only data source is `~/.local/share/kiro-cli/data.sqlite3` — a
  **different product's** database (Kiro CLI, a separate terminal tool),
  not the Kiro IDE's `state.vscdb` this project reads from. Confirmed
  neither that file nor a `kiro-cli` binary exist on this machine (IDE
  only, via `/usr/bin/kiro`) — ran it, got empty output, traced it to
  this rather than assuming a config/install problem. **Not usable for
  this project as installed; our own `python3` read of `state.vscdb` in
  `pre-commit` remains the only working local source.** Left installed
  (harmless, `uv tool uninstall kiro-usage` to remove) in case Kiro CLI
  ever enters the picture later.

## Design gap: baseline resets aren't tracked as distinct units — affects ANY reopened ticket, not just `"none"`
- [ ] **Broadened from an earlier `"none"`-specific version of this note
      (still not fixed — only ever documented, nothing built yet).** The
      `max()`-not-`sum()`
      fix assumes a ticket has *one continuous baseline* for its whole
      life. `"none"` breaks that constantly (fresh baseline every use),
      but so does any **real** ticket that gets reopened: worked, closed,
      branch switched away (`post-checkout` clears the baseline), then
      picked back up later — `ask-for-ticket-if-missing` sets a brand new
      baseline at whatever `currentUsage` is by then, unrelated to the
      first round's peak. Concretely:
      ```
      Round 1: baseline=200, commits show 2.0 → 4.0 → 5.0, ticket closed
      Round 2 (reopened later): baseline=340 (other work happened between),
               commits show 0.5 → 1.2
      max(credits_used_so_far) WHERE ticket_id='PROJ-123' → 5.0
      ```
      Round 2's 1.2 credits are silently **dropped entirely**, not added —
      worse than double-counting, since 5.0 looks like a normal, plausible,
      correct-looking number instead of an obviously wrong one. This is
      the same root cause `"none"` originally surfaced (a fresh baseline
      per use, not tracked as a distinct unit) — `"none"` just triggers it
      constantly, while a real ticket only hits it on reopen. Raising this
      from "low urgency, only affects `'none'`" to "affects any ticket
      with more than one work session," a realistic pattern for real
      tickets, not just an edge case.
      **Proposed fix, not yet built or tested:** track episodes, not just
      tickets — `ask-for-ticket-if-missing` generates an `episode_id`
      whenever it sets a fresh baseline (e.g. `ep_<random hex>`), writes
      it into `current-ticket.json` alongside `credits_at_ticket_start`;
      `pre-commit` copies it into every tracking record, same as
      `ticket_id`; the dashboard query becomes a two-step sum-of-maxes
      instead of one `max()`:
      ```sql
      WITH episode_totals AS (
        SELECT ticket_id, episode_id, max(credits_used_so_far) AS episode_credits
        FROM read_json_auto('s3://your-tracking-bucket/tracking/*.json')
        GROUP BY ticket_id, episode_id
      )
      SELECT ticket_id, sum(episode_credits) AS total_credits
      FROM episode_totals GROUP BY ticket_id;
      ```
      **Before building this for real:** simulate an actual reopen (switch
      away from a test branch, do unrelated work to move `currentUsage`,
      switch back) and confirm episode IDs genuinely differ between the
      two rounds and the sum comes out right — same testing discipline as
      everything else today, not just trusting the design on paper.

## Testing convention
- **Use a distinct ticket ID for hook testing, not `"none"`.** `"none"` is
  a real category for actual no-ticket work, not a test sentinel — reusing
  it for testing mixes throwaway data into a bucket real future work will
  also land in (see the design gap above, which this exact mixing is what
  surfaced it). When testing hooks going forward, answer the ask-ticket
  hook with something obviously synthetic (e.g. `TEST-000`) instead.
- [ ] **Pending cleanup, deliberately batched, not done yet:** two more
      `"none"`-tagged test commits landed after this convention was
      written (`.kiro-tracking/none-1787639871.json`,
      `.kiro-tracking/none-1787639997.json` — habit is easy to slip on
      even right after deciding not to). Do this cleanup on `master`
      only, not the leftover test branches (`ANG-999-test-branch`,
      `ANG-998-test-branch`) — three real commits from those branches got
      cherry-picked onto `master` (see the cherry-pick/hooks note below),
      so `master` is now the canonical history; the test branches are
      safe to delete once that's done, nothing unique left on them worth
      keeping (their only remaining unique commit is a throwaway "second
      test commit" with a `some-file.txt` artifact, deliberately not
      brought over).

## Design gap: amend/rebase creates extra stale tracking files
- [ ] **Already hit for real earlier today, never recorded until now.**
      `git commit --amend` re-runs `pre-commit` on every amend, and
      `pre-commit` unconditionally writes a fresh `.kiro-tracking/*.json`
      file each time it runs — so three amends in a row produced three
      tracking files for what's actually one final commit. Happened
      literally: 3 duplicate files, cleaned up by hand (`git rm` +
      `--amend --no-verify` to avoid spawning a 4th). A dashboard summing
      or maxing blindly over all files would overcount, since stale
      records from abandoned amend/rebase states don't disappear on
      their own. **Proposed fix, not built or tested:** store the commit
      SHA inside each tracking record at write time; have the dashboard
      only count records whose SHA still exists in git history — an
      amended-away record's SHA no longer resolves, so it's naturally
      excluded without needing manual cleanup.

## Design gap: mid-session ticket switch, no branch change, goes undetected
- [ ] **New, not previously proposed in this project despite how it might
      read — checked the actual hook file before writing this down.** If
      a dev is still on `PROJ-123`'s branch (`current-ticket.json` still
      holds it, non-empty) and starts planning/exploring `PROJ-456` in the
      same Kiro session without switching branches, nothing catches it —
      `ask-for-ticket-if-missing`'s own first line is "if it already holds
      a non-empty ticket_id, do nothing extra." Every credit spent on
      `PROJ-456` gets silently attributed to `PROJ-123` until the next
      branch switch finally clears the file. Worse than the reopened-
      ticket gap above: that one is honest-but-wrong (system miscounts,
      dev did nothing unusual); this one is silent, and triggered by
      completely normal behavior (planning ahead before switching
      branches), not an edge case. **Proposed, not built or tested:** a
      second hook (or an extension to the existing one) that checks, even
      when the ticket file is non-empty, whether the current message
      mentions a different ticket ID than what's saved, and asks to
      confirm before treating it as a switch — closing a snapshot for the
      old ticket's episode and starting a fresh baseline/episode for the
      new one before proceeding.

## Found while fixing the branch mix-up above (2026-08-25)
- **`git cherry-pick` did not invoke `pre-commit` or `commit-msg` here,**
  despite `core.hooksPath` correctly set and both hooks executable —
  confirmed three independent ways: no gitleaks banner in the output,
  `hook-health.log`'s mtime predates the cherry-pick, and the resulting
  commit messages (including `Kiro-Session`/`Kiro-Credits` trailers) are
  byte-identical to the originals rather than regenerated. Not
  investigated further (root cause unconfirmed), but worth knowing:
  **a cherry-picked commit does not get gitleaks-scanned** the way a
  normal commit does — don't assume hooks catch everything regardless of
  how a commit was created.
- [x] **Fixed 2026-08-25.** `pre-commit` never validated `TICKET_ID` was
  non-empty after all three resolution attempts (saved file → branch
  name → manual prompt) failed. Hit this for real: committed on `master`
  right after a branch switch had cleared `current-ticket.json`, branch
  name didn't match the ticket regex, and the manual `read -p` prompt got
  no input — produced `.kiro-tracking/-1787640645.json` with
  `"ticket_id": ""`. Fixed: `pre-commit` now exits 1 and writes nothing
  if `TICKET_ID` is still empty at that point, same posture as the
  gitleaks check. Tested directly: reproduced the exact original
  conditions (empty ticket file, non-matching branch), confirmed the
  commit now blocks cleanly with no file written.

## Known gaps, already understood (not urgent)
- `kiro-session-info` never existed — replaced with a real SQLite read
  (`~/.config/Kiro/User/globalStorage/state.vscdb`). See `pre-commit`
  and `docs/runbook.md` for the details.
- AWS write access doesn't exist yet (`kiro-s3-readonly` is read-only) —
  the S3 upload in `pre-commit`/`pre-push` and the PR-gate Lambda both
  need a separate, not-yet-created write-capable role.
- `company-policy.md` still references the old `atlassian`/`sonarqube`
  MCP server names — stale against the current `atlassian-rovo`/`aws`
  entries in `mcp.json`. Cosmetic, but worth reconciling.
