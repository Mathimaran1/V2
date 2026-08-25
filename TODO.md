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
- [x] **Fixed and tested 2026-08-25 — both required triggers built, not
      just one.** A fresh `episode_id` is created whenever a baseline
      resets, via either of the two things that should cause that: (1) a
      branch switch, `post-checkout` clearing the file; (2) a mid-session
      ticket switch with no branch change, detected by
      `ask-for-ticket-if-missing`'s CASE B logic (see the mid-session
      design-gap section below — this is the SAME fix as that one, not a
      separate item; building trigger (1) alone would have only fixed the
      reopened-ticket case and left the more important mid-session case
      silently broken). `pre-commit` copies `episode_id` into every
      tracking record. Dashboard query is a two-step sum-of-maxes:
      ```sql
      WITH episode_totals AS (
        SELECT ticket_id, episode_id, max(credits_used_so_far) AS episode_credits
        FROM read_json_auto('s3://your-tracking-bucket/tracking/*.json')
        GROUP BY ticket_id, episode_id
      )
      SELECT ticket_id, sum(episode_credits) AS total_credits
      FROM episode_totals GROUP BY ticket_id;
      ```
      **Tested for real, both triggers together, not episode_id alone:**
      simulated a full reopen cycle (work → simulated branch-switch clear
      → reopen with fresh baseline+episode → two more commits) via real
      git commits through the actual `pre-commit` script, then patched in
      realistic credit deltas (the read-mechanism itself is separately
      verified elsewhere; this test was specifically about the
      aggregation) and ran the actual query logic against the real
      generated tracking files: **6.2000** — exactly `max(5.0) +
      max(0.8,1.2) = 5.0+1.2`, matching the worked example above. Also
      tested the mid-session-switch trigger directly: confirmed switch
      (new ticket, new episode, old one abandoned correctly) and declined
      switch (`pending_switch_to` cleared, original ticket/episode
      untouched) both simulated end-to-end through real commits. DuckDB
      itself isn't installed here, so the query was verified with an
      equivalent Python implementation of the same group/max/sum logic
      against real files, not DuckDB directly — worth a real DuckDB run
      once that's available, though the logic itself is simple enough
      that this is a low-risk gap.
      **Known remaining limit, not a bug:** this test simulated the file
      *transitions* Kiro's agent should produce (`pending_switch_to` set,
      then resolved) directly, since driving Kiro's actual UI isn't
      possible from here — it did NOT verify that Kiro's agent correctly
      *recognizes* a mid-session switch from natural conversation and
      asks at the right moment. That still needs a real run through Kiro
      by a human before fully trusting CASE B in practice.

## Testing convention
- **Use a distinct ticket ID for hook testing, not `"none"`.** `"none"` is
  a real category for actual no-ticket work, not a test sentinel — reusing
  it for testing mixes throwaway data into a bucket real future work will
  also land in (see the design gap above, which this exact mixing is what
  surfaced it). When testing hooks going forward, answer the ask-ticket
  hook with something obviously synthetic (e.g. `TEST-000`) instead.
- [x] **Cleanup done 2026-08-25, on `master` only, two rewrite passes.**
      First pass stripped everything expected: `none-*`, `TEST-000-*`,
      `TESTSWITCH-*`, `TESTREOPEN-*` tracking files plus the two dummy
      `switch-test.txt`/`reopen-test.txt` files, with `--prune-empty`
      dropping the six commits that were pure test simulation (nothing
      real left once their files were stripped). Verifying the result
      surfaced two more patterns not in the original plan — worth noting
      since they'd have been missed by just following the list above
      literally: an `ANG-999-...json` file (branch-name-fallback noise
      from the now-deleted `ANG-999-test-branch`, not a real ticket), and
      a `-1787640645.json` file (the empty-`ticket_id` bug's own evidence
      artifact — kept at first as "legitimate history," reconsidered
      since the bug is already fully documented in prose here and in the
      commit that fixed it, so the raw artifact was clutter, not
      evidence anyone needs). Second pass stripped both. `.kiro-tracking/`
      now holds only `.gitkeep`. Both throwaway branches deleted
      (`ANG-999-test-branch`, `ANG-998-test-branch`) — everything real
      from them is already on `master` via the earlier cherry-pick.
      Two safety tags exist if any of this ever needs to be checked
      against the pre-cleanup state: `backup-before-history-rewrite`
      (this morning's first rewrite) and `backup-before-cleanup-2` (just
      before today's second/third passes).

## Design gap: amend/rebase creates extra stale tracking files
- [ ] **Already hit for real (3 duplicate files from repeated `--amend`,
      cleaned up by hand at the time). Original proposed fix has a real
      flaw, found while actually designing it rather than just building
      it as stated — corrected design below, still not built.**
      `git commit --amend` re-runs `pre-commit` on every amend, which
      unconditionally writes a fresh `.kiro-tracking/*.json` file each
      time — three amends produced three files for one final commit. A
      dashboard summing or maxing blindly over all of them would
      overcount, since stale records from abandoned amend/rebase states
      don't disappear on their own.
      **Why the original fix ("store the commit SHA in the tracking
      record, dashboard only counts records whose SHA still exists")
      doesn't actually work as stated:** `pre-commit` runs *before* the
      commit object exists — it cannot know its own future SHA. Writing
      `commit_sha` at that point is circular; there's nothing correct to
      put there. And "SHA still exists in git" isn't quite the right
      check anyway — an amended-away commit's SHA can remain a valid,
      readable git object for a while (until garbage collection), so
      *existence* doesn't mean *still part of the real history*; the
      real check is whether the SHA is still an ancestor of (or equal
      to) the branch tip.
      **Corrected design, not built or tested:** the SHA can only be
      known correctly *after* the commit exists, so this needs a new
      `post-commit` hook (not `pre-commit`), and it must patch the SHA
      in *without* amending — amending here would just recreate the
      exact problem being solved. Concretely: `post-commit` reads
      `git rev-parse HEAD` for the real SHA, finds which tracking file(s)
      this commit touched (`git show --name-only HEAD -- .kiro-tracking/`
      — no special pointer needed, git already knows), patches
      `commit_sha` into a local *copy* of that file's content, and
      re-uploads that patched copy to S3 under the same key — overwriting
      `pre-commit`'s earlier upload of the same file, without ever
      touching git itself. The git-tracked file in the repo stays as
      `pre-commit` wrote it (no SHA, or a `null` placeholder); only the
      S3 mirror — what the dashboard actually reads — carries the real
      SHA. At query time, the dashboard's exclusion check should be
      `git merge-base --is-ancestor <sha> <branch>` (or the GitHub API
      equivalent), not a bare existence check, for the reason above.
      Not built: needs the S3 write role that doesn't exist yet anyway
      (see "Known gaps" below), so there's nothing to test against
      end-to-end right now regardless of how well-designed this is.

## Design gap: mid-session ticket switch, no branch change, goes undetected
- [x] **Fixed and tested 2026-08-25 — see the episode_id entry above,
      this is the same fix, not a separate one.** `ask-for-ticket-if-
      missing`'s CASE B now checks, even when the ticket file is
      non-empty, whether the current message clearly indicates work on a
      different specific ticket — using a `pending_switch_to` field in
      `current-ticket.json` as the two-step state signal (file-emptiness
      can't be the signal here, since the file stays non-empty the whole
      time). Confirmed switch: new ticket, fresh baseline, fresh
      episode_id, old one abandoned. Declined/ambiguous: defaults to NOT
      switching (safe default — an accidental switch on an ambiguous
      reply would misattribute credits just as badly as never asking).
      Both paths simulated end-to-end through real commits. Still open:
      whether Kiro's agent actually *recognizes* a mid-session switch
      from natural conversation wasn't verified here (only the file-state
      mechanics were) — needs a real run through Kiro before full trust.

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

## Smaller items, tackled lowest-risk-first (2026-08-25)
- [x] **Co-author commit template — done.** `.gitmessage` pre-fills a
      `Co-authored-by:` line, wired via `git config commit.template
      .gitmessage` (documented in `README.md`'s one-time setup).
- [x] **Bug found while testing the template, unrelated to the template
      itself — fixed.** `commit-msg` unconditionally appended the
      Kiro-Session/Kiro-Credits trailers regardless of whether the user's
      actual message was empty. Git's own "abort on empty message" check
      runs AFTER `commit-msg`, using whatever it produces — so a blank or
      comments-only editor buffer (nothing typed, or a template left
      unfilled) still "succeeded," with a commit whose only content was
      those two trailer lines. Confirmed this happens even with
      `commit.template` unset — a pre-existing bug the template happened
      to expose, not caused by it. Reproduced twice for real (two
      accidental commits, both undone). Fixed: `commit-msg` now checks
      for real content before touching the file, leaving it alone
      otherwise so git's own check still fires. Tested both paths after
      the fix.
- [x] **Consent check baked into every hook — done.** `pre-commit` now
      checks a per-USER marker (`~/.kiro-tracking-consent-ack`, not
      per-repo — consent is about the person) before anything else, even
      gitleaks. Missing/unacknowledged → shows the tracking notice and
      requires typing `I agree` exactly, blocking the commit otherwise
      (same posture as gitleaks — fail closed, not a warning). Versioned
      (`v1`) so a future change to what's tracked can force a re-prompt.
      Closes the original gap: a dev committing through plain git, never
      opening Kiro's UI at all, could never have been shown the notice
      before. Tested: blocked with no input (confirmed, real commit
      attempt), then confirmed the "already consented" path correctly
      skips the prompt once the marker exists. **One real environment
      limit hit while testing, not a bug:** couldn't fully exercise the
      live `read -p` "type I agree" flow itself — piping input to `git
      commit` doesn't reach the hook's stdin in this sandboxed setup
      (same limitation as the original ticket-ID prompt, noted earlier
      today), so the marker-exists path was tested by writing the marker
      directly rather than typing through the actual prompt. The prompt
      logic itself is simple bash (`read -p` + string compare) with low
      risk of hidden behavior, but worth a real human running through it
      once in an actual terminal before fully trusting it.
- [x] **Coverage-number metric — local version done**, full AWS-scheduled
      version still not built (needs the AWS side generally, tracked
      separately). `scripts/coverage-report.sh`: tracked commits ÷ total,
      per dev, computed purely from `git log` (matches on the
      `Kiro-Session:` trailer `commit-msg` already stamps) — no AWS
      dependency, usable right now. Tested both paths for real: normal
      run showed 19/19 (100%); simulated a dev bypassing hooks entirely
      (`git commit --no-verify`, i.e. flaw #2 from the original list —
      "a dev can turn off the hooks on their own laptop") and confirmed
      it correctly dropped to 19/20 (95%) and named the exact untracked
      commit, not just a vague percentage. This is the same metric the
      AWS daily coverage check will eventually run automatically across
      the whole team — this is the on-demand, single-repo version of it.

## Tracking source of truth moved: commit trailers, not S3 (2026-08-25)
- [x] **Done, per explicit decision this session, not something I chose
      unilaterally.** S3 upload in `pre-commit` was failing every single
      commit all session (read-only AWS role) — removed. `commit-msg`'s
      six trailers (`Kiro-Ticket`, `Kiro-Episode`, `Kiro-Credits`,
      `Kiro-Confidence`, `Kiro-Session`, `Kiro-Source`) are now the
      durable, authoritative record; `.kiro-tracking/*.json` kept as a
      local-only convenience copy, not the source of truth (explicit
      decision — asked rather than assumed). Neither `git push` nor
      reading commit messages back needs any AWS write access at all.
- [x] **`scripts/calculate-pr-credits.sh` — built and tested, adapted
      from the original ask.** Original spec called for
      `aws codecommit get-commit`, but this account's CodeCommit access
      is blocked entirely (not just read/write-scoped — see `README.md`)
      and no git remote is configured on this repo at all, so that
      version would have been unverifiable. Built against local git +
      `gh` instead (explicit decision, not assumed): `--repo/--pr` mode
      uses `gh pr view` to resolve commit SHAs (available and
      authenticated, confirmed), `--range <base>..<head>` mode works
      against local history with no network/AWS at all. Same
      max-per-episode-then-sum-per-ticket logic as the dashboard query,
      tested in isolation against the same worked example (5.0+1.2=6.2)
      and against this repo's own real trailer-tagged commits. **Not
      tested:** the `gh pr view` path itself — this repo has no
      remote/PRs to test against yet; verified it fails cleanly on a
      nonexistent repo/PR rather than crashing, but a real PR run is
      still needed before fully trusting that specific path.
- [ ] **Not yet updated, found while doing the above — flagging, not
      fixing, since it's bigger than what was asked this round.** The
      DuckDB dashboard section further below still assumes tracking data
      lands in S3 as JSON (`read_json_auto('s3://...')`). That
      assumption is now stale for anything using the commit-trailer
      approach — the dashboard design itself needs to shift to reading
      commit messages (via git/GitHub API) instead of, or alongside, S3.
      Worth a deliberate follow-up, not a quiet edit alongside something
      else.

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
