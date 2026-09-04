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
      JP, PL). `PROJ` in `company-policy.md`'s (renamed 2026-08-25 to
      `.kiro/steering/aidlc-git-conventions.md`, see the naming-cleanup
      entry below) `PROJ-123` example was confirmed to be just a
      placeholder, not a real key. Real project is **ANG** (ALCS-NG) —
      swap `PROJ-123` → `ANG-123` in `aidlc-git-conventions.md` before
      the ticket-linking rule is actually followable. Deliberately not
      touching Jira/this file further for now — revisit when ready.

## Found by actually testing the hooks end-to-end (2026-08-25)
- [x] **`.kiro/hooks/ask-ticket.json` used a made-up schema and never
      ran.** Kiro's real hook shape (confirmed from what its own Agent
      Hooks UI writes to disk) is `{version, hooks: [{name, trigger,
      action: {type, prompt}, enabled}]}`, not the `when`/`then`/
      `promptSubmitted`/`agentAction` shape this repo had. Fixed: real
      file is now `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`
      (renamed again 2026-08-25, see the naming-cleanup entry below);
      confirmed hand-written files in `.kiro/hooks/` are picked up on
      their own, no need to create hooks through the UI every time.
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
- [x] **`sessionStarted` is not a trigger Kiro's agent runtime actually
      fires — confirmed 2026-08-25, two independent ways.** (1) Kiro's
      Agent Hooks panel doesn't list `aidlc-bootstrap-git-hooks.json` at
      all — only `aidlc-ask-for-ticket-if-missing.json` (`UserPromptSubmit`)
      shows up, even though the `sessionStarted` file is on disk and
      schema-valid. A hook created through the panel itself (via
      "+ Create Hook") defaulted to trigger `PostFileSave`, suggesting
      `sessionStarted` may not even be an option the UI offers. (2) Directly
      tested end to end: reset the repo to a "fresh clone" state
      (`.githooks/` moved aside, `git config --unset core.hooksPath`),
      then started a genuinely new Kiro session — a `sessionStarted` hook
      only ever gets one chance to fire, at session start. Sent a normal
      first message; the `UserPromptSubmit` ask-ticket hook fired
      correctly (read the empty `current-ticket.json`, recognized the
      message wasn't a ticket ID, asked which ticket), but nothing
      checked or recreated `.githooks/` — confirmed by inspecting the
      filesystem immediately after: `.githooks/` was still missing and
      `core.hooksPath` was still unset. **The bootstrap hook is currently
      dead code.** `.githooks/` setup on a new machine still needs the
      manual one-time step documented in `README.md`
      (`git config core.hooksPath .githooks && chmod +x .githooks/*`)
      until a working trigger is found — worth checking what triggers
      the panel's "+ Create Hook" dropdown actually lists before assuming
      no alternative exists.

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
      missing`'s CASE C (renamed from CASE B on 2026-08-26 — see below)
      checks, even when the ticket file is non-empty, whether the
      current message clearly indicates work on a different specific
      ticket — using a `pending_switch_to` field in `current-ticket.json`
      as the two-step state signal (file-emptiness can't be the signal
      here, since the file stays non-empty the whole time). Confirmed
      switch: new ticket, fresh baseline, fresh episode_id, old one
      abandoned. Declined/ambiguous: defaults to NOT switching (safe
      default — an accidental switch on an ambiguous reply would
      misattribute credits just as badly as never asking). Both paths
      simulated end-to-end through real commits. Still open: whether
      Kiro's agent actually *recognizes* a mid-session switch from
      natural conversation wasn't verified here (only the file-state
      mechanics were) — needs a real run through Kiro before full trust.
      **Superseded as the primary mechanism 2026-08-26** — see the CASE
      B/C restructure below; this AI-detection path is now the secondary
      safety net, not the main one.

## Restructure: mid-session switch is now THREE cases, not two (2026-08-26)
- [x] **Built and tested for real.** The old single "CASE B" (AI-based,
      mid-conversation detection in `ask-for-ticket-if-missing.json`) is
      renamed to **CASE C** — kept exactly as-is otherwise, still the
      softer secondary safety net for catching a switch before anything's
      committed. A genuinely new **CASE B** was added: a deterministic,
      non-AI check in a new `.githooks/post-commit` hook that runs right
      after every successful commit, asks directly in the terminal
      ("Working on a different ticket now? (y/n)"), and on yes: asks for
      the new ticket ID, generates a fresh `episode_id` (same
      `'ep_'+hex(time)+token_hex(3)` scheme as CASE A/C, so all three
      cases produce indistinguishable-looking IDs), reads the current
      credit total as the new baseline, and overwrites
      `current-ticket.json`. This is now the **primary** mechanism —
      reliable and deterministic, not a best-effort AI read of
      conversation — CASE C stays as backup only.
      **Tested for real, human-typed path** (via a real allocated pty,
      not a guess — a bare non-interactive shell can't stand in for an
      actual terminal here): answered "n" twice across two commits →
      `current-ticket.json` byte-identical both times, both commits'
      `Kiro-Episode` trailers matched. Answered "y" + a new ticket ID →
      genuinely new `episode_id` generated, file updated correctly, and
      confirmed the commit **already in flight when the switch was
      confirmed** still carried the old ticket/episode (switch fires
      post-commit, so it can only affect the *next* commit) while the
      following commit correctly carried the new ticket/episode.
      **Found a real gap while testing the agent-initiated-commit path**
      (Kiro's agent, or any AI coding agent, running `git commit` itself
      as a subprocess — simulated here via a raw non-interactive shell
      exec, no pty, no piped stdin, matching how an agent's tool-call
      subprocess actually looks): the first cut of `post-commit` used a
      plain `read -p ... < /dev/tty`. Result, confirmed directly (with a
      `timeout` wrapper as a safety net, not needed in practice): it did
      **not hang** — `/dev/tty` failed immediately with `No such device
      or address` (ENXIO, no controlling terminal at all in that
      context), so the commit completed in well under a second. But
      nothing durable recorded that the switch-check never ran — only a
      raw bash error line buried mid-console, easy to miss, and no
      `hook-health.log` entry. That's a real "fails silently" gap in
      practice, not a hang.
      **Fix, built and re-tested:** guard the interactive read behind an
      actual TTY-availability check, and log explicitly to
      `hook-health.log` when it's skipped. Deliberately **not**
      `[ -t 0 ]` — tested directly and confirmed it's the wrong signal
      here: even the genuine human-typed-commit path (real pty) showed
      `[ -t 0 ]` as **false** for this hook's stdin (same root cause
      `pre-commit` already hit — see its 2026-08-25 fix entry — git does
      not guarantee a hook's stdin reflects the real terminal). The
      signal that was actually true for the human path and actually
      false for the no-terminal-at-all agent path was whether `/dev/tty`
      itself is openable (`{ : < /dev/tty; } 2>/dev/null`). Re-tested
      after the fix: agent-initiated commit now completes cleanly with no
      stray bash error, `current-ticket.json` untouched, and a
      `hook_status=post-commit-switch-check-skipped-no-tty` line lands in
      `hook-health.log` with a timestamp and the commit SHA. Re-ran both
      human-typed regression cases ("n" and "y") after the fix too — both
      still work identically to before.
      **Known remaining limit, not fully closed:** this was tested by
      having Claude Code itself (this session's own agent) run `git
      commit` as a bare subprocess with no terminal attached — a
      reasonable proxy for "an AI agent's subprocess has no controlling
      terminal," and the underlying Unix behavior (`/dev/tty` → ENXIO
      with no controlling terminal) isn't agent-specific. But it was not
      run through Kiro's actual application process — still worth a real
      pass through Kiro itself before fully trusting this in practice,
      same caveat as CASE C above.

## Found while testing episode_id end-to-end (2026-08-26) — `git rebase` also clears `current-ticket.json`
- [ ] **Confirmed by direct testing, not yet fixed.** `post-checkout`
      clears `current-ticket.json` whenever `$3 = "1"` — documented as
      "branch switch," but that flag actually means "this checkout moved
      to a different commit via a branch-level ref," which `git rebase`
      also triggers internally (it checks out the base commit, replays
      commits, then reattaches the branch). Reproduced twice on a real
      branch: `current-ticket.json` went from a populated baseline to
      `{}` immediately after `git rebase`, with no branch switch and no
      ticket change involved at all. Practical effect: the *next* commit
      after any rebase gets routed through CASE A (empty ticket_id) and
      is issued a brand-new `episode_id`, silently fragmenting what
      should be one continuous episode into two. Not the same issue as
      the "amend/rebase creates extra stale tracking files" gap above —
      that one's about duplicate `.kiro-tracking/*.json` records; this
      one's about the episode boundary itself moving when it shouldn't.
      **Not fixed yet** — likely needs `post-checkout` to also check that
      `$1 != $2` (the ref actually changed) and/or that HEAD landed on a
      branch (not detached), rather than trusting `$3=1` alone.

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
- [x] **Consent check added to `pre-commit`, the full interactive
      flow.** Checks a per-USER marker (`~/.kiro-tracking-consent-ack`,
      not per-repo — consent is about the person) before anything else,
      even gitleaks. Missing/unacknowledged → shows the tracking notice
      and requires typing `I agree` exactly, blocking the commit
      otherwise (same posture as gitleaks — fail closed, not a
      warning). Versioned (`v1` then `v2`) so a future change to what's
      tracked can force a re-prompt. Closes the original gap: a dev
      committing through plain git, never opening Kiro's UI at all,
      could never have been shown the notice before. Tested: blocked
      with no input (confirmed, real commit attempt), then confirmed
      the "already consented" path correctly skips the prompt once the
      marker exists. **One real environment limit hit while testing,
      not a bug:** couldn't fully exercise the live `read -p` "type I
      agree" flow itself — piping input to `git commit` doesn't reach
      the hook's stdin in this sandboxed setup (same limitation as the
      original ticket-ID prompt, noted earlier today), so the
      marker-exists path was tested by writing the marker directly
      rather than typing through the actual prompt. The prompt logic
      itself is simple bash (`read -p` + string compare) with low risk
      of hidden behavior, but worth a real human running through it
      once in an actual terminal before fully trusting it.
      **Corrected 2026-08-26 — the title above originally said "baked
      into every hook," which was never actually true.** A status
      report caught it: consent logic only ever existed in
      `pre-commit`, confirmed by grepping all 5 `.githooks/` files —
      zero references in `post-commit`, `commit-msg`, `post-checkout`,
      or `pre-push`. Since `pre-commit` runs first in a normal commit,
      this mostly worked in practice, but `post-checkout` (a branch
      switch) and `pre-push` could both run without ever touching
      consent. **Fixed for real, not just relabeled:** both now carry a
      lightweight marker-only check (same `$CONSENT_FILE`/
      `$CONSENT_VERSION`, no interactive prompt duplicated) — missing
      consent logs `hook_status=post-checkout-no-consent-marker` /
      `hook_status=pre-push-no-consent-marker` to `hook-health.log` and
      continues; neither a branch switch nor a push is blocked over it,
      deliberately (too heavy-handed for hooks that don't themselves
      write tracking data). Tested all four real paths directly (no
      pty needed — the check itself doesn't read from a terminal):
      consent missing → both hooks ran normally and logged; consent
      restored → both hooks ran normally with zero new log lines.
      **Structural limit, unchanged by this fix, stated plainly:**
      `--no-verify` and cherry-pick still bypass `pre-commit` entirely
      (confirmed exploitable last session), so a commit made either way
      still never touches consent at all — this fix closes the
      `post-checkout`/`pre-push` gap specifically, it does not make
      consent unconditional across every possible way a commit can
      land in this repo.
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

## Dashboard resync: the physical click forces it, the command does not (2026-08-26)
- [x] **Tested for real, both paths, and they are NOT the same code
      path — correcting an assumption from the same investigation.
      Reproduced a second time before building anything further, per
      standard practice here — not just documented once.**
      Earlier testing found `kiro.accountDashboard.showDashboard`
      (called directly via `vscode.commands.executeCommand`, through a
      throwaway extension) executes successfully and opens a real
      webview, but leaves `state.vscdb`'s cached `currentUsage`/
      `timestamp` byte-identical — no resync. That result was correct,
      but it does not generalize to the actual UI button: had a human
      physically click the profile icon in the sidebar (not simulated,
      not the command) and compared `state.vscdb` immediately before and
      after:
      ```
      Test 1  BEFORE: currentUsage = 249.25  timestamp = 2026-08-26T06:45:06Z
      Test 1  AFTER:  currentUsage = 250.03  timestamp = 2026-08-26T07:26:24Z
      Test 2  BEFORE: currentUsage = 250.03  timestamp = 2026-08-26T07:26:24Z
      Test 2  AFTER:  currentUsage = 250.03  timestamp = 2026-08-26T07:56:39Z
      ```
      Both times, the timestamp landed within seconds of the click (12s,
      then 10s before the follow-up read) — not a coincidental periodic
      sync either time (41 min stale, then 29 min stale; nothing was due
      to fire on its own). Test 2 is the sharper result: `currentUsage`
      itself did NOT change (no new usage accrued in that window), but
      the timestamp still moved — proving the **timestamp**, not the
      value, is the reliable "a resync just happened" signal. The
      physical click genuinely forces a resync that gets persisted to
      disk, in the exact file every hook here reads.
      **Practical consequence:** telling a dev to check their dashboard
      before committing is not just a dev-facing habit — it can actually
      freshen the number `pre-commit` reads, closing the sync-lag gap
      for that one commit. Calling the command programmatically does
      not have this effect; only the real UI interaction does. Not yet
      identified: the actual internal event/API the click triggers that
      the command doesn't (would need decompiling further into the
      webview bundle to pin down, not done here).
      **Built and tested, 2026-08-26 same day:** `credit_confidence` in
      `.githooks/pre-commit` now uses this timestamp as direct evidence
      instead of only guessing from elapsed-time-since-baseline — cache
      under 2 min old forces high confidence regardless of elapsed time,
      cache over 10 min old forces low regardless of elapsed time,
      between the two the old elapsed-time heuristic still applies as
      the fallback. Tested both override directions with real commits on
      a throwaway branch:
      - **Fresh click, immediate commit:** baseline set seconds earlier
        (elapsed≈0s) with a 0.0000 delta — both old-logic conditions for
        LOW were true — but the cache was genuinely fresh (real click,
        46s old). Result: `Kiro-Confidence: high`. Old logic alone would
        have said low; the override correctly promoted it.
      - **Old baseline, stale cache:** baseline backdated 20 minutes
        with a real non-zero delta (11.14) — both old-logic conditions
        for HIGH were true — but the cache itself was aged 15 minutes
        (via a scratch copy with only the `timestamp` field changed,
        swapped into `pre-commit`'s hardcoded DB path for one commit,
        then immediately restored; the real `state.vscdb` was never
        touched — same technique as the credit-tampering test, applied
        here to a normal, non-adversarial validation). Result:
        `Kiro-Confidence: low`, `Kiro-Credits: 11.14`. Old logic alone
        would have said high; the override correctly demoted it.
      Both directions confirmed with real trailers from real commits,
      not just reasoning about the shell logic.

## Ask-to-click gate: three-way A/B/C split, matching ticket-switch pattern (2026-08-26)
- [x] **Built and tested for real — CASE A and CASE C confirmed with
      real commits; CASE B is explicitly NOT verified the same way and
      documented as such, not glossed over.** Since a physical profile-
      icon click forces a real resync but nothing here can trigger that
      click automatically (see the dashboard-resync entry above), the
      next question was how to actually get devs to click before
      committing — reusing the same three-case structure already
      proven for ticket-switch detection, since the underlying problem
      is identical: a hook can prompt a real terminal, but has no way
      to reach a human through a chat conversation, and no way to tell
      "no human at all" apart from "a human is present in chat."
      - **CASE A (TTY present)** — `.githooks/pre-commit` now asks,
        right before reading `state.vscdb`: "Please click your profile
        icon to refresh your credits, then press Enter to continue,"
        and waits. Code-enforced. **Tested for real** via a genuine pty
        (not a bare non-interactive shell): prompt appeared, was
        answered, commit succeeded, and — correctly — no
        no-TTY-skip log line was written (confirms the TTY-present
        branch, not the fallback, actually ran).
      - **CASE B (agent committing during an active chat turn with a
        human present)** — new steering rule in `aidlc-git-
        conventions.md`: ask in chat before running the commit, wait
        for the reply. **Explicitly behavior-dependent, not code-
        enforced** — a hook cannot detect "a human is present in this
        conversation" at all, so there is no way to test this the way
        A and C were tested; it depends entirely on the agent
        recognizing the situation and following the rule. Documented
        as best-effort only, same honest framing as CASE B of the
        episode-boundary restructure above — not claimed as verified
        when it isn't.
      - **CASE C (no TTY — fully autonomous/background commit)** —
        same `{ : < /dev/tty; } 2>/dev/null` check already proven for
        post-commit's ticket-switch fallback (not `[ -t 0 ]` — already
        tested and found wrong for this exact purpose). Nothing is
        asked; the commit proceeds. **Tested for real** with a genuine
        no-TTY subprocess commit (same method as the earlier
        agent-initiated-commit tests): completed in well under a
        timeout safety net, no hang, correctly logged
        `hook_status=pre-commit-refresh-prompt-skipped-no-tty` to
        `hook-health.log`, and the resulting trailer showed
        `Kiro-Confidence: low` as expected — no special forced-low code
        was needed for this, since the existing cache-freshness check
        (built in the entry above) already produces low confidence on
        its own when nobody has clicked recently.
      **Detection boundary, stated plainly:** the TTY check reliably
      splits A from (B or C) — tested. It cannot split B from C — that
      split is only ever correct if the agent actually follows the
      CASE B steering rule; there is no code-level backstop for it the
      way CASE C's `hook-health.log` entry backstops the ticket-switch
      CASE B.
      **Correction, same day — see the entry directly below:** the
      claim just above ("the TTY check reliably splits A from (B or
      C)") turned out to be wrong. It was true for a bare no-TTY
      subprocess, but not for an agent running `git commit` through its
      own tool-execution mechanism, which can have a real TTY attached
      too — that's a genuinely different case this entry didn't
      account for, not just a restatement of the original no-TTY test.

## Ask-to-click gate: TTY presence cannot distinguish a human terminal from an agent's own tool-call shell (2026-08-26)
- [x] **Real bug found and fixed, same day as the entry above — TTY
      alone was insufficient, confirmed by observing it happen, not
      predicted in advance.** The entry above assumed `/dev/tty` being
      openable meant CASE A specifically (a human typing in a real
      terminal) — reusing the same check already proven for post-
      commit's no-TTY ticket-switch fallback. That check IS still valid
      for its original purpose (a bare, fully headless subprocess has
      no TTY at all, confirmed by testing earlier this project). It is
      **not** sufficient to distinguish a human's terminal from an
      agent's own tool-execution shell, because the latter can also
      have a real TTY attached — not guaranteed TTY-less the way a bare
      subprocess is. Observed effect: an agent-run commit took the
      CASE A branch, and the terminal prompt ("Please click your
      profile icon...") got dumped into the chat transcript as inert
      text — nobody was watching a real terminal to answer it, so it
      just sat there unanswered rather than hanging or failing loudly.
      **Fix:** stop relying on TTY detection to guess whether the agent
      or a human is running the commit — have the agent self-identify
      explicitly instead. New steering rule in `aidlc-git-
      conventions.md`: before running `git commit` yourself, ask the
      user in chat first, wait for their actual reply, and only then
      run `KIRO_AGENT_COMMIT=1 git commit -m "..."`. `pre-commit` now
      checks `$KIRO_AGENT_COMMIT` *before* the TTY check — if set, skips
      the terminal prompt entirely and logs
      `hook_status=pre-commit-refresh-confirmed-via-chat` instead of
      attempting to read from a TTY nobody may be watching.
      **Tested for real, both paths:**
      - **CASE A (no env var, real terminal, via a genuine pty):**
        unaffected by the fix — prompt appeared, was answered, commit
        succeeded, and `hook-health.log`'s last entry was a plain
        `hook_status=ok`, not the chat-confirmed line (confirms the
        original branch, not the new one, correctly ran here).
      - **CASE B (the actual live chat test):** asked the user directly
        in this conversation — "Please click your profile icon to
        refresh your credits, then let me know when you're ready to
        commit" — and genuinely waited for their reply before running
        anything, in the real chat transcript (not simulated). See the
        session transcript for the exact exchange and the commit that
        followed with `KIRO_AGENT_COMMIT=1` set.
      **Residual gap, stated honestly, not solved by this fix:** a
      truly autonomous, no-human commit that happens to run through a
      TTY-attached shell, where the agent also fails to correctly omit
      `$KIRO_AGENT_COMMIT`, would still hit the CASE A branch and dump
      an unanswered prompt — same failure mode, different trigger. This
      fix closes the specific, confirmed chat-present misdetection; it
      is not a complete guarantee against every unattended-TTY
      scenario.

## Two decisions made in conversation, now recorded here for real (2026-08-26)
These were discussed and settled earlier, but never actually written
into the repo — a status report surfaced that gap directly. Recording
both explicitly now so neither reads as an overlooked open question to
a future person (or a future me).

- [x] **Jira ticket-assignment checking — decided against.** We will
      validate that a ticket ID *exists* in Jira (once that check gets
      built — see the "fake/unvalidated ticket IDs" gap elsewhere in
      this file, still open). We will **not** check who it's assigned
      to. Reason: legitimate cases — pairing, mid-work reassignment,
      email-format mismatches between git identity and Jira account —
      would all produce false warnings for completely normal work.
      Existence-checking and assignment-checking are two different
      features; only the first is in scope.
- [x] **Background credit-sync watcher (cron/daemon polling
      `state.vscdb`) — decided against, in favor of the current
      per-commit delta approach.** Reason: `state.vscdb`'s cache only
      updates via Kiro's own internal AWS auth flow (confirmed earlier
      by correlating cache jumps against `CodeWhispererRuntimeClient`
      log lines — see the "Found by actually testing" entry above) —
      replicating that safely inside a git hook or a standalone
      watcher would mean reverse-engineering undocumented internals and
      adding a hard network dependency to something that currently has
      neither. The per-commit read, plus `credit_confidence` flagging
      when the cache might be stale, is the accepted trade-off — not an
      oversight.

## Jira ticket-existence validation, at all three points a ticket ID gets set (2026-08-26)
- [x] **Built and tested for real at all three points — existence only,
      not assignment (see the decision above).** A typed or resolved
      ticket ID now gets checked against Jira before being trusted:
      - `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json` (CASE A1 and
        CASE C1) — via the real `atlassian-rovo` MCP connection
        (`getJiraIssue` / `searchJiraIssuesUsingJql`). Not found → tell
        the dev plainly, don't save, ask again. MCP failure for any
        other reason → don't block, warn and proceed.
      - `.githooks/pre-commit`'s branch-name AND manual-entry paths
        (extended beyond just branch-name, since manual entry was the
        original demonstrated gap — see "Fake/unvalidated ticket IDs"
        below) — via a direct Jira REST API v3 call
        (`GET /rest/api/3/issue/{key}`), since a plain git hook cannot
        reuse Kiro's own MCP session (confirmed: the OAuth
        tokens/client/verifier in `state.vscdb` are Electron
        `safeStorage`-encrypted blobs — the literal `v11` version-prefix
        bytes — gated behind gnome-keyring, not plainly readable outside
        Kiro's own process). Uses `JIRA_BASE_URL`/`JIRA_EMAIL`/
        `JIRA_API_TOKEN` env vars instead — not provisioned anywhere in
        this repo, so every call currently degrades gracefully
        (`hook_status=pre-commit-jira-validation-skipped-no-credential`)
        until someone sets those up.
      - `.githooks/post-commit`'s CASE B switch question — same direct
        REST call, applied to the new ticket ID before switching.
      **Graceful degradation, all three points:** a confirmed 404
      (issue doesn't exist) is the only thing that rejects an ID.
      Unreachable Jira, no credential configured, timeout, or any other
      inconclusive signal → warn (or silently proceed for the MCP path)
      and accept the ID anyway, logged distinctly from a confirmed
      rejection (`...-jira-validation-unreachable` vs.
      `...-jira-validation-failed`).
      **Tested for real — 9 mechanical scenarios (`pre-commit` ×2 entry
      points, `post-commit` ×1) against a local mock Jira API server**
      (no real Jira credential exists anywhere in this environment —
      confirmed by checking env vars, config files, and the OS keyring;
      the mock replicates Jira's exact `200`/`404`/timeout contract, not
      the real instance):
      | Entry point | Valid | Fake | Unreachable |
      |---|---|---|---|
      | `pre-commit`, branch-name | accepted silently | rejected, falls back to manual entry | accepted, degraded gracefully, `http_code=000` logged |
      | `pre-commit`, manual-entry | accepted silently | **commit blocked** (exit 1) | accepted, degraded gracefully, logged |
      | `post-commit`, switch | switch succeeds, new baseline/episode | switch rejected, `current-ticket.json` byte-identical to before | switch proceeds anyway, degraded gracefully, logged |
      **Item 1 (the AI hook) confirmed live, not just designed** — real
      chat transcript: asked with `ANG-999999`, Kiro called
      `searchJiraIssuesUsingJql` and `getJiraIssue` for real, correctly
      told the dev it doesn't appear to be a real ticket, and asked
      again rather than saving it.
      **Real bug found during that live test, fixed before trusting
      this further:** Kiro's first MCP attempt used
      `cloudId: "https://animedisciples.atlassian.net"` — an unrelated,
      unconfigured site, not something anyone set up anywhere in this
      repo (confirmed: grepped the whole repo and `mcp.json` for
      `cloudId` — zero matches anywhere, nothing tells the agent what
      the real one is). It self-corrected via
      `getAccessibleAtlassianResources` on a second attempt and got the
      right ID (`teamlease-tech.atlassian.net`). A guess that
      self-corrects is not something to trust in an unattended run with
      nobody watching to catch a failed self-correction — so this isn't
      being filed as "harmless, it worked out." **Fixed:** the hook's
      prompt now explicitly requires calling
      `getAccessibleAtlassianResources` first and using its returned
      `cloudId` for every subsequent Jira MCP call in the hook, with the
      real observed bad guess quoted directly in the instruction so a
      future edit doesn't quietly drop the reasoning. Not re-tested
      live after this specific fix (would need another live run through
      Kiro to confirm the guess is actually gone, not just
      instructed against) — worth doing before fully trusting this is
      closed for good.
      **Consequence for the "Fake/unvalidated ticket IDs" gap this
      closes:** previously open, exploitable via manual entry
      (demonstrated directly last session). Now built and tested at all
      three points. `--no-verify` and cherry-pick still bypass
      `pre-commit`/`post-commit` entirely, same structural limit as
      every other pre-commit-based check in this repo — this closes the
      "silently accepted" gap, not the "hooks can be skipped" one.
      **`cloudId` fix confirmed via live retest 2026-08-26 — not just
      "instruction written, unverified" anymore.** Ran the same live
      test again with a different fake ticket (`ANG-888888`), to see
      the guess-vs-lookup behavior directly rather than trust the fix
      on its own wording. Real transcript: the *first and only* tool
      call was `getAccessibleAtlassianResources`, which correctly
      returned `teamlease-tech.atlassian.net`; Kiro went straight to
      `searchJiraIssuesUsingJql` with that real `cloudId` — no wrong
      guess, no self-correction needed this time, unlike the
      `ANG-999999` run that surfaced the bug in the first place. Both
      runs are now on record: one showing the bug (guessed
      `animedisciples.atlassian.net`, self-corrected), one showing the
      fix (looked it up correctly the first time). This closes out the
      Jira ticket-existence validation feature completely — all three
      entry points tested, the `cloudId` bug found, fixed, and
      re-verified, not left as "should be fixed" on the strength of the
      instruction's wording alone.

## Decided: an explicit "commit now" answers the ask-first steering rules (2026-08-26)
- [x] **A real inconsistency, flagged directly rather than left
      ambiguous, then settled explicitly once asked — not something
      that was just quietly happening.** Both agent-initiated-commit
      steering rules (the ticket-switch question in the episode-
      boundary CASE B, and the profile-click question in the
      ask-to-click-gate CASE B — both in `aidlc-git-conventions.md`)
      say to ask every time before/after an agent-run commit. In
      practice, when the user gave a direct, explicit instruction to
      commit right now, the question sometimes got skipped and
      sometimes didn't — a judgment call each time, never a written
      rule either way. **Decided:** an explicit, direct commit
      instruction ("commit this", "just commit it") counts as already
      having answered the question — skip asking again in the same
      breath. Anything less direct (approving a diff without saying
      "commit," moving on to a new topic) still requires asking
      normally. Written into both CASE B sections of
      `aidlc-git-conventions.md` as an explicit documented exception,
      not left as something to re-decide each time.

## Abandoned-terminal gap: interactive prompts could hang forever, fixed with a 5-minute timeout (2026-08-26)
- [x] **Real gap, not hypothetical — a TTY existing was never proof
      someone's actually there.** Both `pre-commit`'s profile-click
      prompt and `post-commit`'s ticket-switch question gate on
      `{ : < /dev/tty; } 2>/dev/null` — proven correct for telling
      "a controlling terminal exists at all" apart from "no controlling
      terminal exists" (see the earlier TTY-detection entries), but
      that check says nothing about whether a human is actually
      watching that terminal right now. Kiro's autopilot mode can leave
      a real terminal technically attached and open while nobody's
      there to answer — a plain `read -p` in that state blocks forever,
      not the no-TTY case these hooks were built to avoid hanging on,
      but a different, previously-unhandled way to hang anyway.
      **Fixed:** both prompts now use `read -t 300` (5 minutes) instead
      of a bare `read -p`. 5 minutes was chosen as long enough for
      someone genuinely nearby to notice and respond, short enough not
      to seriously stall an autopilot run that actually is unattended.
      A timeout logs a status distinct from both a real answer (no log
      line at all) and no TTY at all
      (`...-refresh-prompt-skipped-no-tty` /
      `...-switch-check-skipped-no-tty`):
      `hook_status=pre-commit-refresh-prompt-timeout` and
      `hook_status=post-commit-switch-check-timeout`, so all three
      cases stay distinguishable in `hook-health.log`. A timed-out
      switch question defaults to "not switching" — the same safe
      default already used for an ambiguous reply, no new branching
      needed there.
      **Tested for real, both hooks, both paths:**
      - **Answered within the timeout** (real 300s versions, via a
        genuine pty): both prompts showed their new "(5 min timeout)"
        text, were answered normally, commit succeeded, and
        `hook-health.log`'s relevant entries were plain `hook_status=ok`
        — no timeout line, confirming the answered path is unaffected.
      - **Timed out** (temporary scratch copies with `-t 3` instead of
        `-t 300`, swapped in for one test commit via the same real-pty-
        with-no-input technique used for the original TTY tests, then
        immediately restored to the real 300s versions — the real files
        were never left with a shortened timeout): a real pty was
        allocated, but nothing was ever typed into it. Both prompts
        timed out on their own; the commit completed in a few seconds
        with exit 0 (not hung), `current-ticket.json` stayed untouched
        (correctly defaulted to no-switch), and both new distinct log
        lines appeared with correct timestamps.

## 2026-08-27 (reversed): "explicit commit instruction skips the question" removed
- [x] **The 2026-08-26 decision above ("Decided: an explicit 'commit
      now' answers the ask-first steering rules") has been reversed the
      next day — kept as history, not deleted, since it's useful record
      that this was tried and then undone, not silently forgotten.**
      Both questions — the ticket-switch question (episode-boundary
      CASE B) and the profile-click question (ask-to-click-gate CASE
      B) — must now always be asked, every time, before/after an
      agent-run commit, with no exception for how directly the user
      phrases their request. "Commit it now" no longer skips either
      question. **Reason:** a deliberate choice to prioritize
      consistency over speed — the behavior shouldn't depend on how a
      request happens to be phrased, even though the exception did save
      real friction in the moment.
      **Removed cleanly, not just marked deprecated:** both exception
      paragraphs were deleted from `aidlc-git-conventions.md`, and both
      CASE B sections were verified byte-identical to their pre-
      exception original wording (diffed directly against the commit
      before the exception was ever added), not just eyeballed as
      "looks about right."
      **Confirmed this was steering-doc-only, not code:** grepped
      `.githooks/pre-commit` and `.githooks/post-commit` for any
      reference to "explicit"/"direct instruction"/"commit now" — none
      found. The exception was always a behavioral instruction to the
      agent, exactly as it was originally documented ("Honest limit of
      this mechanism: this is a behavioral instruction... not
      code-level enforcement"), so there was no code to revert. CASE A
      (terminal, always asks) and CASE C (no TTY, or the 5-minute
      timeout above) are both unaffected — they were never related to
      how the user phrased anything, only to whether a human is
      actually reachable to answer at all.

## Known gaps, already understood (not urgent)
- `kiro-session-info` never existed — replaced with a real SQLite read
  (`~/.config/Kiro/User/globalStorage/state.vscdb`). See `pre-commit`
  and `docs/runbook.md` for the details.
- AWS write access doesn't exist yet (`kiro-s3-readonly` is read-only) —
  the S3 upload in `pre-push` and the PR-gate Lambda both need a
  separate, not-yet-created write-capable role. (`pre-commit`'s S3 line
  was removed entirely 2026-08-25 — see the "tracking source of truth
  moved" entry above; no longer applicable there.)
- [x] **Fixed 2026-08-25**, as part of the `aidlc-` naming cleanup below:
  the old `company-policy.md` (now `.kiro/steering/aidlc-git-
  conventions.md`) referenced the old `atlassian`/`sonarqube` MCP server
  names — stale against the current `atlassian-rovo`/`aws` entries in
  `mcp.json`. Reconciled while consolidating the file, not a separate
  step.

## 2026-08-27: `.kiro-tracking/*.json` "new file every commit, keep forever" removed
- [x] **Confirmed by grep, not assumed, before changing anything:**
      searched the whole repo for every reference to `.kiro-tracking` and
      to the file-writing/reading lines specifically. Only one consumer
      existed anywhere: `commit-msg`'s `ls -t .kiro-tracking/*.json |
      head -1`, used to build that same commit's trailers.
      `scripts/calculate-pr-credits.sh` reads `Kiro-*` trailers straight
      from `git log`/commit messages — confirmed it never touches this
      directory. `pre-push`'s SonarQube-gate JSON (`${TICKET_ID}-gate-
      *.json`, uploaded to S3) is a separate, currently-dead code path
      (the gate is hard-disabled with an `exit 0` before that line ever
      runs) — unrelated to the per-commit ticket-tracking files and left
      untouched.
- [x] **Changed:** `pre-commit` no longer writes
      `.kiro-tracking/${TICKET_ID}-$(date +%s).json` and `git add`s it
      every commit. It now writes the same values as plain `KEY=value`
      lines to a transient file inside `.git/` itself
      (`$(git rev-parse --git-dir)/KIRO_COMMIT_DATA`) — never tracked,
      never committed, one file, overwritten every commit.
      `commit-msg` sources that file directly to build the trailers,
      then deletes it immediately after (`rm -f`) so a stale value can
      never leak into an unrelated read. A single gitignored debug file
      per ticket (`.kiro-tracking/${TICKET_ID}.json`, overwritten every
      commit, explicitly commented `"Debug convenience only... not read
      by any hook or script"`) remains for a human to glance at —
      **nothing reads it back**, unlike the old file it replaces.
      `.gitignore` updated: the whole `.kiro-tracking/` directory is now
      ignored (previously only `hook-health.log` was — the `*.json`
      files were deliberately tracked, which was exactly the accumulate-
      forever problem).
- [x] **Flagged explicitly, per the request that prompted this: does
      anything essential belong in `post-commit` instead of
      `pre-commit`?** No, and nothing was moved there. Two independent
      reasons: (1) `post-commit`'s own interactive prompts already
      no-op without a TTY or `$KIRO_AGENT_COMMIT` (logged as
      `...-skipped-no-tty`, see the 2026-08-26 entries above) — the same
      gap would apply to anything else placed there; (2) more
      fundamentally, `post-commit` runs *after* the commit object and
      its message already exist, so it structurally cannot alter that
      commit's own trailers no matter what fires it. Trailer computation
      stays entirely in `pre-commit` (already the one hook the ticket-
      resolution logic treats as guaranteed to run on every real,
      non-`--no-verify` commit) plus `commit-msg`.
- [x] **Tested live, in an isolated clone of this repo (not on real
      history) with the actual edited hook files copied in** —
      `core.hooksPath`, consent marker, and `.kiro/current-ticket.json`
      all matched real local state:
      - Two real commits through the modified `pre-commit` +
        `commit-msg`: both produced correct, non-empty `Kiro-Ticket`/
        `Kiro-Episode`/`Kiro-Credits`/`Kiro-Confidence`/`Kiro-Session`/
        `Kiro-Source` trailers, sourced from the transient `.git/`
        file — zero intermediate JSON files created or committed
        (`git show --stat` on both commits showed only the intended
        file changed).
      - Confirmed the debug file is overwritten, not accumulated: same
        filename both commits, mtime advanced, still exactly one file.
      - Confirmed `.git/KIRO_COMMIT_DATA` was gone (deleted by
        `commit-msg`) after each commit.
      - Confirmed the debug file now shows as gitignored (`!!` in
        `git status --ignored`) once the updated `.gitignore` was in
        place.
      - Ran `scripts/calculate-pr-credits.sh --range` in that clone
        before and after deleting every old-style accumulated
        `.kiro-tracking/*.json` file: **byte-identical output**,
        confirming the deletion is safe.
      - Re-ran `calculate-pr-credits.sh --range` against this repo's
        real history after actually deleting the 34 old accumulated
        files (`.gitkeep` kept) — output unchanged (`none: 12.4200
        credits`, `TEST-000: 0.1300 credits`), matching pre-deletion.
- [x] **Deleted the 34 already-committed `.kiro-tracking/*.json` files
      from this repo's real working tree** (`.gitkeep` kept so the
      directory still exists for `mkdir -p .kiro-tracking` to find) —
      staged via `git rm`, not yet committed as of this writing. See
      `README.md` §6/§7 and `docs/runbook.md` for the updated
      documentation.

## 2026-08-27: terminal-typed ticket IDs no longer trusted directly — deferred to Kiro chat's real Jira access
- [x] **The gap, confirmed live the same day (see the previous
      workflow-walkthrough session):** `pre-commit`'s manual-entry
      fallback and `post-commit`'s ticket-switch prompt both call
      `validate_jira_ticket()`, but `JIRA_BASE_URL`/`JIRA_EMAIL`/
      `JIRA_API_TOKEN` are unset anywhere in this repo (confirmed by
      checking the environment directly) — so that function always
      takes its "skipped-no-credential" branch and accepts anything.
      Demonstrated concretely: typing `ZZZZ-99999` at the switch prompt
      was accepted exactly like a real ticket. Kiro chat's own
      ask-ticket hook, by contrast, genuinely does validate via live
      `atlassian-rovo` MCP — so the fix is to defer to that, not to
      provision a second Jira credential just for the git-hook level.
- [x] **Changed, both entry points:**
      - `pre-commit`'s manual-entry fallback: a typed ticket ID (not
        empty, not literally `none`) is no longer trusted. The commit
        is tracked as `none` — the same honest bucket already used for
        genuinely untracked work — and `.kiro/pending-ticket-check.json`
        (`{"typed_ticket": "...", "flagged_at": "..."}`) is written to
        hand the typed value to Kiro chat. Never blocks the commit.
      - `post-commit`'s "working on a different ticket?" flow: a typed
        new ticket ID is no longer switched to immediately.
        `current-ticket.json` is left on the OLD ticket, and the same
        pending file is written instead. Typing literal `none` is
        unaffected — it isn't a claim about a real Jira ticket, so
        there's nothing to defer; that switch still happens instantly,
        confirmed by a regression test (see below).
      - `post-commit`'s own copy of `validate_jira_ticket()` is now
        unused (its only call site was removed) — deleted rather than
        left as dead code, matching this repo's own "remove, don't
        leave misleading code around" precedent from the
        `.kiro-tracking` cleanup above. `pre-commit`'s copy is
        untouched and still used by the branch-name fallback, which
        this change deliberately did not touch (out of scope of what
        was asked — flagged to the user as the same unvalidated gap,
        left for a separate decision).
      - `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`: added a new
        "PRIORITY CHECK" section to the top of the prompt, run before
        CASE A/B/C on every message. If `.kiro/pending-ticket-check.json`
        exists: validates `typed_ticket` via the same
        `getAccessibleAtlassianResources` → `getJiraIssue`/
        `searchJiraIssuesUsingJql` sequence CASE A/C already use
        (existence-only, same policy as everywhere else in this hook).
        Real → generates a fresh baseline/episode via the exact same
        command as CASE A1 (extracted verbatim from CASE A1's own text
        via script, not retyped, specifically to avoid a shell-escaping
        mistake — see the test note below) and writes
        `current-ticket.json`, unless the pending ticket already
        matches what's there (then just confirms, no regeneration).
        Fake → tells the user plainly, deletes the pending file,
        leaves `current-ticket.json` exactly as it was, and asks which
        ticket they're actually on. Either way, proceeds to actually
        answer the user's original message afterward — this check
        doesn't swallow it.
      - `.gitignore`: added `.kiro/pending-ticket-check.json` (local,
        transient, same category as `current-ticket.json`).
- [x] **Tested for real, git-hook side — 5 scenarios, isolated fresh
      repo, real pty (same technique as this repo's own 5-minute-
      timeout tests), nothing simulated or paraphrased:**
      1. **Manual entry, real-looking ticket (`ANG-130`):** commit
         trailers came out `Kiro-Ticket: none` / `Kiro-Source:
         manual_entry`; `.kiro/pending-ticket-check.json` held
         `{"typed_ticket": "ANG-130", ...}`; `current-ticket.json`
         stayed `{}`.
      2. **Manual entry, fake ticket (`XYZQ-00001`):** byte-identical
         shape to scenario 1 — `Kiro-Ticket: none`, pending file
         correctly recorded `XYZQ-00001`, `current-ticket.json`
         untouched. Confirms the git-hook level genuinely can't (and
         no longer pretends to) tell these two cases apart — that's
         the whole point of deferring both to Kiro chat.
      3. **Post-commit switch, real-looking ticket (`ANG-131`), from
         an existing `ANG-130` baseline:** that commit's own trailers
         stayed `ANG-130`/`ep_baseline001` (switch correctly deferred,
         not applied to the commit that triggered the question);
         `current-ticket.json` stayed exactly on `ANG-130`; pending
         file recorded `ANG-131`.
      4. **Post-commit switch, fake ticket (`QQQQ-00099`):**
         byte-identical shape to scenario 3 — commit stayed on
         `ANG-130`, `current-ticket.json` unchanged, pending file
         recorded `QQQQ-00099`.
      5. **Regression check — switching to literal `none` still works
         instantly, not deferred:** `current-ticket.json` correctly
         became `{"ticket_id": "none", "credits_at_ticket_start":
         253.86, "episode_id": "ep_..."}`, no pending file created.
      One real escaping mistake caught and fixed during this work,
      worth recording: the credit/episode-id command embedded in the
      new PRIORITY CHECK prompt text was hand-typed on the first pass
      and came out with extra stray backslashes (JSON string escaping
      nested three levels deep — Python source → JSON encoding → the
      bash command itself — is easy to get wrong by hand). Caught by
      actually extracting and *executing* the embedded command as real
      bash rather than eyeballing it; fixed by re-deriving the section
      via script from the already-correct, already-tested CASE A1
      command instead of retyping it, then re-verified by executing the
      extracted text again — it ran and printed real output.
- [x] **NOT tested, and cannot be from this session — flagged
      explicitly rather than assumed passing:** the new PRIORITY CHECK
      section's actual execution — Kiro chat reading
      `pending-ticket-check.json`, calling live `atlassian-rovo` MCP,
      and writing `current-ticket.json` back — requires a real Kiro
      chat session with a live Jira MCP connection, neither of which
      this Claude Code session has access to (no such MCP tool is
      available here; confirmed by searching for one, not assumed
      absent). The JSON is valid, the embedded command was verified by
      actually running it, and the logic was written to match CASE
      A1/C1's already-tested conventions as closely as possible — but
      the chat-driven validation path itself needs a real Kiro session
      to exercise, the same way this repo's own earlier "Jira
      validation confirmed live" entries were tested by a human
      operating Kiro directly, not by an automated agent. Worth doing
      before relying on this for real.
- [x] **The honest trade-off, as requested:** a ticket typed at a
      terminal is now tracked as `none` (or left on the old ticket, for
      a switch) until the *next* time the user talks to Kiro — not
      instantly. This closes the fake-ticket-accepted gap without a
      second Jira credential, but at the cost of a delay: work done
      between the flagged commit and the next chat message is
      attributed to `none`/the old ticket, not retroactively corrected
      until validation actually runs. If several commits happen before
      the next chat message, only the LATEST pending file survives
      (each write overwrites the last) — an earlier typed ticket from
      an earlier commit in that gap would be silently superseded,
      never validated at all. Not fixed here; noted for awareness.

## 2026-08-27 (same day, follow-up): branch-name ticket resolution closed the same way — 4 of 4 entry points now consistent
- [x] **Called out explicitly in the report on the fix above, not left
      as a silent gap:** `pre-commit`'s branch-name fallback still
      called the same `validate_jira_ticket()` that manual-entry and
      the switch prompt had just stopped trusting — meaning a fake
      ticket in a branch name (e.g. `ZZZZ-99999-some-branch`) would
      still have been silently accepted, the exact same never-actually-
      working REST check as everywhere else (no credential configured,
      confirmed live). Decided to close it the same day rather than
      leave it as a separate loose end, per direct feedback that 3-of-4
      entry points protected isn't the right bar to call this done.
- [x] **Changed:** `pre-commit`'s branch-name resolution now defers
      exactly like manual-entry and the switch prompt — a branch-
      derived ticket (`git branch --show-current | grep -oE
      '^[A-Z]+-[0-9]+'`) is no longer trusted directly. It's written to
      `.kiro/pending-ticket-check.json`, the commit is tracked as
      `none`, and `current-ticket.json` is left untouched. A branch
      with no ticket-shaped prefix at all still falls through to the
      manual-entry prompt exactly as before — unaffected, confirmed by
      test. `validate_jira_ticket()` had no remaining call sites in
      `pre-commit` once this changed (manual-entry's call was already
      removed the same day, branch-name's was its last user) — deleted
      the function entirely rather than leave it as dead code, matching
      the same precedent already applied to `post-commit`'s copy.
- [x] **Tested for real, 3 more scenarios, same isolated-repo-plus-
      real-pty method as the manual-entry/switch tests above:**
      1. **Branch `ANG-132-add-filter` (real-looking):** commit
         trailers came out `Kiro-Ticket: none` / `Kiro-Source:
         branch_name`; pending file recorded `{"typed_ticket":
         "ANG-132", ...}`; `current-ticket.json` stayed `{}`.
      2. **Branch `ZZZZ-88888-fake-ticket-branch` (fake):**
         byte-identical shape to scenario 1 — `Kiro-Ticket: none`,
         pending file recorded `ZZZZ-88888`. Confirms this entry point
         genuinely can't (and no longer pretends to) tell a real
         ticket-shaped branch name from a fake one either.
      3. **Regression — branch `master` (no ticket-shaped prefix)
         still falls through to the manual-entry prompt correctly, not
         accidentally deferred:** typed `none` at the prompt, no
         pending file created, `Kiro-Source: manual_entry` as before —
         confirms the branch-name deferral only fires when the regex
         actually matches something, exactly as designed.
      `bash -n` syntax-checked after the edit, same as every hook
      change this session.
- [x] **Still exactly the one honest gap from the fix above, unchanged
      by this follow-up:** the chat-side half (Kiro reading the pending
      file and validating live against Jira, for whichever of the now
      3 deferring entry points triggered it) has not been exercised in
      a real Kiro session — this follow-up only closed the 4th
      git-hook-level entry point to the same untested-chat-side
      standard the other three were already at, not a new capability
      needing separate chat-side testing. One real Kiro-session test of
      the pending-file flow (real ticket + fake ticket, per the
      original request) now covers all three deferring paths at once,
      since they all funnel into the identical priority-check logic in
      `aidlc-ask-for-ticket-if-missing.json`.

## 2026-08-27 (same day, follow-up): two real problems from the last commit attempt
- [x] **Problem 1 — `.kiro/current-ticket.json` force-added despite
      being gitignored on purpose.** A real commit
      (`ANG-124: update hooks and tracking files`, made directly, not
      through this session) force-added it. Confirmed it was already
      *committed*, not just staged, by the time this was caught —
      `git restore --staged` alone would have been a no-op. Since that
      commit was the local tip and unpushed (18 commits ahead of
      `origin/ANG-000-test-pr-credits-flow`, confirmed via `git branch
      -vv` before touching anything), fixed cleanly with `git rm
      --cached .kiro/current-ticket.json` + `git commit --amend
      --no-edit` — removed from tracking and from that commit's history
      entirely, file left untouched on disk, confirmed via `git
      ls-files`, `git show --stat`, and `git status --ignored` (now
      shows `!!`, correctly ignored again) after the amend.
      **Added to `.kiro/steering/aidlc-git-conventions.md`'s commit
      hygiene section:** never use `git add -f` to override a gitignore
      refusal without explicit user confirmation first — a refusal is a
      deliberate signal (often per-machine ephemeral state), not an
      obstacle to route around.
- [x] **Problem 2 — `post-commit`'s switch question was never checking
      `$KIRO_AGENT_COMMIT`, the same class of bug `pre-commit`'s
      profile-click prompt already found and fixed on 2026-08-26.**
      `post-commit` only ever checked TTY presence (`{ : < /dev/tty; }`)
      to decide whether to ask "Working on a different ticket now?" —
      but an agent's own tool-execution shell CAN have a real TTY
      attached (confirmed before, for pre-commit's prompt; now
      confirmed for this one too), so a `KIRO_AGENT_COMMIT=1` commit
      still got asked, dumping the question into a chat transcript as
      inert, unanswerable text — a real incident, not hypothetical.
      **Fixed:** `post-commit` now checks `$KIRO_AGENT_COMMIT` FIRST,
      same priority order as `pre-commit`, logging a distinct
      `hook_status=post-commit-switch-check-skipped-agent-commit` (kept
      separate from `-skipped-no-tty` so the two causes stay
      distinguishable in `hook-health.log`, same principle as every
      other status line this session). `aidlc-git-conventions.md`
      updated to match: CASE B's description now names both fallback
      triggers explicitly instead of conflating "agent commit" with "no
      terminal exists" (the same wrong assumption that caused the bug
      in the first place), and the CASE B chat-counterpart paragraph
      now says plainly that a TTY may well be attached — the real
      signal is `$KIRO_AGENT_COMMIT`, not TTY absence.
      **Tested for real, 4 scenarios, isolated repo, real pty (proving
      an actual TTY was attached, not just absent — otherwise this
      wouldn't distinguish the fix from the pre-existing no-TTY
      fallback that already worked):**
      1. **`KIRO_AGENT_COMMIT=1` through a real pty (the exact bug):**
         no prompt appeared, commit completed immediately (no 5-minute
         hang), `hook-health.log` recorded
         `post-commit-switch-check-skipped-agent-commit`, and
         `current-ticket.json` stayed exactly as it was — confirming
         the fix, not just its absence of a crash.
      2. **Regression — normal human TTY commit, no
         `KIRO_AGENT_COMMIT`:** the question still appeared and was
         answerable through the real pty exactly as before —
         unaffected by this change.
      3. **`KIRO_AGENT_COMMIT=1` with no TTY at all:** still logged the
         more specific `-skipped-agent-commit`, not `-skipped-no-tty` —
         confirms the priority order (agent check runs first).
      `bash -n` syntax-checked after the edit.

## 2026-08-27 (same day, follow-up): branch-name ticket guessing removed entirely
- [x] **Decided:** having just given branch-name resolution its own
      honest pending-ticket-check deferral (the entry two sections up),
      removed the whole code path outright instead — a second,
      easy-to-forget place resolving a ticket ID that nothing here
      could actually validate, for a value (the branch name) nobody
      explicitly asked to be treated as a ticket claim. One fewer
      code path, one fewer thing that can silently guess wrong.
- [x] **Changed:** deleted
      `TICKET_ID=$(git branch --show-current | grep -oE
      '^[A-Z]+-[0-9]+')`, `SOURCE="branch_name"`, and the
      pending-ticket-check block that depended on it from
      `.githooks/pre-commit` entirely. An empty `current-ticket.json`
      now goes straight to the manual-entry prompt (still deferred to
      chat via the same pending-file pattern) regardless of what the
      branch is named. The "fail closed" error message's mention of
      branch-naming convention was removed too, since it's no longer
      relevant advice. `SOURCE` now has exactly two possible values,
      `kiro_session` and `manual_entry` — confirmed by grep across the
      whole repo that `branch_name` no longer appears anywhere as a
      live code reference, only in historical comments/decision
      entries explaining what was removed and why.
      **Checked and found not applicable, not skipped:**
      `scripts/calculate-pr-credits.sh` and
      `scripts/coverage-report.sh` — grepped for
      `source_of_ticket_id`/`branch_name`/`SOURCE`, zero matches in
      either; neither script ever read the `SOURCE` field at all (only
      `Kiro-Ticket`/`Kiro-Credits` trailers), so nothing there needed
      updating.
      `.kiro/steering/aidlc-git-conventions.md` and
      `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json` — also
      grepped, zero matches; the steering doc's "CASE A — branch
      switch" is a different concept entirely (post-checkout resetting
      `current-ticket.json` on a branch *change*, not guessing a ticket
      ID from branch *text*), so nothing there referenced the removed
      behavior to begin with.
      `docs/runbook.md`'s embedded `pre-commit` code snippet did still
      show the old branch-name block (already known to be a partially
      stale doc from earlier sessions) — updated to match.
- [x] **Tested for real, 3 scenarios, isolated repo, real pty:**
      1. **Ticket-shaped branch (`ANG-777-something`), empty
         `current-ticket.json`:** went straight to "No ticket found.
         Enter ticket ID" with zero attempt to extract `ANG-777` from
         the branch — confirmed by the prompt appearing immediately,
         and `Kiro-Source: manual_entry` (never `branch_name`) in the
         resulting trailers.
      2. **Same branch, typing `ANG-777` manually at the prompt:**
         deferred exactly like any other manual entry —
         `pending-ticket-check.json` recorded `{"typed_ticket":
         "ANG-777", ...}`, trailers showed `Kiro-Ticket: none` /
         `Kiro-Source: manual_entry` — proving the branch name has no
         special effect even when it happens to match the typed value.
      3. **Regression — plain branch `master` (no ticket-shaped name
         at all), same manual entry of `ANG-777`:** trailers came out
         byte-identical to scenario 2 — confirms the behavior is now
         genuinely the same regardless of branch name, exactly as
         requested.
      `bash -n` syntax-checked after the edit.

## 2026-08-27 (same day, follow-up): pre-commit's interactive ticket prompt removed entirely — real design gap found through live testing
- [x] **The gap:** `pre-commit`'s manual-entry fallback still had a
      `read -p "No ticket found. Enter ticket ID (or 'none'): "
      < /dev/tty` even after the redesign that stopped trusting whatever
      it typed. Two real problems, not style preferences: (1) it
      double-asked what Kiro chat's CASE A already asks whenever
      `current-ticket.json` is empty — two separate places asking the
      same question; (2) it hung/got interrupted outright when a commit
      ran in a non-interactive context (an agent's tool execution) with
      no controlling terminal able to answer it.
- [x] **Changed:** removed the `read -p` entirely, along with the
      "fail closed on a blank read" block right after it (now dead code
      — `TICKET_ID` can never come out empty at that point anymore).
      When `current-ticket.json` is empty, `pre-commit` now
      unconditionally tracks the commit as `none`, writes
      `.kiro/pending-ticket-check.json` with `{"typed_ticket": null,
      "flagged_at": "..."}` (nothing was typed, so nothing to hand off
      for validation — this is a "ticket owed" flag, not a value to
      check), and lets the commit proceed with zero wait. `SOURCE` is
      now `unset` for this case — `manual_entry` is no longer a
      possible value (joining `branch_name`, removed the same day, a
      few entries up).
      `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`'s PRIORITY
      CHECK section updated to handle two distinct pending-file shapes
      instead of one: `typed_ticket` as a real string (only from
      `post-commit`'s switch prompt now) still goes through the
      existing atlassian-rovo MCP validation; `typed_ticket: null`
      (from `pre-commit`, nothing typed) needs no MCP call at all — just
      delete the pending file and fall through to CASE A below exactly
      as if the file never existed, since `current-ticket.json` is
      still empty either way and CASE A already asks unconditionally in
      that situation. No new chat-side logic was needed for the "ask"
      part — Kiro chat already does this identically to today, for
      the same trigger condition it's always checked.
      Also updated: the stale historical comment in `pre-commit`
      explaining the branch-name removal (it still said ticket
      resolution "goes through Kiro chat or manual entry below,
      deferred to chat" — no longer accurate once manual entry stopped
      deferring a typed value and started deferring nothing at all);
      `docs/runbook.md`'s embedded snippet (removed both the `read -p`
      and the now-dead fail-closed block, to match); confirmed via grep
      that neither `scripts/calculate-pr-credits.sh` nor
      `scripts/coverage-report.sh` reference `SOURCE` at all (same
      finding as the branch-name removal, still holds).
- [x] **Tested for real:**
      1. **No TTY at all (plain non-interactive shell, the realistic
         agent-tool-execution case), no ticket set:** `time git commit`
         completed in **0.477 seconds** — no hang, no interruption,
         confirming the exact failure mode this fix targets is gone.
         Trailers came out `Kiro-Ticket: none` / `Kiro-Source: unset`;
         pending file held `{"typed_ticket": null, ...}`;
         `current-ticket.json` stayed `{}` — exactly the condition
         CASE A already checks for.
      2. **Real TTY attached (via pty), no ticket set:** confirmed no
         "Enter ticket ID" prompt appears under any condition anymore —
         only the pre-existing, unrelated profile-click and
         ticket-switch prompts showed, proving the removal is complete,
         not just the no-TTY path.
      3. **A real, subtle interaction bug this fix's own testing
         surfaced and confirmed, not just theorized:** `pending-ticket-
         check.json` is a single file — `pre-commit` now writes a
         `null` flag to it on every "no ticket set" commit, which can
         silently clobber a genuinely typed ticket from an earlier
         `post-commit` switch that hasn't reached chat yet. Reproduced
         directly: commit N answered the switch prompt with `ANG-999`
         (correctly written to the pending file); commit N+1, no chat
         message in between, `current-ticket.json` still empty,
         silently overwrote it with `{"typed_ticket": null, ...}` —
         `ANG-999` was gone, never validated. Not fixed here (would
         need either a queue instead of a single file, or refusing to
         overwrite a real value with a `null` one) — documented as a
         known, confirmed-real gap in README §8, not left implicit.
      `bash -n` and `python3 -m json.tool` (via `json.load`)
      syntax-checked after the edits.

## 2026-08-27 (same day, follow-up): pending-ticket-check.json's null-clobbers-real-value bug fixed for real, not just documented
- [x] **Two options proposed before building either, per direct
      request:**
      - **Option A — queue (array) instead of single object.**
        Rejected: needs a schema change in three places (`pre-commit`,
        `post-commit`, the priority-check hook's own logic), plus
        invented semantics (does a stale real entry still get validated
        after a newer one supersedes it? what does `[null, "ANG-999",
        null]` even mean operationally?), and re-introduces the exact
        "accumulate until something external drains it" shape already
        removed from `.kiro-tracking/*.json` earlier this session —
        bounded differently, not eliminated.
      - **Option B — chosen. Check for an existing real `typed_ticket`
        before writing; skip the write entirely if one's there.** One
        conditional, no schema change, zero changes needed to
        `post-commit` or the priority-check hook. Restores exactly the
        pre-existing "most recent switch wins" trade-off (real-over-real
        is fine, null-over-null is fine) without adding a queue's worth
        of new semantics — matches this session's repeated preference
        for a smaller, more honest mechanism over a more complete but
        more complex one (branch-name removal, terminal-prompt removal,
        `.kiro-tracking` accumulation removal — same pattern each time).
- [x] **Changed:** `pre-commit`'s "no ticket set" block now reads
      `.kiro/pending-ticket-check.json` (if it exists) via `jq -r
      '.typed_ticket // empty'` before writing anything. If that comes
      back non-empty (a real value is already pending), the write is
      skipped entirely — the file is left byte-for-byte untouched — and
      a distinct message explains why. This commit still tracks as
      `none` either way; only the pending-file write is conditional.
- [x] **Tested by literally re-running the exact clobbering scenario
      from earlier the same day, with the fix in place, same isolated-
      repo-plus-real-pty method:**
      1. **Commit N** — answered post-commit's switch prompt with
         `ANG-999`; pending file correctly recorded it.
      2. **Commit N+1** — no chat message in between,
         `current-ticket.json` still empty (the exact clobbering
         setup): pending file came out **byte-for-byte unchanged**,
         same `flagged_at` timestamp as commit N, with the new log
         message confirming the guard fired: "A real ticket
         ('ANG-999') is already awaiting validation from an earlier
         commit — leaving it untouched rather than overwriting it with
         nothing."
      3. **Regression — commit N+1's own trailers unaffected:** still
         honestly `Kiro-Ticket: none` / `Kiro-Source: unset` — confirms
         the guard protects only the pending *file*, not this commit's
         own tracking.
      4. **Regression — writes resume once the pending file is
         cleared** (simulating Kiro chat having processed it): a fresh
         `null` flag gets written normally on the next ticketless
         commit.
      5. **Regression — `null`-over-`null` still overwrites normally:**
         two genuinely ticketless commits in a row updated the
         timestamp both times — confirms the guard is narrowly scoped
         to "never let null erase a real value," not "never overwrite
         anything."
      `bash -n` syntax-checked after the edit.

## 2026-08-27 (same day, follow-up): count-based (not time-based) fallback added to both CASE B chat questions
- [x] **The limitation this is built around, stated as plainly as
      requested, not softened:** the chat-based profile-click question
      and the chat-based ticket-switch question both had a "wait for
      their actual reply" instruction with no fallback at all if the
      reply never clearly comes — unlike their terminal counterparts,
      which have a real, code-enforced `read -t 300` (5-minute timeout).
      **A chat equivalent of that timeout is not possible, not just
      unbuilt:** Kiro can only respond to messages the user sends: it
      cannot act on its own after a period of silence, no matter how
      much real time passes with nobody saying anything. There is no
      "wake up after 5 minutes" for a chat turn. So the fallback added
      here is explicitly **count-based, not time-based** — it counts
      unanswered attempts (up to 3), never elapsed time — and both the
      steering doc and this entry say so in those exact words, per the
      request, rather than being described as "after 1 minute" or any
      other real-time framing that would misrepresent what's actually
      possible.
- [x] **Changed, both CASE B questions in
      `.kiro/steering/aidlc-git-conventions.md`:** ask the question. If
      the reply doesn't clearly answer it, ask again — up to 3 asks
      total. If the reply to the third ask still doesn't clearly answer
      it, stop asking:
      - **Profile-click question:** proceed with the commit anyway,
        setting `KIRO_AGENT_COMMIT=1` as usual, but ALSO
        `KIRO_AGENT_COMMIT_UNCONFIRMED=1` — plus stating it plainly in
        that same chat message ("Asked 3 times, no confirmation
        received — committing anyway without confirmed readiness").
      - **Ticket-switch question:** proceed as if the answer were "no"
        (the pre-existing safe default for an ambiguous single reply,
        now also used for 3 unanswered attempts), stating it plainly in
        chat the same way.
- [x] **Went one step further than "state it in chat" where it was
      actually reachable, per the request's own "if reachable from a
      steering instruction" clause — checked, not assumed impossible:**
      the profile-click question has a real hook invocation
      (`pre-commit`) running immediately after it resolves, so a second
      env var IS reachable there. Added `$KIRO_AGENT_COMMIT_UNCONFIRMED`
      to `.githooks/pre-commit`: when set alongside
      `$KIRO_AGENT_COMMIT`, it logs a distinct
      `hook_status=pre-commit-refresh-confirmed-via-chat-unconfirmed`
      (vs. the normal `-confirmed-via-chat`), giving this specific piece
      of the behavioral rule a real, auditable `hook-health.log` line —
      not just a chat message that could scroll away. **Checked the
      ticket-switch question for the same opportunity and found it
      genuinely isn't reachable, not just harder:** that question
      resolves entirely in chat, after `post-commit` has already
      finished running for the commit that triggered it — there is no
      hook invocation happening at the moment a fallback would fire to
      log anything into. For that question, "stated plainly in chat" is
      the only reachable form, and the steering doc says so explicitly
      rather than implying otherwise.
- [x] **Tested, two different ways, matched to what each part actually
      is:**
      - **The log-reachable code part — tested for real, the same way
        as everything else this session:** isolated repo, two agent
        commits. `KIRO_AGENT_COMMIT=1` alone logged
        `hook_status=pre-commit-refresh-confirmed-via-chat` (regression
        check, unaffected). `KIRO_AGENT_COMMIT=1
        KIRO_AGENT_COMMIT_UNCONFIRMED=1` logged the new, distinct
        `hook_status=pre-commit-refresh-confirmed-via-chat-unconfirmed`
        line. `bash -n` syntax-checked after the edit.
      - **The behavioral part — this cannot be pty-scripted or run in
        an isolated repo the way hook code can; it requires an actual
        multi-turn chat exchange with a real reply cadence.** Per the
        request's own test protocol, this needs to be run live: ask to
        commit, receive two genuinely unrelated replies, confirm the
        third unanswered attempt actually triggers the fallback rather
        than asking forever. That live run is happening in this same
        session, immediately after this entry — see the conversation
        itself for the real transcript, not a description of one.
        **Same honesty standard as the profile-click chat mechanism
        this extends:** this is implemented-but-behavioral, not
        code-enforced — nothing stops a future agent turn from just
        asking a 4th, 5th, 6th time instead of following this rule, the
        same honest limit already stated for CASE B's base mechanism.

## 2026-08-27 (same day, follow-up): "no ticket = none" reversed entirely — every commit now requires a real ticket, no exceptions
- [x] **What prompted this, stated plainly:** this was a deliberate
      policy decision, not a bug fix — the "no ticket = track as `none`
      and let the commit through" design was working exactly as built
      (confirmed live earlier the same day: two real "testing case a"
      commits landed cleanly under `Kiro-Ticket: none` /
      `Kiro-Source: unset`, on the `test-case-a` branch). Seeing that
      design actually work in practice is what prompted the decision to
      reverse it: untracked/exploratory commits are no longer allowed
      at all, not even honestly labeled ones.
- [x] **Changed, all four places `none` existed as a valid ticket
      answer, confirmed by grepping the whole repo, not assumed
      complete from memory:**
      - **`.githooks/pre-commit`:** the entire "empty ticket → track as
        `none`, write a null pending-flag, let the commit through"
        block (built two entries up, then patched for the
        null-clobber bug one entry after that) is gone, replaced with
        an unconditional block: `if [ -z "$TICKET_ID" ]; then` prints
        the exact requested message and `exit 1`. No pending file is
        written in this case anymore — there's nothing to defer once
        the commit itself doesn't happen. The now-constant `SOURCE`
        variable is kept (not hardcoded inline) since it's still a
        real trailer field, with a comment explaining it's always
        `kiro_session` now.
      - **`.githooks/post-commit`:** the switch-flow's `elif
        [ "$NEW_TICKET" = "none" ]` branch (which used to skip Jira
        validation and switch to an untracked state immediately, since
        "none" was never a claim about a real ticket) is deleted,
        along with the `"(or 'none')"` text in the prompt itself. A
        typed `"none"` now falls into the same "can't validate here,
        defer to chat" branch as any other string — it becomes an
        ordinary pending ticket that Jira will (correctly) reject as
        nonexistent, rather than a specially-recognized bypass.
        Declining the switch with a blank answer is unaffected —
        that was never "setting the ticket to none," just not
        switching, and stays exactly as it was.
      - **`.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`:** six
        separate `'none'`-related phrases removed from the prompt
        text, each verified present, unique, and successfully replaced
        via a scripted patch with assertions (same reliable method used
        for every previous hook-JSON edit this session, to avoid the
        JSON-escaping mistakes found earlier): CASE A1's "or is exactly
        'none'" answer-recognition clause and its "(not 'none')"
        validation-skip clause; CASE A2's "(or 'none' for work with no
        ticket)" option in the question itself, replaced with an
        explicit "every commit now requires a real, validated ticket,
        no exceptions" clause; CASE C1's "unless pending_switch_to is
        exactly 'none'" validation-skip clause (already effectively
        dead code in practice, since CASE C2's own trigger regex could
        never produce a literal "none" — removed anyway for
        consistency); and two "Once it's 'none', or..." phrasings
        tightened to drop the now-impossible case. The PRIORITY CHECK
        section's entire "shape 2" (`typed_ticket: null`, pre-commit's
        old "nothing typed" flag) is deleted along with its dedicated
        handling paragraph — there is only one shape left
        (`post-commit`'s real typed value), since `pre-commit` no
        longer produces the other one. One legitimate, deliberately
        kept mention remains: a backward-compatibility note that a
        *leftover* `"none"` from before this reversal still counts as
        "different from the new ticket" if found in an old
        `current-ticket.json` — not an option offered going forward,
        just graceful handling of pre-existing data.
      - **`docs/runbook.md`:** targeted fixes to the same "none"
        mentions in its embedded hook snippets (the pre-commit and
        ask-ticket-hook copies), without attempting a full resync of
        this doc's other, already-flagged staleness (see README §2/§6)
        — out of scope of this specific reversal. One mention at line
        ~711 was left untouched on inspection: it correctly describes
        `"none"` as *historical* behavior ("before this was tracked"),
        justifying today's max-per-episode aggregation logic — not an
        offer of `"none"` as a current option, so nothing to fix there.
      - **`.kiro/steering/aidlc-git-conventions.md`:** new top-level
        section, "Ticket assignment is mandatory — no exceptions, no
        'none'," added right after "Ticket linking," spelling out the
        policy, what changed concretely at each of the three affected
        points, what's unchanged (an already-set/validated ticket, and
        the pending-validation flow for a typed/switched ticket), and
        the honest trade-off.
- [x] **Tested for real, 4 scenarios plus a regression check, isolated
      repo (fresh `git init`, real copied hooks), real pty where
      interactivity mattered:**
      1. **Empty `current-ticket.json`, attempt to commit:** blocked,
         `EXIT=1`, the exact requested message printed verbatim, no
         commit created (`git log` unchanged, file still staged).
      2. **Post-commit's switch flow, typing `none` as the new
         ticket:** `current-ticket.json` stayed on the old ticket
         (`ANG-150`), unchanged; `.kiro/pending-ticket-check.json`
         recorded `{"typed_ticket": "none", ...}` — confirmed `none` is
         no longer specially recognized, just an ordinary string headed
         for (correct) rejection by real Jira validation.
      3. **A real, already-validated ticket set, then commit:**
         succeeded normally — `[master ...] Test 3...`, correct
         trailers (`Kiro-Ticket: ANG-150`, etc.) — completely
         unaffected by the reversal.
      4. **Post-commit's switch flow, typing a real-looking ticket
         (`ANG-151`):** still deferred to
         `.kiro/pending-ticket-check.json` exactly as before —
         regression-free.
      5. **Regression — declining the switch with a blank answer:**
         `current-ticket.json` untouched, no pending file written,
         "No ticket entered — staying on the current ticket." printed
         — confirms declining was never conflated with setting `none`
         as a value, and stays unaffected.
      `bash -n` on both hooks and `json.load` on the hook JSON
      syntax-checked clean after every edit.
- [x] **What could not be tested directly, stated honestly rather than
      assumed:** whether Kiro chat itself, mid-conversation, actually
      refuses a literal "none" reply and re-asks — this is chat-side
      behavior, the same category of untestable-from-this-session thing
      as the MCP validation flow itself (§8). Traced through the logic
      instead of asserting it: "none" no longer matches CASE A1's
      ticket-ID regex, so it's no longer recognized as an answer to the
      pending question at all, and CASE A2's "not an answer, ask again"
      path takes over — consistent with the intended behavior, but a
      real live-chat run (same as the outstanding item from two entries
      up) is still the only way to fully confirm it.

## 2026-08-27 (same day, follow-up): "none" restored as an explicit, active choice — the settled middle ground
- [x] **Why this isn't a third flip-flop for its own sake:** the full
      reversal above fixed a real problem (silent `none`, never an
      active choice) but created a different one — genuinely
      ticket-less work (a quick experiment, a config tweak) had no way
      to be committed at all, honestly labeled or otherwise. The
      correct design was never "permissive" vs. "strict" as a binary —
      it's "something must always be chosen" (mandatory) with `none`
      as one of the legitimate choices (not a silent default). This
      entry is that correction, landed the same day as the reversal it
      corrects.
- [x] **Changed, three places, restoring `none` as an ACTIVE choice
      only — never brought back as a default anywhere:**
      - **`.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`, CASE
        A1:** `'none'` recognized again alongside the ticket-ID regex
        as a valid answer to the pending question. Skips Jira
        validation for it specifically (no claim about a real ticket
        to check), but — this is the key difference from the original,
        too-permissive design — still runs the exact same
        credit-baseline-plus-episode-id command a real validated
        ticket would, and writes `{"ticket_id": "none",
        "credits_at_ticket_start": <real>, "episode_id": <real>}` into
        `current-ticket.json` exactly like a real ticket. No degraded
        `Kiro-Episode: none` / `Kiro-Credits: n/a` stand-in this time —
        `none` gets full, real tracking once chosen.
      - **CASE A2's question**, reworded to state the choice
        explicitly: *"which Jira ticket are you working on (a real
        ticket ID, or explicitly 'none' for work with no ticket)?"* —
        matching the exact phrasing requested.
      - **`.githooks/post-commit`'s switch flow:** the `elif
        [ "$NEW_TICKET" = "none" ]` branch (deleted in the full
        reversal) is back — same real-baseline-write logic as before,
        plus a new, more explicit confirmation line ("Tracked
        explicitly as no-ticket work, not a silent default") so the
        choice reads as deliberate in the terminal output, not a quiet
        default slipping through. The prompt text's `(or 'none')`
        option is restored too.
      - **`.githooks/pre-commit`: no code change**, exactly as
        requested — its empty-check block (`if [ -z "$TICKET_ID" ];
        then ... exit 1`) already does the right thing once `none` is a
        real saved value: `ticket_id` becomes the non-empty string
        `"none"`, so the block never fires for it. Only a comment was
        added explaining why no change was needed, for future readers
        who might otherwise wonder why `none` isn't special-cased here
        too.
      - **`.kiro/steering/aidlc-git-conventions.md`:** the "Ticket
        assignment is mandatory" section rewritten (not appended to
        history-style, since it directly describes the two prior,
        now-both-superseded designs by name) to state the final
        design plainly: something must always be actively chosen; a
        real ticket or `none` both count; only genuinely nothing
        chosen yet blocks anything.
- [x] **Tested for real, 4 scenarios, isolated repo, real pty:**
      1. **Regression — empty ticket, attempt to commit:** still
         blocked, `EXIT=1`, identical message to the full-reversal
         phase — confirms the mandatory-choice half of the policy
         survived this correction unchanged.
      2. **Explicit "none" answer:** ran the *exact* command CASE A1
         specifies (not a fabricated value) — `python3 -c
         "import sqlite3..."` against the real `state.vscdb` — got a
         real credit figure (`258.48`) and a real fresh `episode_id`
         (`ep_6a903eaa79c1c1`), wrote
         `{"ticket_id": "none", "credits_at_ticket_start": 258.48,
         "episode_id": "ep_6a903eaa79c1c1"}` into `current-ticket.json`
         to simulate the chat exchange having happened, then committed
         for real: succeeded, `Kiro-Ticket: none` with the real
         episode and a real (if `0.0000`, since no time had passed)
         credit delta — not the degraded `none`/`n/a` shape from
         before either policy change.
      3. **A real, already-set ticket, then commit:** succeeded
         normally, unaffected by any of this.
      4. **`post-commit`'s switch flow, explicitly typing `none`:**
         accepted with the new confirmation message
         ("✅ Switched to 'none' — new episode ..., baseline ...
         credits. Tracked explicitly as no-ticket work, not a silent
         default."), real baseline/episode written. Confirmed on the
         *next* commit that the switch had actually taken effect
         (`Kiro-Ticket: none`, same episode id persisted). A follow-up
         regression check confirmed a real ticket typed at the same
         prompt immediately after still defers to
         `.kiro/pending-ticket-check.json` exactly as before — restoring
         `none` alongside it didn't disturb the real-ticket path.
      `bash -n` on both hooks and `json.load` on the hook JSON
      syntax-checked clean after every edit.
- [x] **What still can't be tested directly, same honest limitation as
      the reversal it corrects:** the live chat exchange itself — Kiro
      asking, a human answering "none," Kiro recognizing and saving it
      — needs a real Kiro session to exercise, same as the still-open
      MCP-validation item from two entries up. Scenario 2 above
      simulated the *result* of that exchange (the real file write
      CASE A1's instructions specify), not the exchange itself.

## 2026-08-27 (same day, follow-up): full dead-code and cleanup audit across the whole repo
- [x] **Method:** grepped the entire repo (not just the file being
      checked) for every category named in the request, before removing
      anything. Read every hook, both scripts, all three `.kiro/`
      JSON/steering files, and did a targeted sweep of `README.md`,
      `docs/runbook.md`, and `.gitignore` for descriptions of removed
      behavior presented as current (historical mentions with
      "superseded" labels were left alone, per this repo's own
      convention).
- [x] **Checked and confirmed already clean (no removal needed) —
      listed explicitly so "checked" isn't confused with "skipped":**
      - `validate_jira_ticket()` — zero remaining definitions or call
        sites in `.githooks/pre-commit` or `.githooks/post-commit`;
        confirmed already fully removed (across the 2026-08-27 entries
        several sections up), not partially left in one file.
      - `SOURCE="branch_name"` / branch-name-guessing logic — zero
        remaining live references anywhere in `.githooks/` or
        `.kiro/`; only historical comments/decision-log mentions
        remain, all correctly past-tense.
      - The old `.kiro-tracking/*.json`-per-commit accumulation
        pattern — no `git add` of any `.kiro-tracking/*.json` file
        anywhere, no `LOGFILE=` timestamped-filename pattern; only the
        transient `.git/KIRO_COMMIT_DATA` handoff and the one
        overwritten-per-ticket debug file remain, exactly as designed.
      - `EXISTING_PENDING_TICKET` / the null-clobber guard logic in
        `pre-commit` — confirmed fully gone, not dangling; it was
        already correctly removed when the null-flag deferral mechanism
        itself was removed (the "no ticket = none" full reversal), and
        was never reintroduced since "none"'s restored form writes
        `current-ticket.json` immediately rather than deferring through
        `pending-ticket-check.json` at all.
      - `scripts/calculate-pr-credits.sh` and `scripts/coverage-report.sh`
        — read in full; neither references `SOURCE`,
        `source_of_ticket_id`, `branch_name`, or any old file-naming
        pattern. Both operate purely on `Kiro-*` commit trailers or
        plain `git log`, untouched by any of this session's
        ticket-resolution redesigns. Re-ran `calculate-pr-credits.sh`
        against fresh test history after the cleanup — correctly
        aggregated both a real ticket and an explicit `none` as
        separate buckets, no special-casing needed for `none` at all.
- [x] **Found and fixed — real leftover/stale content, not previously
      caught:**
      1. **`.gitignore`'s comment for `.kiro/pending-ticket-check.json`**
         described it as written by "pre-commit's manual-entry fallback,
         or post-commit's ticket-switch prompt" — but pre-commit's
         manual-entry fallback was removed entirely 2026-08-27 (it no
         longer prompts the terminal at all). Fixed to describe only
         the one hook that actually writes this file now
         (`post-commit`).
      2. **`docs/runbook.md`'s embedded `pre-commit` snippet's own
         comment** stated "every commit now requires a real ticket, no
         exceptions" as the current design — this was the "too strict"
         phase, already superseded the same day by the `none`-restoration
         middle ground. Fixed to describe the actual current rule (block
         only when nothing has ever been chosen; `none` is a legitimate
         explicit choice).
      3. **`docs/runbook.md`'s embedded `post-commit` snippet's inline
         comment** claimed `"(or 'none')"` "removed 2026-08-27" — true
         for about an hour, then false again once `none` was restored
         the same day. Fixed the comment and the prompt text itself
         (restored `(or 'none')` in the snippet, matching the real
         file).
      4. **Three build-order-tutorial code blocks in `docs/runbook.md`**
         (`.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`,
         `.githooks/pre-commit`, `.githooks/post-commit`) had drifted
         significantly behind the real files across many same-day fixes
         — missing the `$KIRO_AGENT_COMMIT`/`$KIRO_AGENT_COMMIT_UNCONFIRMED`
         checks, the `/dev/tty`-explicit consent read, the PRIORITY
         CHECK section, the mandatory cloudId lookup, and `none`'s final
         handling, among others (one even still shows
         `CONSENT_VERSION="v1"`, superseded to `v2` days ago). Rather
         than let individual stale phrases keep getting whack-a-mole'd
         turn after turn, added an explicit disclaimer to each block:
         this is a one-time build-order tutorial, not a live mirror —
         read the real file for current logic, don't copy verbatim.
         This is a documentation-honesty fix, not a code removal — the
         blocks themselves were left in place as historical/tutorial
         reference, now correctly labeled as such.
      5. **`.kiro-tracking/.gitkeep`** — removed. Confirmed by grep that
         every single write path to `.kiro-tracking/` (`pre-commit`,
         `post-commit`, `post-checkout`) already calls its own
         `mkdir -p .kiro-tracking` immediately before writing, so the
         directory is always created on demand regardless of whether it
         pre-existed. `.gitkeep`'s only stated purpose (TODO.md, an
         earlier entry: "kept so the directory still exists for
         `mkdir -p .kiro-tracking` to find") doesn't hold up — `mkdir -p`
         creates a missing directory itself, it doesn't need to "find"
         one already there. Zero functional purpose left; a leftover
         from when `.kiro-tracking/*.json` files were meant to be
         committed and visible in a fresh clone.
- [x] **Checked and deliberately NOT removed — flagged instead of
      guessed, per the request's own instruction:**
      - **`.githooks/pre-push`'s disabled SonarQube-gate block
        (lines after the `exit 0`, including its own separate
        `aws s3 cp` upload)** — confirmed this is genuinely still
        sitting there, unreachable, exactly as suspected ("confirm this
        was actually removed, not just still sitting disabled behind
        `exit 0`" — answer: it was NOT removed). **Not removing it**:
        this is categorically different from the other leftover-code
        categories above — it's not dead code from an ABANDONED design,
        it's a deliberately stubbed, NOT-YET-BUILT feature (the
        SonarQube quality gate), explicitly documented in both its own
        comment ("Remove this block to re-enable... don't just delete
        this block quietly") and README §8 ("Blocked on AWS write
        access... Provisioning a real SonarQube host/token"). Deleting
        it would destroy real, wanted scaffolding for a feature this
        project still intends to build. This S3 upload is also a
        separate code path from `pre-commit`'s OWN (ticket-tracking) S3
        upload, which genuinely was removed 2026-08-25 — confirmed the
        two were never the same block, so no earlier claim about "S3
        upload removed" was inaccurate about this one.
      - **`commit-msg`'s `${KIRO_TICKET_ID:-none}` and similar
        `:-none`/`:-n/a` defaults** — these fire only if `pre-commit`'s
        transient `.git/KIRO_COMMIT_DATA` handoff file is missing or a
        field wasn't set, which shouldn't happen on any normal path
        since `pre-commit` always blocks before ever reaching that
        write when there's nothing to write. Kept as defensive
        fallbacks for an abnormal invocation (a crash between steps, a
        hook run out of the usual sequence), not dead code — matches
        the same defensive-fallback pattern used throughout this repo.
      - **Whether Kiro's own Agent Hooks UI, or any Kiro-internal
        mechanism outside this repo, still references the OLD
        `when`/`then`/`promptSubmitted`/`agentAction` hook shape** (the
        made-up schema an earlier draft of
        `aidlc-ask-for-ticket-if-missing.json` used, per
        `docs/runbook.md`'s own note) — **possibly dead, not removing
        without confirmation**: this is Kiro-side, not inspectable from
        this repo. Nothing in this repo references that old shape
        anymore (confirmed by grep), so there's nothing left here to
        remove either way — flagged only in case it matters on the
        Kiro-UI side, which is out of this repo's visibility.
- [x] **Regression tests re-run after cleanup, isolated repo, same 3
      scenarios that matter most:**
      1. Empty ticket → still blocked, `EXIT=1`, same message.
      2. Real ticket (`ANG-170`) → succeeds normally, correct trailers.
      3. Explicit `"none"` (real baseline via the actual CASE A1
         command) → succeeds, `Kiro-Ticket: none` with a real episode
         and credit delta, not a degraded stand-in.
      Plus: `bash -n` on all 5 hooks and both `scripts/*.sh`, and
      `json.load` on all 3 `.kiro/` JSON files — all clean. Re-ran
      `calculate-pr-credits.sh --range` against the fresh test history —
      correctly totaled both `ANG-170` and `none` as separate buckets,
      no special-casing required.

## 2026-08-28: `PreToolUse` code-enforced gate — investigated, reverted; two real bugs found along the way stay open
- [x] **What happened, briefly:** explored replacing CASE B's chat-based
      profile-click question with a code-enforced `PreToolUse` hook
      (verified real trigger/matcher/exit-code semantics against
      `kiro.dev`'s actual docs and a live `kirodotdev/Kiro` GitHub
      issue — confirmed `exit 2` specifically blocks, not any non-zero
      code; confirmed no documented way to see which command triggered
      a firing). Built a throwaway diagnostic hook
      (`aidlc-pretooluse-diagnostic.json` + `.sh`) to empirically
      capture the real event-delivery shape before committing to a
      design — it was never actually fired for real (no
      `PRETOOLUSE_DIAGNOSTIC.log` was ever created) before a live,
      unrelated regression surfaced first (see below) and the whole
      approach was reverted rather than pursued further right now.
- [x] **Reverted cleanly, confirmed by grep across the whole repo, not
      assumed:**
      - Deleted `.kiro/hooks/aidlc-pretooluse-diagnostic.json` and
        `.kiro/hooks/pretooluse-diagnostic.sh` — both untracked, so
        `git status` shows zero trace of either ever having existed.
      - `.kiro-tracking/PRETOOLUSE_DIAGNOSTIC.log` — confirmed it was
        never created in the first place (`ls` → no such file), nothing
        to remove.
      - `.kiro/steering/aidlc-git-conventions.md` — confirmed via
        `git diff HEAD` that the investigation never actually reached
        the point of editing this file (the diagnostic-hook build was
        interrupted by the CASE B regression report below before any
        steering-doc changes for the `PreToolUse` approach were made).
        CASE B's profile-click section reads exactly as it did before
        this investigation started — still the original "ask in chat,
        wait for a real reply, then `KIRO_AGENT_COMMIT=1`" design, still
        with the 3-attempt count-based fallback from the unrelated,
        already-shipped 2026-08-27 work.
      - `grep -rli "pretooluse" .` across the entire repo (excluding
        `.git/`) — zero matches. Fully clean, not just the four files
        named in the revert request.
- [x] **NOT dropped — both real bugs found during the investigation
      stay open, explicitly unrelated to which gate design gets used
      later:**
      1. **`hook-health.log` had ZERO entries for a commit that
         otherwise completed successfully.** Commit `11dcdfd` ("test:
         real ticket should succeed", 2026-08-27T18:13:54Z) is proven
         to have run `pre-commit` to full completion — real trailers
         (`Kiro-Episode: ep_6a907e1405a135`, `Kiro-Credits: 0.7300`,
         etc.) and `.kiro-tracking/ANG-123.json`'s debug-file write
         (timestamped `2026-08-27T18:14:11Z`, matching the commit)
         both prove it. But `.kiro-tracking/hook-health.log` has no
         entry at all for this commit — not even the unconditional
         final `hook_status=ok` line every successful run is supposed
         to append, and not any of the three profile-click-gate branch
         lines (`confirmed-via-chat`, `confirmed-via-chat-unconfirmed`,
         `refresh-prompt-timeout`, `refresh-prompt-skipped-no-tty`).
         Confirmed via `git reflog` that this commit was made directly
         in this working directory, not merged in from elsewhere, so
         this isn't a "wrong local log file" explanation either.
         **This means the audit trail can have silent gaps — not just
         wrong entries, no entry at all** — worth investigating on its
         own regardless of which profile-click gate design (chat-based
         or code-enforced) ends up being used, since both designs write
         to this same log. Not yet root-caused.
      2. **`.kiro/consent-version` disappeared from disk with no known
         cause.** Created in the previous task (single source of truth
         for `CONSENT_VERSION`, replacing three hardcoded copies) and
         confirmed present and correct at the time. Now absent — `ls`
         returns "No such file or directory." Not deleted by this
         session as far as can be determined. `pre-commit`'s own
         fail-open design means a missing file doesn't silently skip
         consent (it forces a re-prompt instead — see the file's own
         comment), but *why* it's gone at all is still unexplained.
      Both are real, open, unresolved — recorded here explicitly so
      they don't get lost just because the `PreToolUse` work that
      surfaced them was reverted.

## 2026-08-28 (same day, follow-up): CASE B's profile-click question skipped TWICE live — steering doc rewritten stronger, testing handed off (not fabricated)
- [x] **The pattern, stated plainly:** the chat-based ask-and-wait
      instruction for the profile-click question was skipped live, not
      once but twice — the second time immediately after the first
      skip had already been investigated and named explicitly as the
      failure mode to avoid. Confirms this is a repeating problem with
      the wording's *strength*, not a one-off misread — a real signal,
      not noise.
- [x] **Rewrote CASE B's profile-click section in
      `aidlc-git-conventions.md`, two added layers, both still
      explicitly behavioral:**
      1. A blockquoted "MANDATORY FIRST STEP, NO EXCEPTIONS" directive,
         explicit about what NOT to do (don't commit, don't set
         `KIRO_AGENT_COMMIT=1`, don't even `git add` in preparation)
         until an actual reply has been received — and explicit that
         "the user asked for a commit" is not the same thing as "the
         user replied to the profile-click question," naming directly
         the reasoning that produced both real skips.
      2. A second, independent layer: before setting
         `KIRO_AGENT_COMMIT=1`, the agent must state *"Confirming: the
         user replied '\<exact quote\>' before I proceed"* in its own
         response — not enforcement (nothing verifies the quote is
         real), but a deterrent that also makes a skip *legible*: a
         skip now either produces a fabricated quote (itself then
         checkable against the real transcript) or an honest
         admission, rather than silently proceeding with nothing to
         point to.
      Added an explicit bridging note so the new "NO EXCEPTIONS"
      wording doesn't read as contradicting the already-shipped
      3-attempt fallback (2026-08-27) — that fallback requires the ask
      to have genuinely happened three times with real (if unclear)
      replies; it is not a license to skip asking in the first place.
      Re-stated the "still behavior-dependent, not code-enforced" limit
      explicitly, tied directly to the two real failures, and named the
      reverted `PreToolUse` investigation as *why* code-enforcement
      isn't the fix being reached for right now (it surfaced two more
      urgent, unrelated bugs first — see the entry above).
- [x] **Testing — handed off honestly, not fabricated or averaged
      away.** The request was to ask Kiro to commit 5 separate times
      across a real session and confirm it asks-and-waits every single
      time, reporting a single skip plainly rather than softening it.
      **This cannot be done from this session:** Claude Code has no
      mechanism to invoke Kiro's own chat agent — the two real skips
      that prompted this whole entry happened in a separate Kiro
      session this one has no access to, the same boundary already
      hit repeatedly (the count-based-fallback test, the PreToolUse
      diagnostic hook). Fabricating "5 attempts, all passed" would be
      exactly the kind of unverified claim this project has
      consistently refused to make all session. Confirmed instead what
      *is* testable from here: the underlying hook-side mechanics
      (`$KIRO_AGENT_COMMIT` correctly skipping the terminal prompt,
      `hook_status=pre-commit-refresh-confirmed-via-chat` logging
      correctly) already re-verified in the previous entry's revert
      testing, unaffected by this wording change (no code was touched,
      only the steering doc). **The actual 5-attempt test needs to be
      run by a human in a real Kiro session** — this is now the correct
      next step, not yet done.

## 2026-08-28 (same day, follow-up): new-episode baseline reads also needed a refresh-first ask — added, testing handed off
- [x] **The gap, stated precisely:** `credits_at_ticket_start` gets
      read straight from `state.vscdb` the moment a new episode starts
      (CASE A1's initial ticket assignment, CASE C1's confirmed
      mid-conversation switch, or a `pending-ticket-check.json` entry
      getting validated and applied) — with no ask-to-refresh first.
      `pre-commit`'s existing ask only covers a single commit's own
      read; a stale *baseline* is worse, since every commit for the
      rest of that episode computes its delta against that one number.
      A stale baseline doesn't cost one wrong number, it costs an
      entire episode's worth of them.
- [x] **Fixed, three separate insertion points in
      `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`, each verified
      unique before patching (same scripted-with-assertions method used
      for every previous hook-JSON edit this session):** CASE A1
      (real-ticket-or-explicit-`none` assignment), CASE C1 (confirmed
      mid-conversation switch), and the PRIORITY CHECK's shape-1
      handling (a `post-commit`-deferred switch, validated and applied
      via chat) — each now says explicitly, right before the
      credit-read command: this establishes a new episode baseline,
      not a single commit's read; ask "Please click your profile icon
      to refresh your credits, then let me know when ready" and wait
      for a real reply *before* running the command; don't treat an
      earlier commit-time ask as already covering this.
- [x] **Documented as symmetric, not a reuse of the same check,** in a
      new steering-doc section right after episode boundaries: two
      separate asks (baseline-establishment vs. per-commit read),
      answering one doesn't answer the other, both can legitimately
      fire close together the first time without being redundant. Same
      "behavioral, not code-enforced" limit stated explicitly, tied
      directly to CASE B's two real skips earlier today as the reason
      not to assume this one is reliable either.
- [x] **Testing — same honest limitation as every other ask in this
      document, stated plainly rather than fabricated:** this cannot be
      tested from this session. Claude Code has no mechanism to invoke
      Kiro's own chat agent to start a real new episode and observe
      whether it asks — the same boundary hit on every previous ask-in-
      chat mechanism this session (the count-based fallback, the
      `PreToolUse` diagnostic, CASE B's rewrite). The request was to
      test at least 3 separate new-episode starts and report a single
      skip plainly, not average it away — that test has not been run.
      **This needs a human, in a real Kiro session, starting a new
      episode at least 3 separate times** (a new branch's ask-ticket
      flow, a confirmed mid-conversation switch, and a validated
      terminal-switch-deferred-to-chat, ideally all three) and reporting
      back whether the ask happened, and whether the captured baseline
      value changed after actually clicking — not yet done.

## 2026-08-28 (same day, follow-up): time tracking added alongside credit tracking — same fixed-baseline/recalculated-delta pattern, real elapsed-time test
Requested: add a second tracked quantity, elapsed time, following the
exact same shape as credits — a fixed value captured once when an
episode starts, and a value recalculated fresh every commit against
that fixed start.

- [x] **`episode_started_at` added everywhere `credits_at_ticket_start`
      already gets written**, at the same instant, from the same
      python process (not a separate `date` call after the fact, so
      both halves of "this episode's starting point" are captured
      together): CASE A1, CASE C1, and the PRIORITY CHECK shape-1
      handling in `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`
      (each command now prints a 3rd line, the ISO 8601 UTC timestamp,
      alongside the existing credits/episode_id lines), and
      `post-commit`'s explicit-"none"-switch branch (same 3-line python
      command, same JSON write). Verified: JSON valid
      (`json.load`/`json.dump` round-trip), and the real embedded
      command extracted and executed directly against the real
      `state.vscdb`, confirming genuine 3-line output
      (`265.49` / `ep_6a9122253251e3` / `2026-08-28T05:52:37Z`).
- [x] **`pre-commit` computes `Kiro-Elapsed-Minutes` fresh every
      commit** — current time minus `episode_started_at`, in minutes,
      via `date -u -d` (GNU date, confirmed already relied on
      elsewhere in this file) parsing the ISO string back to epoch
      seconds, then `awk` for the (non-integer-safe) subtraction, same
      reason `$(( ))` isn't used for `CREDITS_DELTA` either. Falls back
      to the same `"null"`→`"n/a"` convention as credits when
      `episode_started_at` is missing (e.g. a baseline set before this
      field existed) — not treated as an error.
- [x] **`commit-msg` adds two new trailers**, `Kiro-Episode-Started`
      (the fixed value, `none` fallback) and `Kiro-Elapsed-Minutes`
      (the recalculated value, `n/a` fallback) — same defaulting
      pattern as the existing six trailers, verified `bash -n` clean.
- [x] **`scripts/calculate-pr-credits.sh` now reports both totals per
      ticket**, using the identical max-per-episode-then-sum logic for
      elapsed minutes as for credits — deliberately NOT filtered the
      same way: a commit with a valid `Kiro-Credits` but no
      `Kiro-Elapsed-Minutes` at all (any commit that predates this
      feature) still counts fully toward the credits total; only its
      own contribution to the elapsed total is skipped. A ticket with
      zero commits carrying real elapsed data reports `n/a` minutes,
      not a misleading `0.00`, distinguished in the `awk` aggregation
      via an explicit presence flag rather than trusting a bare `>0`
      check on the value itself.
- [x] **Documented as symmetric with credits, not a separate
      mechanism**, in the steering doc: the existing "Commit message
      trailer format" block now lists all eight trailers, a new
      paragraph directly under it ties `Kiro-Episode-Started`/
      `Kiro-Elapsed-Minutes` explicitly back to
      `Kiro-Episode`/`Kiro-Credits`, and a new "Time tracking rule"
      section mirrors "Credit calculation rule" line for line (max per
      episode, then sum per ticket, same reason raw-summing
      double-counts).
- [x] **Tested for real, in an isolated scratch repo, against this
      repo's real hooks and real `state.vscdb`** (not claimed —
      real values, both commits, shown below):
      - Baseline written with a real, live-captured timestamp:
        `episode_started_at = 2026-08-28T05:59:04Z`,
        `credits_at_ticket_start = 265.49`.
      - First commit, made 7 real seconds later
        (`date -u` confirmed `2026-08-28T05:59:11Z` at commit time):
        `Kiro-Elapsed-Minutes: 0.12` — matches 7s/60 = 0.1167 → 0.12
        to 2 decimals, exactly.
      - Second commit, made at `2026-08-28T06:03:10Z` (real `date -u`
        reading at commit time) — 4 real minutes 6 real seconds after
        the baseline, spent genuinely writing this TODO.md entry and
        the README/steering-doc/runbook updates for this same feature,
        not simulated or backdated:
        `Kiro-Elapsed-Minutes: 4.10` — matches 246s/60 = 4.10 exactly,
        correctly increased from the first commit's `0.12`.
      - `scripts/calculate-pr-credits.sh --range HEAD` against these
        two commits (same episode): `TIME-1: 0.0000 credits, 4.10
        minutes` — correctly the **max** within the episode (`4.10`),
        not a double-counted sum (`0.12 + 4.10 = 4.22`, which it is
        NOT).
      - **Sum-across-episodes also verified for real**, mirroring the
        credits worked example in `README.md` §4: a third commit on
        the same ticket under a fresh episode
        (`episode_started_at` deliberately backdated 2 minutes exactly,
        via `date -u -d "-2 minutes"`, to get a clean, known second
        number) produced `Kiro-Elapsed-Minutes: 2.02`. Re-running the
        aggregation script across all three commits gave
        `TIME-1: 0.0000 credits, 6.12 minutes` — exactly
        `4.10 (episode 1's max) + 2.02 (episode 2's max) = 6.12`,
        confirming max-per-episode-then-sum works correctly for
        elapsed time, not just credits.
      - Arithmetic separately sanity-checked in isolation against a
        known, deliberately backdated 5-minute-30-second-past
        timestamp (`date -u -d "-5 minutes -30 seconds"`): computed
        `5.50`, exactly as expected.
      - **Backward compatibility confirmed against this repo's own
        real, pre-existing commit history** (not just the scratch
        repo): running the updated `calculate-pr-credits.sh` against
        this repo's actual `HEAD` (commits made before this feature
        existed, no `Kiro-Elapsed-Minutes` trailer at all) correctly
        reported `n/a minutes` for every one of them
        (`ANG-123`, `ANG-124`, `none`, `TEST-000`, etc.) while their
        credits totals were completely unaffected — proving the
        elapsed-time filter really is independent from the credits
        filter, not just documented as such.

## 2026-08-28 (same day, follow-up): SonarQube MCP Server connection added — config entry written, live testing blocked on real gaps, not skipped silently
Requested: connect Kiro to SonarQube via the official MCP Server,
using a real token once available (explicit instruction: do not
proceed with a placeholder/fake value), test it live for a real
project's quality gate status, and test again specifically for
ANG-4571 on its own branch/commit. Document plainly that this is
read-only status-checking, not PR-blocking enforcement.

- [x] **Checked the real docs before writing anything, not assumed.**
      `mcp.sonarqube.com/config-generator.html` only renders its actual
      JSON client-side (a static fetch can't drive it), so went to the
      real GitHub README
      (github.com/SonarSource/sonarqube-mcp-server) instead and
      confirmed the exact config shape directly: a local-process
      server via `command`/`args` (Docker, or a local Java JAR), NOT a
      bare `url` — a real, useful finding, since `docs/runbook.md`'s
      pre-existing aspirational sketch of this entry showed a
      fictional `"url": "https://your-sonarqube-host/mcp"` shape that
      the real server doesn't actually support at all. Also confirmed
      the real primary tool name for a quality-gate check:
      `get_project_quality_gate_status` (plus `list_quality_gates`),
      not a guessed name.
- [x] **Docker checked directly — not available.** `docker --version`
      → `command not found`. Per the task's own instruction, checked
      the documented alternative next instead of stopping there: a
      standalone JAR launched via `java -jar`, requiring Java 21+.
      **Also checked directly — also not available:** `java -version`
      → `command not found`. **Neither of the two documented runtimes
      for this server exists on this machine right now** — a real,
      independent blocker on top of the missing token, not a
      consequence of it. Flagging this plainly rather than writing an
      entry that looks ready to use but silently can't run.
- [x] **`.kiro/settings/mcp.json`'s `sonarqube` entry added**,
      alongside `atlassian-rovo`, using the Docker-based config (the
      literal shape given in the request, and the server's own
      documented default) — `SONARQUBE_URL` is the real value given
      (`https://sonarqube-alcs-saas.teamlease.com`), not a placeholder.
      `SONARQUBE_TOKEN` is left as an explicit, obviously-fake
      sentinel, `REPLACE_WITH_REAL_SONARQUBE_USER_TOKEN` — matching
      this repo's existing convention for a known-missing value
      (`pre-push`'s `YOUR_PROJECT`/`your-sonarqube-host`), never a
      value dressed up as real, per the explicit instruction. JSON
      validated (`json.load`).
- [x] **Entry written with `"disabled": true`.** Given neither runtime
      exists on this machine and no real token exists either, an
      enabled entry would just fail the moment Kiro tried to launch it
      — disabling it is the accurate state, not an unrequested scope
      cut. Flip to `disabled: false` once BOTH a real token is set AND
      one of the two runtimes (Docker, or Java 21+ for the JAR
      alternative) is installed — either alone is not enough.
- [x] **`autoApprove` scoped narrowly**, `get_project_quality_gate_status`
      and `list_quality_gates` only, out of 70+ tools the real server
      exposes (confirmed via the README, not guessed) — matches item
      4/5's "read-only check, not enforcement" framing: every other
      tool (code analysis, issue mutation, admin/webhook tools) still
      needs explicit per-call approval.
- [x] **Documentation updated in three places, all describing the same
      real state, not three different claims:** `docs/runbook.md`'s
      `.kiro/settings/mcp.json` write-up was rewritten to match the
      real file (fixing the stale fictional entry noted above) and to
      state the read-only-not-enforcement distinction and both real
      blockers explicitly; `README.md` gained a new §6 limitations row
      distinct from the pre-existing CLI-based `pre-push` SonarQube
      row (these are two separate mechanisms, not the same gap
      restated), a new §7 decision entry with the full record, and §5
      and §8 updates reflecting the real host being provided already
      and exactly what's still needed (token + a runtime, both
      required, neither sufficient alone).
- [ ] **NOT done — stated plainly, not glossed over: no real quality
      gate status has actually been retrieved through this connection
      yet.** Two compounding reasons, not one: (1) the connection
      cannot run at all yet — no real token, no installed runtime;
      (2) even once both of those are fixed, asking Kiro "what's the
      quality gate status for [project]?" in chat, and the ANG-4571
      branch/commit variant of the same test, both require a live Kiro
      chat turn — the same capability gap noted repeatedly throughout
      this whole session (CASE B's live testing, the baseline-refresh
      ask's live testing, the pending-ticket-check chat-side
      validation). **This needs a human, in a real Kiro session, once
      a real `SONARQUBE_TOKEN` is provided and Docker or Java 21+ is
      installed**, to: (a) flip `disabled` to `false`, (b) ask the
      quality-gate question for a real project key and confirm a real
      pass/fail comes back (not an error), (c) create a branch for
      ANG-4571, commit, and confirm the same question resolves for
      that project through this same connection. None of that has
      happened — reporting it as not done, not as done-with-caveats.

## 2026-08-31: CASE C had no fuzzy-match rule of its own — an already-tracked ticket got silently re-baselined, ask-and-wait skipped
Found by a human manually running a real Kiro session against
`aidlc-ask-for-ticket-if-missing.json` (`ANG-4571` tracked → typed
`amd-12` fuzzy-matching a fake ticket → declined via a failed Jira
validation → retyped `ANG-4571`, the SAME ticket already tracked).
- [x] **The observed symptom:** the profile-click ask ("Please click
      your profile icon to refresh your credits, then let me know
      when ready") was skipped entirely on the final turn — the agent
      went straight from reading `current-ticket.json` to running the
      credit-read command to writing a brand new `episode_id` and
      `credits_at_ticket_start`, for a ticket that had never actually
      been unset. This is the same class of skip fixed twice already
      (see the two 2026-08-28 entries above), but neither of those
      fixes touched this path, because the real cause here isn't
      weak wording on the ask itself.
- [x] **Root cause, traced precisely:** CASE C2 (the mid-session
      switch-detection check) only ever defined an EXACT regex match
      (`^[A-Z][A-Z0-9]*-[0-9]+$`) for recognizing a mentioned ticket.
      CASE A1 has an explicit fuzzy-match rule (added 2026-08-27) for
      exactly this kind of input; CASE C2 never got the same
      treatment. `amd-12` (lowercase) hit that gap — the agent had no
      rule to follow, so it improvised, answering with (A1)'s "Did you
      mean AMD-12?" phrasing without doing either case's real
      bookkeeping (never wrote `pending_switch_to`). With no marker
      written, the next turn had nothing to bind to — (C1) never
      fired, and the retyped `ANG-4571` fell through to ad hoc
      behavior that treated it as a fresh baseline-worthy event,
      skipping the ask in the process.
- [x] **Fixed in `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`,
      CASE C2, two layers, both closing the actual gap rather than
      re-wording the ask that was never reached this way before:**
      1. CASE C2 now explicitly normalizes the message itself
         (whitespace/case, same as A1) when the exact regex doesn't
         match — spelling out that the fastpath command hook does
         NOT do this for CASE C (it exits untouched whenever
         `ticket_id` is already set — see
         `scripts/ticket-gate-fastpath.sh`), so this can't be silently
         assumed to be handled upstream.
      2. Before treating any candidate (exact or normalized) as a
         switch, CASE C2 now checks whether it exactly equals the
         `ticket_id` already saved — if so, it's not a switch at all,
         just a re-statement of the current ticket. No
         `pending_switch_to` write, no switch-confirmation question,
         no baseline/episode re-capture, no ask. This is the guard
         that actually closes the bug: however a same-ticket mention
         gets recognized (typo-fuzzy detour or not), it can no longer
         fall through into baseline-capture territory at all.
- [x] **Testing — same honest limitation as every other chat-side ask
      in this document:** this fix is a prompt-text change to an
      agent-type hook; it cannot be exercised from this session
      (Claude Code has no mechanism to invoke Kiro's own chat agent).
      The bug itself, however, unlike the two 2026-08-28 entries, WAS
      independently confirmed live by a human before this fix was
      written — not inferred. **Still needs a human, in a real Kiro
      session, to re-run the same sequence** (track a real ticket,
      attempt a switch to a ticket that fails Jira validation, then
      retype the original already-tracked ticket) and confirm the ask
      is no longer skipped — not yet done.

## 2026-08-31 (same day, follow-up): process narration leaking into the visible chat response outside the A2 question — general guard added
Found the same session, on a different real turn: while processing a
real CASE A1 ticket validation (`ANG-4571`), the visible chat response
included lines like "This is CASE A1...", "Priority check file
doesn't exist, so I skip to CASE A1 processing", and "Got the
cloudId... Now I need to validate ANG-4571" — a step-by-step narration
of the agent's own internal branching and tool-call plan, shown to the
user as if it were the answer.
- [x] **Not a new problem, an old one recurring somewhere the existing
      fix didn't reach.** The HARD GATE paragraph already forbids
      exactly this kind of narration — but only for the A2 branch
      (the bare ticket question). It never said the same thing for
      A1's Jira-validation processing, C1/C2, or the PRIORITY CHECK,
      so nothing stopped it from showing up there too.
- [x] **Fixed:** added a new top-level "NARRATION GUARD" paragraph to
      `.kiro/hooks/aidlc-ask-for-ticket-if-missing.json`, same
      standing as HARD GATE and COST GUARD (applies on every message,
      every case) — no play-by-play of which branch/tool/file is
      about to run; the visible response should only ever be what the
      user actually needs (the question, a validation result, the
      profile-icon ask, the final confirmation, or the real answer).
- [x] **Same live session, more evidence — the leak wasn't confined to
      the validation step.** The rest of that same CASE A1
      walkthrough (the same human, continuing the same test) showed
      identical narration at every remaining step: resuming once the
      user confirmed the profile-icon refresh ("The user has
      confirmed they're ready. Now I need to read the credits..."),
      after running the baseline command ("Got the baseline: ..."),
      before the `current-ticket.json` write ("Now I'll write..."),
      and before deleting the marker file ("Now I need to delete the
      marker file"). Strengthened the NARRATION GUARD paragraph with
      these exact phrases as additional named examples, so the rule
      reads as covering the whole flow end-to-end — not just
      branch-selection at the start — matching the pattern already
      used for CASE B's profile-click ask (generic wording alone
      wasn't enough there either; specific named failure phrases were
      what actually closed it).
- [x] **Testing — same limitation as every other prompt-wording fix in
      this document:** cannot be exercised from this session. Both
      rounds of this bug were independently confirmed live by a
      human, not inferred. **Still needs a human, in a real Kiro
      session, to re-run a full CASE A1 walkthrough end-to-end and
      confirm no process narration appears at any step** — not yet
      done.

## 2026-08-31 (same day, follow-up): credit-cost investigation for the ticket-tracking hooks — one fix shipped and verified, one ruled out with evidence, one blocked, one real alternative proposed (not implemented)
Requested: after a real ticket-switch (via `aidlc-ask-for-ticket-if-missing.json`)
cost ~2.06 credits across three forced turns, reduce that cost. Four
options were scoped: **#1** skip the ticket-flow hook's work via a
command-hook block when no ticket is mentioned; **#2** validate Jira
existence via a direct REST call, bypassing the `atlassian-rovo` MCP
connection; **#3** move credit-baseline capture from chat-time to
first-commit time; **#4** stop re-fetching the Jira cloudId within a
conversation that already has it.
- [x] **#4 shipped in `aidlc-ask-for-ticket-if-missing.json` (CASE A1
      and C1 now reuse a cloudId already confirmed earlier in the same
      conversation instead of re-calling
      `getAccessibleAtlassianResources`) — and VERIFIED LIVE, not just
      implemented, same standard as every other "tested live" entry in
      this file.** Real transcript, two validations in one
      conversation: (1) `none` — no Jira call needed, 0.47 credits;
      (2) `ANG-123` — Kiro explicitly stated *"I already have the
      cloudId from earlier: 95d1d0d9-87db-4e3a-964d-a485e6e75c4c"* and
      went straight to `getJiraIssue`, no
      `getAccessibleAtlassianResources` call. 1.03 credits (higher
      than the first turn because this one did real validation +
      baseline capture — not a like-for-like comparison — but the
      absence of the redundant resource-discovery call is the actual
      thing being verified here, and it's confirmed absent).
- [x] **#2 checked and ruled out as a real blocker, not a "should
      work" assumption — confirmed without needing a live Kiro
      session at all.** `.kiro/settings/mcp.json`'s `atlassian-rovo`
      entry (what chat actually uses) is a hosted OAuth endpoint
      (`https://mcp.atlassian.com/v1/mcp/authv2`) with no
      `JIRA_BASE_URL`/`EMAIL`/`API_TOKEN` fields at all — that's not
      how it authenticates. Those specific env vars are independently
      confirmed absent everywhere checked: this shell's environment,
      `~/.bashrc`/`~/.profile`/`~/.zshrc`, and the systemd user
      environment — matching `.githooks/post-commit`'s own comment
      from the 2026-08-27 revert of this exact idea in the git-hook
      context: *"provisioned nowhere in this repo, confirmed by
      checking the environment directly."* Not building a REST
      validator around credentials that don't exist. Dropped.
- [x] **#1 as originally scoped is architecturally impossible — ruled
      out via Kiro's own documentation, not a live-test result.**
      Fetched `kiro.dev/docs/hooks/actions/`: for the Prompt Submit
      trigger specifically, an Agent Prompt hook's text is *"appended
      to the user prompt, and the combined prompt is sent to the
      agent"* as ONE request — there is no separate sibling agent-hook
      turn for a command hook to suppress in the first place. A
      command hook's only lever on this trigger is `exit 2` (full
      block, confirmed by the same docs: *"message submissions are
      blocked"*) — correct for CASE A2 (nothing else to say) but wrong
      for CASE C2's "proceed normally" case, where blocking would
      swallow the user's real request instead of answering it. Ruled
      out as scoped; no code changed for this one.
- [ ] **Real alternative for #1 proposed, not implemented — see
      `docs/hook-dispatcher-proposal.md`.** The actual cost driver is
      that the full ~30KB instruction block gets appended to every
      single message once a ticket is tracked, regardless of whether
      that turn needs any of it (confirmed by the same docs quote
      above). Proposed fix: split the hook into a short always-inline
      dispatcher plus an on-demand detail file
      (`.kiro/hooks/ticket-flow-details.md`) read only when the
      dispatcher's triage decides ticket-handling work is actually
      needed. Deliberately NOT implemented yet — it introduces a new
      *silent* failure mode (the model judges a turn as "nothing
      needed" and skips reading the details file when it actually
      should have), which needs an explicit adversarial live test
      before shipping, not just a plausible design. See the proposal
      doc for the full design, the test cases, and the rollback plan.
- [ ] **#3 still held, unchanged from the prior entry** — needs real
      usage-gap numbers (ticket-selection-to-first-commit timing
      across a few real sessions) before it's a decision made with
      evidence, not just cost savings. Not touched this round.

## 2026-08-31 (same day, follow-up): dispatcher/detail-file split (docs/hook-dispatcher-proposal.md) implemented, tested live, FAILED, rolled back
- [x] **Implemented as designed:** `aidlc-ask-for-ticket-if-missing.json`
      shrunk from ~30.7KB inline to a ~2.2KB dispatcher prompt; the full
      original procedure moved unchanged to a new
      `.kiro/hooks/ticket-flow-details.md`, read via a tool call only
      when the dispatcher's triage judged it necessary. Pre-split
      content backed up per the proposal's rollback plan before
      touching anything.
- [ ] **Live-tested — FAILED, real regression, not a subtle miss.**
      A human ran this in a real Kiro session (`ANG-4571` tracking
      flow, the exact same flow priced at ~1.05 credits across two
      turns pre-split earlier this session). Post-split: turn 1
      (`ANG-4571`) hit **"the agent context limit"** mid-turn and got
      auto-summarized by Kiro itself (0.4 credits, incomplete); turn 2
      (`done`, continuing the same flow) cost **1.28 credits** on its
      own. Total for one ticket-tracking flow: **~1.68 credits, higher
      than the ~1.05 pre-split baseline for the same flow** — the
      opposite of the intended effect. Directly reported by the human:
      *"its getting more now than previous one."*
- [x] **A likely mechanism, not fully isolated:** reading the ~30KB
      detail file via a tool call is not free the way inline prompt
      text was — the tool-call overhead itself, plus the agent
      apparently adopting Kiro's own multi-step Task List
      tool to track the now-file-delivered procedure (one turn alone
      showed 14 tool calls, most of them Task List updates), plus the
      cost of the mid-turn auto-summarization event, likely compound
      to something worse than the original flat ~30KB-inline cost.
      This was a real possibility the proposal didn't weight heavily
      enough — "roughly the same cost for turns that need the detail
      file" turned out to be optimistic, not measured.
- [x] **Also confirmed live, independent of the cost regression:** the
      NARRATION GUARD violation recurred in BOTH post-split turns
      ("Understood. Let me check the current state..." and "User
      confirmed ready. Now reading the credit baseline..."), right
      after the context-limit summarization event — supporting (not
      proving) the theory that Kiro's own auto-summarization is lossy
      against behavioral rules like this one, independent of the
      split itself.
- [x] **Rolled back immediately per the proposal's own pass bar** ("any
      single failure blocks shipping" — this wasn't even a narrow
      miss). `aidlc-ask-for-ticket-if-missing.json` restored verbatim
      from the pre-split backup; `ticket-flow-details.md` and the
      `.bak` deleted. Repo is back to the exact pre-split state.
      **Conclusion: the dispatcher/detail-file split, as designed, is
      not a viable cost fix — do not re-attempt this exact approach
      without first understanding the tool-call/Task-list overhead
      mechanism above, not just re-shrinking the inline text.**

## 2026-08-31 (same day, follow-up): two new cost ideas investigated and proposed — not implemented
Requested after the dispatcher-split failure: two new approaches,
proposal-only, same discipline as that failed attempt — investigate
feasibility against real Kiro behavior first, don't build on
assumptions.
- [ ] **Idea 1 — local Jira validation cache, see
      `docs/validation-cache-proposal.md`.** A ticket only needs
      existence-validating once; cache the result
      (`.kiro/validated-tickets.json`) and skip the
      `getAccessibleAtlassianResources`/`getJiraIssue` calls on a
      cache hit via the same proven command-hook
      stdout-to-agent-context mechanism already used for
      `FUZZY_TICKET_MATCH`. Correctly scoped as saving the two Jira
      tool calls within a turn that still happens, not the whole
      turn — confirmed via the same docs quote that closed out the
      dispatcher-split (`Prompt Submit` always appends the hook's
      prompt into one combined request). Estimated real savings,
      from this session's own transcripts: ~0.3–0.6 credits per cache
      hit. Not implemented; needs the live test plan in the proposal
      doc first.
- [ ] **Idea 2 — shrink chat's job to validation only, see
      `docs/chat-validation-only-proposal.md`.** Confirmed the
      underlying mechanism already works in production today —
      `post-commit`'s `"none"` switch path already captures a full
      credit baseline and writes `current-ticket.json` from a
      terminal git hook, zero agent cost, using the same
      `python3`/`sqlite3` snippet used everywhere. **Important finding:
      as literally scoped (pickup via a git hook), this reintroduces
      #3's exact open question** — baseline timing shifts from
      ticket-selection time to next-commit time — and should not be
      built under a different name while #3 itself is on hold for
      evidence. Proposed a stronger alternative instead: do the
      pickup in the command hook (`ticket-gate-fastpath.sh`) on the
      very next chat message rather than waiting for a commit,
      preserving today's baseline-timing meaning while still moving
      the ask/wait/capture/write sequence to zero-cost territory.
      Combined with Idea 1, estimated to cut a full switch from
      ~2.06 credits to roughly ~0.7 (cache miss) or near-zero (cache
      hit). Not implemented; the multi-step marker handoff is a new
      mechanical pattern (even though every individual piece is
      separately proven elsewhere) and needs the live test plan in
      the proposal doc, particularly the interrupted-flow/stuck-marker
      case, before it ships.
- [x] **Both proposals explicitly flag their failure modes and a live
      test plan up front, learning directly from the dispatcher-split
      miss** — no implementation happens until a human runs those
      tests in a real Kiro session and reports real numbers back, same
      standard as everything else in this file.

## 2026-09-01: Idea 1 (validation cache) built, live-tested twice, FAILED both times on a correctness regression, rolled back
Approved and built per `docs/validation-cache-proposal.md`: a cache
file (`.kiro/validated-tickets.json`), a read-side check added to
`scripts/ticket-gate-fastpath.sh`, and write/skip instructions added
to CASE A1/C1 of `aidlc-ask-for-ticket-if-missing.json`.
- [ ] **Live test round 1 — FAILED. A ticket (`ANG-4571`) was accepted
      as validated with ZERO `getAccessibleAtlassianResources`/
      `getJiraIssue` calls in the transcript, and the profile-icon
      refresh-ask never appeared before baseline capture.** Root cause
      investigation found the cache file's entries were timestamped a
      full day before the caching code existed — meaning whatever
      wrote them did not read a real clock. Traced to the exact class
      of bug this project already learned to avoid once (the
      credits-baseline read): the write instruction said "use the
      current UTC timestamp" as free text, with no bundled
      deterministic command, so the model could — and did — write a
      stale value instead of actually checking the time. Two fixes
      applied: (1) bundled a real `date -u +%Y-%m-%dT%H:%M:%SZ` call
      into both write points, replacing the free-text instruction
      entirely; (2) rewrote the cache-hit skip instruction to
      explicitly scope it to ONLY the two Jira tool calls, stating in
      the same sentence that the refresh-ask is a separate requirement
      unaffected by a cache hit. Cache wiped before retesting so no
      pre-fix entry could contaminate the result.
- [ ] **Live test round 2 — FAILED AGAIN, more seriously.** Switching
      to `ANG-123` with the cache file confirmed genuinely absent
      (checked directly, not assumed) still produced zero Jira tool
      calls. This is strictly worse evidence than round 1: with no
      cache file, `ticket-gate-fastpath.sh`'s cache block cannot fire
      at all (confirmed by its own gate, `[ -f "$CACHE_FILE" ]`, and
      by the 6 local dry-run tests already run against it) — so
      **the skip did not come from the caching mechanism's read path
      this time.** Leading hypothesis, not fully confirmed: `ANG-123`
      had already been validated many times earlier in this same very
      long conversation, and the model may be skipping the Jira call
      based on that accumulated context rather than any instruction
      this feature added — a shortcut the ORIGINAL (pre-Idea-1)
      instructions never explicitly forbid either. If true, this
      feature's cache-check language may have made an existing latent
      risk worse simply by introducing the general idea that skipping
      Jira validation is sometimes correct, independent of whether a
      qualifying note ever actually fired.
- [x] **Cost, quantified plainly (asked for directly, not glossed
      over): 1.53 credits for round 2's turn vs. an 0.88-credit
      reference for a real fresh validation — 0.65 credits MORE, for
      ZERO Jira tool calls.** This session's own earlier evidence puts
      a real Jira validation's tool-call cost at roughly 0.5–0.6
      credits above a no-tool-call baseline — meaning the extra spend
      here is in the same range as what a real validation would have
      cost, but bought no validation at all. Worse than "no benefit for
      the cost": net negative on both cost and correctness
      simultaneously.
- [x] **Rolled back completely, verified at every layer, not just
      reverted-and-assumed-clean:** `aidlc-ask-for-ticket-if-missing.json`
      restored to the exact pre-Idea-1 text (byte-length verified:
      29,811 chars, matching the length recorded right after #4's fix);
      `scripts/ticket-gate-fastpath.sh` and `.gitignore` both confirmed
      zero-diff against git's tracked baseline; `.kiro/validated-tickets.json`
      deleted; the original 6 local regression scenarios re-run against
      the reverted script with `ticket_id` genuinely empty and all
      matched pre-Idea-1 behavior exactly.
- [ ] **Open, unresolved, and more important than the cost question
      this whole investigation started from: does the ORIGINAL
      (pre-Idea-1) instruction set have this same skip-on-saturated-context
      risk, independent of anything built here?** Not established
      either way — round 2's failure happening with the caching
      mechanism structurally incapable of firing is suggestive but not
      proof the base instructions are equally vulnerable outside a very
      long, single-ticket-saturated conversation. Needs testing in a
      **fresh, short Kiro session** validating a ticket that session has
      never seen before, to see whether the skip reproduces without
      hours of accumulated context to lean on. Not yet done — flagging
      this as the real open risk, not closing it out under the
      cost-optimization heading it started under.

## 2026-09-01: cost-reduction investigation CLOSED for now — current cost is the real floor for this design, confirmed two independent ways
This is a conclusion, not another attempt — deliberately its own entry
rather than buried under the dispatcher-split or validation-cache
write-ups above, since it settles the question those two attempts kept
re-opening.
- [x] **The safe space for further reduction is empty, given tonight's
      constraint.** Cost work is off-limits anywhere it would touch
      validation logic (the Jira existence checks, any skip/cache
      condition) or the file-based state machine (any new marker file,
      any new state transition) — both categories already produced a
      real correctness regression tonight (Idea 1's validation cache,
      twice) or a real cost regression (the dispatcher/detail-file
      split). Nothing safe is left to try within those boundaries.
- [x] **The actual cost driver — context size and procedural work per
      turn, not tool-call type — was confirmed twice, independently,
      not asserted once and assumed:**
      1. The dispatcher-split investigation confirmed architecturally
         (via kiro.dev's own docs) that the full ~30KB instruction
         block is appended into ONE combined request on every
         `Prompt Submit` turn, regardless of branch — so a turn's cost
         floor is set by how much of that context it has to reason
         through, not by which specific tools it happens to call.
      2. Tonight's file-vs-MCP cost comparison confirmed the same
         thing empirically, from real transcript numbers: a turn with
         zero MCP calls (pure local file I/O plus one command) cost
         0.43 credits; a turn with two real Jira MCP round-trips cost
         0.62 — an 0.19-credit gap, upper-bound, not cleanly isolated.
         Meanwhile the jump from a zero-tool-call turn (0.07–0.10) to
         ANY turn doing real procedural work (0.43+) happens before
         tool-call type is even relevant. Splitting one unit of work
         across two turns (0.62 + 0.43 = 1.05) versus combining it into
         one (1.03) produced the same total either way — consistent
         with cost tracking total work done, not turn count or tool
         mix.
      3. **Local file writes specifically (marker files included) are
         confirmed NOT a meaningful cost center** — the numbers above
         rule this out directly, not by assumption. Stop looking there.
- [x] **Conclusion, stated plainly: current cost is close to the real
      floor for this design.** No further reduction is available
      without either (a) changing what the feature actually does —
      touching validation logic or the state machine, both already
      shown risky tonight (one correctness failure, one cost
      regression) — or (b) accepting the current cost as the real
      price of running a ticket-tracking procedure this
      context-heavy, on this trigger, in this architecture. This
      investigation is closed for tonight on that conclusion — not
      abandoned mid-thread, not left as a vague "explore more later."

## 2026-09-01: fresh-session grounding bug confirmed reproducible — a reliability ceiling, not a patchable bug; full audit of prior "confirmed live" claims; structural fix proposed
Found via a clean repro (state confirmed empty of leftover markers
before each run, not assumed): a genuinely fresh Kiro session's first
message, mentioning a different real ticket while one is already
tracked, does not reliably trigger CASE C2's switch question.
- [ ] **Two clean runs, zero fully-correct outcomes:**
      1. `BENEFITAPP-26` as the first message, `ANG-123` already
         tracked: `Read File current-ticket.json` DID happen (visible
         tool call, ruling out "skipped the read" as the mechanism) —
         and the response was still the bare CASE A2 empty-state
         question, ignoring the file's actual (non-empty) content.
      2. `ANG-4571` as the first message, same setup: response was the
         correct CASE C2 question — but `pending_switch_to` was never
         written to `current-ticket.json`, which CASE C2's own
         procedure requires writing BEFORE asking. A confirming reply
         on the next turn would have found nothing pending and
         silently dropped the switch — the exact regression already
         documented once before (2026-08-31, "the write got skipped...
         instead re-ran C2 from scratch as if nothing had been asked")
         and evidently not durably fixed by whatever wording addressed
         it then.
      **Verdict, per direct instruction: do not attempt another
      wording tweak.** This is now the fourth confirmed instance
      tonight of the agent skipping a specific required step (a Jira
      validation call, a real clock read for a timestamp, a mandated
      file read before branching, a mandated file write before asking)
      while still producing a plausible-looking response around the
      gap — a reliability ceiling of prose-instruction-driven
      bookkeeping, not an isolated bug.
- [x] **Full audit of every prior "confirmed live"/"tested live" claim
      in this file (29 matches), checking whether each verified actual
      file state or only transcript/response text — requested directly
      because two of the runs above only surfaced their defects when
      the file was checked, not from the transcript alone.**
      - **Every git-hook-level claim (`pre-commit`/`post-commit`/
        `commit-msg`, dozens of entries across this file) explicitly
        checked file state** — byte-identical diffs on
        `current-ticket.json`, exact trailer values quoted,
        `pending-ticket-check.json` content verified,
        `hook-health.log` lines checked. Zero false passes found in
        this half of the system's history.
      - **Exactly two chat/agent-hook claims verified transcript
        content only, never file state** — both about the original
        Jira-validation feature (2026-08-26): the `ANG-999999` test
        ("Item 1... confirmed live") and the `ANG-888888` cloudId
        retest, both judged by what Kiro's response/tool-call sequence
        said, not by reading `current-ticket.json` afterward. Worth
        re-verifying, treated as suspect rather than urgent since nothing about that specific mechanism has changed since.
      - **Every other chat-side claim already honestly marked
        unverified, not a hidden false positive** — CASE B's
        profile-click question (two real documented skips, further
        testing explicitly "handed off... not yet done"), the
        new-episode baseline refresh-ask ("cannot be tested from this
        session... not yet done"), the PRIORITY CHECK section ("NOT
        tested... flagged explicitly rather than assumed passing").
        Good discipline already in place; these just never got
        followed up.
      - **The real finding is the asymmetry, not a backlog of false
        passes:** the deterministic (git-hook) half of this system has
        a perfect verification record because its test method (read
        the file) is reliable; the agent-driven half's test method
        (trust the transcript) was never reliable to begin with — this
        is the same asymmetry the two clean repro runs above just
        demonstrated directly.
- [ ] **Structural fix proposed, not built — see
      `docs/deterministic-bookkeeping-proposal.md`.** Recommends moving
      mechanical bookkeeping (reading `current-ticket.json`'s actual
      value into context, writing `pending_switch_to`, capturing and
      writing the credit baseline) into deterministic command-hook code
      — the same pattern already proven reliable all night — while
      keeping genuine judgment calls (is this ticket real, does this
      message really mean a switch) in the agent. This is a design
      decision, not a hotfix; the proposal doc has the concrete plan
      and a live test plan, nothing implemented yet.

## 2026-09-01 (same day, follow-up): Option A built (A1 + A2), A2 FAILED its first live test — wrong failure mode targeted, real design lesson
- [x] **A1 and A2 implemented exactly as proposed, every embedded
      command individually executed for real against real
      `state.vscdb`/sandbox files before any live test** (all 5 bundled
      write/removal commands ran correctly, produced valid JSON, real
      credit/episode/timestamp values — not just syntax-checked). One
      real bug caught and fixed during this: the `pending_switch_to`
      write command's placeholder text contained an unescaped
      apostrophe (`<pending_switch_to's real value>`) that would have
      broken the embedded Python string literal — caught by actually
      substituting and running it, not by eyeballing.
- [ ] **Live test, attempt 1 of a planned 3+: A1 held, A2 FAILED.** The
      response text was correct ("You're currently tracked on ANG-123
      — are you switching to ANG-4571?" — meaning A1's context
      injection worked, this run did NOT reproduce the original
      grounding bug). But `current-ticket.json` showed no
      `pending_switch_to` field afterward, checked directly — A2's
      bundled write command was never invoked during the real turn,
      despite passing every local sandbox test.
- [x] **Root cause of A2's failure, diagnosed precisely, not just
      re-flagged as "still broken":** A2 was designed to fix "the
      agent tries to write JSON by hand and gets it wrong" — but the
      original 2026-08-31 bug this was built to prevent was already
      described as *"the write got skipped, the trace showed only a
      Read File call"* — an omission, not a construction error.
      Bundling a multi-field write into one deterministic command only
      helps once the agent decides to invoke something; it does
      nothing about the agent not invoking anything at all. This was a
      real flaw in the fix's design, not bad luck on one run — the
      sandbox tests could only ever validate "does the command work
      when called," never "does the agent call it during a real turn,"
      so passing them was never actually evidence this specific
      failure mode was closed.
- [x] **A related anomaly in the same transcript, connected to the same
      diagnosis, not filed as unrelated noise:** `getJiraIssue` was
      called with `"cloudId": "https://teamlease-tech.atlassian.net"`
      (a URL) instead of the real cloud ID
      (`95d1d0d9-87db-4e3a-964d-a485e6e75c4c`) that
      `getAccessibleAtlassianResources` had returned earlier in the
      SAME turn — it still worked, but used the wrong value. Same
      shape as A2's failure: the agent not reliably carrying forward
      and acting on something from its own immediately-preceding
      step within one turn, independent of instruction clarity. This
      sharpens tonight's "reliability ceiling" framing: the gap isn't
      prose instructions getting lost over a long conversation, it's
      multi-step tool-call chains within a single turn not reliably
      completing, even when each individual step is unambiguous. No
      structural fix available for this specific instance — command
      hooks have no Jira/MCP access at all (confirmed repeatedly
      tonight), so this value can only ever come from the agent's own
      tool-call chain. Tracked separately, not blocking the rethink
      below.
- [ ] **Rethought approach, proposed not built:** move both the
      detection AND the write of `pending_switch_to` fully into the
      command hook, unconditionally, whenever a candidate ticket
      mention appears — not a fact handed to the agent to act on, but
      a state change that already happened before the agent reasons
      about it. Inverts the failure mode: instead of "a real switch
      silently never gets recorded" (unrecoverable, invisible), it
      becomes "a non-switch stays recorded until the agent's judgment
      clears it" (recoverable — and CASE C1 already has a safety net
      for exactly this: repeating the same ticket ID on a later turn
      counts as confirmation on its own, so a genuine switch wouldn't
      be lost even if the agent never explicitly asked). A1 is left in
      place (different mechanism, nothing for the agent to invoke,
      the one part that held up this run). Not implemented — needs
      sign-off given A2 just failed live despite passing every
      pre-live check available.

## 2026-09-01 (same day, follow-up): pre-switch commit gate (docs/pre-switch-commit-proposal.md) built, live-tested 5/5 cases, PASSED
- [x] **Design approved and built as proposed — the automatic version.**
      `scripts/ticket-gate-fastpath.sh` now blocks a mid-conversation
      ticket switch (gated on `pending_switch_to` being set — not on
      judging whether the current message confirms it, deliberately
      staying out of that NLU call the same way `FUZZY_TICKET_MATCH`
      already does) until the current `episode_id` has at least one
      commit with a matching `Kiro-Episode` trailer, auto-committing
      one itself (`KIRO_AGENT_COMMIT=1 git commit --allow-empty`) if
      not. Real gap confirmed before building: `current-ticket.json`'s
      live episode `ep_6a9681eb9207df` had zero matching commits in
      the last 10 — this was not a hypothetical.
- [x] **Cleanup alongside the build:** the isolated capability-test
      block (`.kiro/hook-write-test.json`, added earlier tonight to
      answer "can a command hook write a persistent file") removed
      from the script per its own "remove once answered" comment — this
      feature is a strictly stronger live proof of the same capability
      (running `git commit` is one more subprocess call, not a new
      category). The leftover test file itself deleted.
- [x] **Case 1 — auto-commit fires:** started from the real
      no-commit-yet episode above, wrote `pending_switch_to` to
      simulate CASE C2, ran the script. Real commit `80decaa` landed,
      `Kiro-Episode: ep_6a9681eb9207df` / `Kiro-Ticket: ANG-123`
      confirmed via `git log` trailers (not transcript text), message
      `"ANG-123: capture episode ep_6a9681eb9207df credits before
      switching to ANG-999"`, no unrelated files staged, gitleaks log
      showed `0 commits scanned` / `no leaks found`.
- [x] **Case 2 — confirm the switch:** ran the real CASE C1
      credit-read+episode command, wrote the new baseline for
      `ANG-999`. Confirmed via `git show` that commit `80decaa`
      (the old episode) is untouched and HEAD didn't move from the
      switch write itself — the old episode's credits are now
      permanently on record, which is the entire point of this fix.
- [x] **Case 3 — decline the switch:** set `pending_switch_to` again
      on the new episode, let the auto-commit fire (`bd57d01`), then
      simulated a decline (field removed, `ticket_id`/`episode_id`
      left alone). A follow-up turn produced no duplicate commit —
      `HEAD` diffed identical before/after, confirmed directly.
- [x] **Case 4 — the TTY-subprocess unknown flagged in the proposal as
      NOT YET LIVE-VERIFIED, now closed both ways:** this sandboxed
      shell has no controlling TTY at all (`tty` → "not a tty",
      `/dev/tty` unopenable — confirmed directly), so Cases 1 and 3
      above already exercised the no-TTY path for real, and
      `.kiro-tracking/hook-health.log` showed
      `pre-commit-refresh-confirmed-via-chat` /
      `post-commit-switch-check-skipped-agent-commit` — the
      `KIRO_AGENT_COMMIT=1` path, not a TTY-branch skip line. Then
      re-ran the same trigger under a real pseudo-terminal (Python's
      `pty.spawn`, a genuine TTY attached to the subprocess — the
      worse-case scenario the proposal actually worried about) and got
      the identical agent-commit branch again (commit `d838659`),
      because `pre-commit`/`post-commit` both check `$KIRO_AGENT_COMMIT`
      *before* any TTY check — structurally unreachable to fall into
      the 5-minute-hang branch when it's set, confirmed by reading the
      real shipped hook code, not just observed as a coincidence.
- [x] **Case 5 — the user's added requirement: does gitleaks (or
      anything else in `pre-commit`) ever genuinely fail on this empty
      commit, and does the new code actually block on it.** Direct
      `gitleaks protect --staged` test with nothing staged: `0 commits
      scanned`, `no leaks found`, exit 0 — cannot fail on an empty
      stage, real evidence not an assumption. Separately, the new
      script's own `if ! git commit ...; then exit 2; fi` guard tested
      in an isolated scratch repo (`core.hooksPath` pointed at a
      deliberately-failing fake `pre-commit`) — confirmed it correctly
      surfaces a blocking message and exits 2, with no bogus commit
      landing, rather than silently proceeding or crashing the hook.
- [x] **All 5 cases passed on first attempt** — no rollback needed.
      Real commits from this test run left in `git log` on
      `test-case-a` deliberately (consistent with this branch's
      existing role as the test branch — `80decaa`, `bd57d01`,
      `d838659` — the first of the three is a genuine, correct capture
      of real episode `ep_6a9681eb9207df`'s credits, not throwaway
      test noise).
- [x] **State reset to clean before stopping for the night:**
      `.kiro/current-ticket.json` deleted (it's gitignored, local-only
      state — the test run had left it pointing at fictional test
      tickets `ANG-999`/`ANG-124`). Next session starts with no ticket
      tracked, which correctly triggers the real empty-ticket gate
      rather than silently continuing to "track" a fake ticket.
- **Stopping here for the night per explicit instruction** — this was
  named the final task of the session regardless of outcome. It
  happened to pass every case; nothing further planned until picked up
  next time.

## 2026-09-01 (same day, follow-up): a THIRD confirmed instance of tonight's skipped-write failure class — this time the CASE A1 marker file, not pending_switch_to
- [x] **Real transcript, pasted by the user, state-verified, not taken
      on faith:** `hi` → correctly asked the ticket question (0.07
      credits). `ANG-123` → correctly asked "Please click your profile
      icon to refresh your credits, then let me know when ready" (0.09
      credits) — this is CASE A1's Ask #1. `done` → should have been
      read as the confirmation reply (per the `pending-baseline-
      confirm.json`-exemption added 2026-08-31 for exactly this
      exchange) and triggered the real credit-read + write. Instead the
      agent read all three state files, found `current-ticket.json`
      empty and — critically — `pending-baseline-confirm.json` **also
      absent**, concluded the HARD GATE applied, and re-asked the bare
      ticket question from scratch (0.24 credits). Confirmed directly
      afterward: `.kiro/pending-baseline-confirm.json` really is
      absent, matching the agent's own report, not a transcript
      artifact.
- [x] **Root cause, same shape as A2's failure earlier tonight, different
      spot:** the prompt in `aidlc-ask-for-ticket-if-missing.json`
      instructs "Write `.kiro/pending-baseline-confirm.json` now (per
      the MARKER FILE rule) before asking. Then ask once: [profile-click
      question]" — a free-text instruction to the agent, not a
      deterministic write. On this turn the agent asked the question
      correctly but never made the write. This is the **third**
      confirmed live instance tonight of the same underlying pattern
      (the original 2026-08-31 `pending_switch_to` skip, tonight's A2
      `pending_switch_to` skip during live testing, and now this
      `pending-baseline-confirm.json` skip) — three different required
      writes, three different call sites, one shared root cause: a
      prose "write this file" instruction inside a chat turn is not
      reliably executed, independent of how clearly it's worded.
- [x] **Real cost of this specific failure, not just a correctness
      note:** 0.40 credits and 3 user turns spent to land back at
      "no ticket set," with the user now needing to retype `ANG-123`
      a second time — worse than a plain miss, since it looks like
      progress (a real, correct-sounding question each time) right up
      until the state check reveals nothing was ever saved.
- [ ] **Not fixed tonight — logging only, per the explicit stop called
      right before this was pasted.** This is exactly the failure mode
      the "Rethought approach" above (move detection AND the write
      fully into the command hook, unconditionally) was proposed to
      close for `pending_switch_to` — the same fix shape applies here
      too: `pending-baseline-confirm.json` is a marker only the agent
      currently writes, with no command-hook equivalent yet. Whether to
      extend that rethought approach to cover this marker as well, or
      treat it as a separate case, is an open call for next session, not
      decided here.

## 2026-09-01 (same session, follow-up): the pre-switch commit gate fired for real in live use — mostly correct, but committed TWICE for the same episode, root cause not yet found
- [x] **Real, unplanned confirmation the gate works:** picked back up
      this session by checking state before touching anything, per
      explicit instruction — found `current-ticket.json` NOT absent
      (`ticket_id: ANG-4571`, live) and two commits (`9e9a602`,
      `7916316`) neither made by this session. Both carry the exact
      message format `"$TICKET_ID: capture episode $EPISODE_ID
      credits before switching to $PENDING_SWITCH_TO"` from
      `scripts/ticket-gate-fastpath.sh`'s pre-switch commit gate
      (`b222d80`) — confirms it fired for real, in the user's actual
      live Kiro session, not just in this session's own tests, and
      correctly captured `ANG-123`'s credits (`Kiro-Credits: 1.7500`
      on the second one) before the switch to `ANG-4571` that
      `current-ticket.json` now correctly reflects.
- [ ] **But: it committed twice for the identical episode — the gate's
      own "skip if already committed" check should have prevented
      this and didn't.** Both commits carry the exact same
      `Kiro-Episode: ep_6a96a28819d6ec` AND the exact same
      `Kiro-Episode-Started: 2026-09-01T10:01:44Z`, 47 seconds apart
      (`.kiro-tracking/hook-health.log`: `ts=2026-09-01T10:05:31Z`
      then `ts=2026-09-01T10:06:18Z`, both
      `post-commit-switch-check-skipped-agent-commit`) — meaning
      nothing about the episode had changed between them. Checked
      directly, after the fact: `git log
      --format='%(trailers:key=Kiro-Episode,valueonly)' | grep -qxF
      ep_6a96a28819d6ec` DOES find it (both commits' own trailers
      match) — so on the second firing, the gate's own check should
      have found the first commit and skipped, and didn't.
- [x] **Root cause NOT confirmed — two real candidates, not
      distinguished yet:** (a) the script's `if ! git log ... | grep
      -qxF "$EPISODE_ID"; then` pattern doesn't distinguish "no match
      found" from "the `git log` half of the pipe itself failed" (a
      transient lock, or any other git error) — under `pipefail`,
      either one makes the `if !` condition true, silently treating a
      broken check the same as a genuine miss; (b) Kiro may have
      invoked the fastpath hook twice for turns close enough together
      that the two runs raced each other. Neither has been isolated
      by direct evidence yet — flagging both as candidates, not
      concluding either.
- **Deliberately set aside, not fixed this session** — scoped out on
  request to keep this session's build limited to the two originally
  planned findings (the marker write-skip, and CASE A1's missing
  ticket_id). `current-ticket.json`'s current `ANG-4571` state is live
  and was left untouched. Worth a dedicated look next time: a
  duplicate empty commit is harmless on its own, but the same
  "check-then-act" pattern with the same race/error-masking risk is
  about to be reused for two new command-hook writes in this session's
  planned build, so the design proposal below should account for it
  rather than silently repeat it.

## 2026-09-01 (same session, follow-up): CASE A1 marker fix (docs/case-a1-marker-fix-proposal.md) built, live-tested 9/9 cases + 1 follow-up fix, one design claim caught wrong by testing and corrected
- [x] **Built exactly as proposed, scope confirmed by code trace before
      touching anything:** `scripts/ticket-gate-fastpath.sh` now writes
      `.kiro/pending-baseline-confirm.json` itself (WITH `ticket_id`) at
      the exact point it already deterministically detects a CASE A1
      candidate (exact match, `'none'`, or fuzzy match) — two new
      `python3 -c` blocks, no new capability. `aidlc-ask-for-ticket-if-
      missing.json` got 7 targeted prompt edits (verified each matched
      exactly once before replacing): stop telling the agent to write
      the marker for A1's two sub-paths, read `ticket_id` from it
      instead of memory, delete it on the new "ticket doesn't exist"
      rejection path, update it on decline-with-alternative, and (added
      mid-session, see below) update it on any A1 re-entry with a
      mismatched stale value. CASE C1 and PRIORITY CHECK's own prose
      instructions untouched — confirmed by code trace they don't need
      this (C1 exits at line 151–154 before ever reaching the marker
      check; PRIORITY CHECK is independently backed by `pending-ticket-
      check.json`, checked in the same `||` condition).
- [x] **State check done first, as instructed, before any building:**
      found `current-ticket.json` NOT absent (`ANG-4571`, real, left
      untouched throughout) and two unplanned commits from the user's
      live Kiro session — see the entry directly above this one for
      that finding (set aside, not part of this build).
- [x] **Tests 1–8: all PASS, real file state checked after every one,**
      run in an isolated scratch copy (`scripts/` + a fake `.kiro/`) so
      the live `ANG-4571` state was never touched — confirmed via direct
      `cat`/`git log` before, during, and after:
      1. Exact match → marker `{"awaiting": true, "ticket_id":
         "ANG-123"}` written before any agent turn.
      2. Full flow → `current-ticket.json` correctly gets `ANG-123`
         (read from the marker per the new instruction, not memory);
         markers gone after.
      3. **Direct replay of the original transcript's exact shape**
         (same ticket, same confirmation word `"done"`, same turn
         count): turn 3 now produces exit 0 and NO output at all — the
         original bug (re-asked question, exit 2) does not reproduce.
      4. Fuzzy match → marker carries the NORMALIZED value (`ANG-123`
         from `"ang - 123"`), not the raw text.
      5. Rejection → marker created then correctly deleted; the next
         real candidate gets a clean, correct marker afterward.
      6. **Negative test, CASE C1:** byte-identical script output/exit
         with the marker present vs. absent — confirms it structurally
         never looks.
      7. **Negative test, PRIORITY CHECK:** same — byte-identical
         either way, confirms `pending-ticket-check.json` alone already
         covers it.
      8. **Decline-with-alternative:** confirmed live that the command
         hook genuinely cannot detect `"no ANG-4571"` as a new candidate
         (correctly silent, matches the intentional `NOANG-4571`
         false-positive guard) — the agent-side bundled update command
         from the design correctly fixes the marker when applied.
- [ ] **Test 9 — NOT a clean pass, a real finding that the design doc's
      own claim was wrong, caught by testing rather than asserted.** The
      proposal claimed a skipped rejection-branch deletion was "bounded
      and self-correcting the moment a new candidate arrives." Tested
      directly: it is NOT. A stale marker (fake ticket, cleanup
      skipped) was still showing the OLD ticket_id after a real,
      different candidate arrived on a later turn — `grep`-confirmed on
      disk, not inferred. Root cause: `pending-baseline-confirm.json`'s
      existence check on line 160 exits before the exact/fuzzy-match
      detection logic runs again, so nothing ever gets the chance to
      overwrite a stale marker at the command-hook level. Also flagged
      a secondary risk this interacts with: Edit E tells the agent to
      trust the marker's `ticket_id` over its own memory — a stale
      marker plus that instruction could make the agent write the
      WRONG ticket ID for a fresh candidate.
- [x] **Fixed the same session, re-tested, closes it:** generalized the
      decline-with-alternative pattern (already approved) to CASE A1's
      entry point generally — any re-entry into A1 matching now updates
      the marker's `ticket_id` to the current message's candidate
      whenever it doesn't already match, before doing anything else.
      Re-ran test 9's exact scenario with this applied: the stale
      marker correctly gets overwritten to the new real candidate.
      Re-ran test 5 (rejection+cleanup) to confirm no regression — still
      passes. Still prose-dependent (command hook structurally cannot
      see this case, confirmed) — same class of honest limitation as
      decline-with-alternative itself, not a new one.
- [x] **Design doc corrected to match what testing actually found,**
      not left standing as originally written — `docs/case-a1-marker-
      fix-proposal.md`'s "self-correcting" claim rewritten to state
      plainly it was tested and found false, and how it was actually
      closed.
- [x] **Real repo state confirmed untouched throughout, checked
      directly before and after every test batch:** `current-ticket.json`
      still `ANG-4571`, `pending-baseline-confirm.json` still absent,
      git log unchanged from the entry above. All testing done in an
      isolated scratch copy specifically to make this possible without
      touching live state.
- **9 cases run, 8 clean passes, 1 caught-and-fixed-same-session — same
  pass bar as everything else tonight: a single failure (test 9) was
  treated as exactly that, not smoothed over, fixed, and re-verified
  before calling this done.**

## 2026-09-01 (same session, follow-up): double-commit anomaly (from earlier this session) root-caused and fixed — SIGPIPE, not a lock or a race
- [x] **Investigated properly before proposing anything, per explicit
      instruction.** Re-read the exact check
      (`git log ... | grep -qxF "$EPISODE_ID"` under `set -euo
      pipefail`) and confirmed by direct toy reproduction that a
      failing left-hand command in a pipe can be silently
      indistinguishable from "no match found" under `pipefail`.
- [x] **Root cause confirmed, not a lock file:** tested `.git/
      index.lock`, `.git/HEAD.lock`, and `.git/refs/heads/<branch>.lock`
      directly against `git log` — none affect it (a pure read, doesn't
      touch those locks). The real mechanism: `grep -qxF` exits the
      instant it finds the target trailer (always near the top of
      `git log`'s output, since it's the trailer the gate itself just
      committed), closing the pipe while `git log` is still writing the
      rest of history — a real SIGPIPE, confirmed directly via
      `PIPESTATUS`: `git log` exits 141, `grep` exits 0. `pipefail`
      reports the pipeline failed anyway, which the `if !` check reads
      as "not found," committing again. **Reproduced 55/55 times**
      (a 3000-commit repo and the real repo's actual size, 64 commits)
      — deterministic, not a rare race.
- [x] **Candidate (a), overlapping hook invocations — tested directly,
      NOT confirmed.** 10 trials of genuinely concurrent invocations
      (real background processes, real `git commit` calls) against a
      version of the check with the SIGPIPE bug already removed:
      zero double-commits in 10/10. One invocation always either
      correctly saw the other's commit and skipped, or hit a real git
      lock error on the commit step (already safely handled by the
      gate's existing failure path). Not needed to explain the real
      incident.
- [x] **Fix built and verified before writing the design doc** (capture
      `git log`'s output into a variable, check via a here-string —
      no live pipe into `grep -q` at all): 10/10 true positives, 1/1
      true negative in isolation, before the design doc was even
      written.
- [x] **Design approved** (`docs/pre-switch-gate-sigpipe-proposal.md`),
      built in the real script, then live-tested 5/5 in an isolated
      scratch repo wired with the REAL `.githooks/*` (`core.hooksPath`
      set, `commit-msg` actually running) so real trailers were
      genuinely present, not simulated — the real repo's live
      `ANG-4571` state was never touched, checked directly before and
      after:
      1. **Direct replay of the exact incident** (same episode ID,
         same two-turn pattern): turn 1 commits, turn 2 — the exact
         scenario that previously produced `9e9a602`/`7916316` — now
         correctly skips. `git log` trailer count stayed at 1, not 2.
      2. **10 fresh episodes, same pattern:** 0/10 failures.
      3. **True-negative check:** a genuinely new, never-committed
         episode still triggers the commit correctly.
      4. **The other two `grep -q` sites** (exact-match and fuzzy-match
         detection, both pipe from `echo` of a short variable, not a
         streaming process) confirmed still working, unaffected.
      5. **Both ruled-out candidates re-confirmed against the actual
         fixed script**, not just the standalone harness: lock-file
         tests still show no effect; 10-trial concurrency re-test
         shows 0/10 double-commits.
- **All 5 live-test cases passed. Real repo state (`ANG-4571`, git log)
  confirmed unchanged throughout — verified directly, not assumed.**

## 2026-09-02: two new findings from a real live transcript — logged, not investigated further tonight
- [ ] **`current-ticket.json` reset to literal `{}`, cause unconfirmed.**
      Checked directly: this repo has exactly one code path that writes
      literal `{}` — `.githooks/post-checkout`, only on a real branch
      checkout (`$3=1`). `git reflog` shows no checkout since
      2026-08-27, ruling that out. File mtime (~10:53 UTC) is after the
      prior entry's final state check (confirmed `ANG-4571` at that
      point) and before this entry. No other write site found in
      `.githooks/*` or `scripts/*`. Best guess, NOT confirmed: the
      agent itself wrote it directly via a file-write tool call during
      its own confused "I need to check the current ticket status"
      turn — plausible but unverified; reporting the gap honestly
      rather than asserting a cause.
- [ ] **Real transcript shows a command hook's `exit 2` may not be
      suppressing the sibling agent hook, contradicting an earlier
      finding tonight — needs investigation, not concluded.** Two
      consecutive `"hi"` turns (ticket_id empty) both showed BOTH
      `Ticket fast path` (command hook) AND `Ask/validate ticket`
      (agent hook) as having run, non-trivial credits spent each time
      (0.08, 0.1 — not the ~0 the fast-path exists to guarantee), and
      neither turn ever displayed the bare ticket question — instead,
      narrated commentary ("I need to check the current ticket
      status...") that also violates the agent hook's own long-standing
      NARRATION GUARD. Running the actual current script by hand
      against the actual current repo state reproduces a clean `exit 2`
      with the bare question — so the divergence is specifically
      between the live Kiro invocation and a hand-fed synthetic stdin
      payload, not the script's own logic as testable in isolation.
      This directly contradicts the 2026-08-31 finding above ("#1 as
      originally scoped is architecturally impossible... there is no
      separate sibling agent-hook turn for a command hook to
      suppress") — either that documented Kiro behavior doesn't hold
      in practice, or something about the real invocation differs from
      what's reproducible here; not distinguished. No access to Kiro's
      own internals/session logs to go further from this session alone.
- **Deliberately not investigated further tonight, per explicit
  instruction — logged with the evidence gathered so far, picked up
  next time.**

## 2026-09-02: reviewed commits made outside this session (`7b3da75`, `554897b`) — uncommitted-work gate has a real false-positive gap, narrowing proposed
- [x] **Confirmed the SIGPIPE fix landed correctly, just not isolated
      the way this session's commits have been.** Byte-for-byte
      identical to what was built and tested, but bundled inside
      `7b3da75` — a 2195-insertion, 15-file commit made by a live Kiro
      session (real `Kiro-Session` ID, generic message), not this one.
      Nothing to surgically stage for it anymore; already in history.
- [x] **New content reviewed, not built by this session:** an
      "uncommitted-work gate" (blocks a ticket switch when `git status
      --porcelain` is non-empty) and a `SessionStart` greeting hook.
      Both syntax/JSON-valid, no hard-crash risk.
- [x] **Real, confirmed gap in the uncommitted-work gate:** `git status
      --porcelain` shows `M TODO.md` on this repo RIGHT NOW — this
      project's own normal workflow (surgical staging, deliberately
      leaving other reviewed work uncommitted) means the repo is
      dirty almost continuously. The gate's signal doesn't distinguish
      that from genuinely forgotten work; as written it would block
      close to every switch under this project's actual practice, not
      just the rare real case.
- [ ] **Investigated whether this false positive caused the 2195-line
      bundled commit — NOT confirmed, reporting honestly rather than
      asserting a link.** The gate logs nothing on a block — no direct
      evidence exists either way. Circumstantial support only: the
      gate's own proposal doc documents encountering a dirty tree
      (from its own in-development changes) and correctly flagging it
      during this exact window; two ticket-episode switches (`ANG-4571`
      then back to `ANG-123`) landed within 2m22s of each other,
      bracketing the large commit. Consistent with the hypothesis, not
      proof of it.
- [x] **Proposal written for both fixes**
      (`docs/uncommitted-work-gate-narrowing-proposal.md`): replace the
      whole-repo dirtiness check with a per-episode baseline (`git
      status --porcelain`, captured at the same instant as each
      episode's credit baseline, stored as `dirty_snapshot_at_episode_
      start`; only lines NOT in that baseline count as "new" and
      block). Verified the core comparison logic directly in an
      isolated scratch repo before writing it up: pre-existing dirt
      correctly produces no block, genuinely new dirt correctly does.
      Also proposes a hook-health.log line for the gate (it currently
      logs nothing, which is why the causal question above couldn't be
      answered) and the `aidlc-session-greeting.json` hardcoded-path
      fix (`git rev-parse --show-toplevel`, verified working, replacing
      the hardcoded `/home/srimathi/Desktop/v1`).
- **Not built — awaiting review, same process as everything else
  tonight.**

## 2026-09-02 (same session, follow-up): uncommitted-work-gate narrowing built and live-tested 7/7, one site at a time per explicit instruction
- [x] **Built with individual, one-at-a-time verification per site — not
      a bulk find-and-replace** (explicitly requested, matching how the
      A2 cascading-corruption bug was originally caught): each of the 7
      sites was read, edited, then verified (syntax check + content
      check, and a standalone dry-run for the 3 python one-liners
      embedded in the agent hook prompt) before moving to the next.
      - Sites 1–2 (`scripts/ticket-gate-fastpath.sh`, C1 and C2 checks):
        whole-repo `git status --porcelain` replaced with a comparison
        against `dirty_snapshot_at_episode_start`; both add a
        `hook_status=uncommitted-work-gate-blocked` log line (closes
        the traceability gap from the prior entry).
      - Site 3+7 combined (`.githooks/post-commit`'s `'none'` branch):
        same comparison on the read side; the write side migrated from
        the old "print 3 lines, bash reconstructs JSON" pattern to
        writing `current-ticket.json` directly from python (matching
        Option A2), now also capturing `dirty_snapshot_at_episode_
        start` at the same instant as the credit baseline.
      - Sites 4–6 (agent hook prompt, CASE A1/C1/PRIORITY CHECK): each
        bundled write command extended with `subprocess` + a
        `dirty_snapshot_at_episode_start` field, verified individually
        via `python3 -m json.tool` on the JSON.load() of the resulting
        edit, matched-once assertions before applying each.
      - Bonus small fix: `aidlc-session-greeting.json`'s hardcoded
        `/home/srimathi/Desktop/v1` replaced with `git rev-parse
        --show-toplevel`.
- [x] **7/7 live-test cases PASS, real file/git state checked after
      every one, in an isolated scratch repo (real `.githooks/*`
      wired via `core.hooksPath`) — real `ANG-123` state untouched
      throughout, verified directly before and after:**
      1. Pre-existing dirt allowed through — same dirt still present
         at switch time, exit 0, no block.
      2. Genuinely new work still blocks — exit 2, and the block
         message correctly showed ONLY the new file.
      3. Mixed case — confirmed by the same run as (2): pre-existing
         AND new dirt both present, only the new file listed.
      4. Backward compatibility — a `current-ticket.json` with no
         `dirty_snapshot_at_episode_start` field at all correctly falls
         back to blocking on any dirt (today's old behavior), not
         silently passing everything.
      5. All 4 capture sites confirmed producing valid JSON with the
         new field — sites 4–6 via targeted dry-runs, site 7 via a
         REAL fully-interactive `git commit` driven through a genuine
         pty (`pty.fork()`, after an initial `subprocess.Popen`-based
         attempt failed because redirecting fds alone doesn't make a
         pty the process's controlling terminal — `pty.fork()` does).
      6. `hook_status=uncommitted-work-gate-blocked site=fastpath-c1`
         confirmed present in `.kiro-tracking/hook-health.log` after a
         real block — the exact log line the prior entry's causal
         investigation didn't have available.
      7. Session-greeting fix confirmed resolving correctly when run
         from a deeply nested subdirectory, not just the repo root.
- [x] **One real test-harness gap caught along the way, not glossed
      over:** the first scratch repo setup showed spurious "dirty"
      results for `.githooks/`, `.kiro/`, `scripts/` — they'd been
      copied into the scratch repo but never committed there (unlike
      the real repo, where they're tracked), plus `.kiro-tracking/`
      needed the same `.gitignore` entry the real repo already has.
      Fixed the harness, not the (correctly-behaving) code.
- **All 7 cases passed on this attempt — no further fixes needed. Real
  repo state (`ANG-123`, git log) confirmed unchanged throughout.**

## 2026-09-02: a THIRD marker-related failure variant, found during a manual test walkthrough — the ask-and-wait step itself skipped, not just the marker
- [x] **Real symptom:** after `ANG-123` was validated against Jira, the
      flow went straight to the credit-read command and wrote the
      baseline — no "please click your profile icon" question ever
      appeared. `current-ticket.json` confirms a real, fully-formed
      baseline landed (`episode_started_at: 2026-09-02T05:34:21Z`,
      correct `dirty_snapshot_at_episode_start`) — the write itself
      worked, and used the right ticket_id. What's missing is
      everything between Jira validation passing and that write.
- [x] **`hook-health.log` gives NO signal either way — a structural
      gap, not a one-off.** Checked every single write to that file
      across the whole codebase: every one is tied to a real git
      operation (`pre-commit`/`post-commit`/`post-checkout`/`pre-push`/
      the uncommitted-work-gate blocks). Establishing a baseline is a
      pure file write with no git operation at all — nothing anywhere
      logs it. This mechanism is entirely invisible to that log, for
      either a correct run or a skipped one.
- [x] **CASE A1's instruction text traced directly — intact and
      correctly sequenced, NOT a textual regression from tonight's
      other fixes.** The ask ("Then ask the user directly... and WAIT
      for their actual reply — before running the command below") is
      still there, still before the credit-read command. Neither the
      uncommitted-work-gate changes nor the marker fix touched this
      sentence — confirmed by diff.
- [x] **A real, mechanically-confirmed connection to a second bug in
      the same walkthrough, not just a coincidence:**
      `.kiro/pending-baseline-confirm.json` was found still sitting
      there with `ticket_id: "ZZZZ-99999"` — a stale marker from an
      earlier fake-ticket test, never cleaned up (the rejection-branch
      delete from the CASE A1 marker fix skipped, same failure shape
      as everything else tonight). Traced the fastpath script directly:
      the marker-exists check (line 268, `if -f pending-ticket-check.json
      || -f pending-baseline-confirm.json; then exit 0; fi`) runs
      BEFORE the exact-match/fuzzy-match detection blocks that write or
      update the marker (lines 285/316). **This means the stale
      `ZZZZ-99999` marker's mere presence blocked the command hook from
      ever reaching its own deterministic candidate-detection logic for
      `ANG-123` at all** — confirmed by code trace, not speculation.
      Whether this fully explains the agent also skipping its own ask
      instruction is NOT confirmed — the agent hook's top-level CASE A
      logic reads `current-ticket.json` independently and shouldn't
      need the fast-path's help to recognize CASE A1 applies — but it's
      a real, mechanically-verified contributing factor, not a
      coincidence being waved at.
- [x] **Honest process failure, named plainly as asked:** the CASE A1
      marker fix's own proposal doc
      (`docs/case-a1-marker-fix-proposal.md`) has a "What this does NOT
      fully close" section — it names the decline-with-alternative
      case and the skipped-rejection-deletion case, but never named
      "the agent could skip the ask-and-wait step itself, independent
      of the marker mechanics" as a residual risk. It should have. The
      fix's own 9 test cases only ever verified the deterministic layer
      (the command hook's marker write, the fast-path's stand-down
      behavior) — "Test 2, full flow to completion" was this session
      manually simulating a compliant agent, never a live test of
      whether the real agent actually stops and asks. That was never in
      scope, and the proposal should have said so instead of leaving it
      implicit.
- [ ] **Not fixed yet — two things proposed for review, one built.**
      See the design entry immediately below.

## 2026-09-02 (same day, follow-up): proposal for the wording fix + confidence-flag feasibility; stale-marker auto-update BUILT and tested (not just proposed)
- [x] **Fixed now, not just proposed, per explicit instruction — the
      stale-marker bug specifically, distinct from the harder
      ask-skipping problem above.** `scripts/ticket-gate-fastpath.sh`'s
      marker-exists check now runs the SAME exact/fuzzy candidate
      detection already used elsewhere in the script before standing
      down: if the current message is a fresh, different candidate than
      the marker's own stored `ticket_id`, the marker gets updated
      deterministically, right there, regardless of why the old
      candidate went stale (explicit rejection, silent abandonment, or
      anything else) — the command hook doesn't need to know why, only
      that a new real candidate has arrived. This directly closes the
      mechanical block found above: `ANG-123` would now correctly
      overwrite the stale `ZZZZ-99999` marker the moment it's typed,
      instead of being silently swallowed by the marker-exists
      early-exit.
- [x] **Live-tested 6/6 in an isolated scratch repo, real file state
      checked after each:** (A) exact replay of the real incident
      (stale `ZZZZ-99999` marker + typing `ANG-123`) — marker correctly
      updated to `ANG-123`. (B) a genuine reply ("done") to a pending
      marker — left untouched, still correctly stands down. (C) the
      same candidate repeated — correct no-op, no unnecessary write.
      (D) fuzzy re-entry while a different stale marker exists —
      correctly updated to the new normalized candidate (this also
      strengthens Test-9's original fix from the CASE A1 marker
      proposal, which relied on agent prose for this exact scenario;
      it's now deterministic for any candidate matching the ticket-ID
      shape, prose only still needed for the harder decline-with-
      alternative phrasing like "no, I meant..."). (E)/(F) regression
      checks — a fresh exact match with no marker yet, and
      `pending-ticket-check.json`'s unconditional stand-down — both
      unaffected. Real repo state (still showing the live
      `ZZZZ-99999` marker, left deliberately untouched — it will
      self-correct the next time a real candidate is typed) confirmed
      unchanged throughout.
- [x] **Proposed, not built — a wording fix for the "already handled"
      framing risk**, and **a feasibility investigation for a
      deterministic after-the-fact confidence flag** — see
      `docs/case-a1-ask-skip-mitigation-proposal.md`. Plainly stated in
      that doc, per explicit instruction: the wording fix is the one
      that might actually reduce the failure; the confidence flag only
      makes an already-occurred failure more visible after the fact —
      it cannot prevent or reliably detect the general case (a command
      hook has no visibility into whether the agent's actual chat
      response included the ask, or whether it genuinely waited for a
      reply before proceeding).

## 2026-09-02 (same day, follow-up): the ask-skip recurred live, a second time — and this occurrence rules out the marker as a cause
- [x] **Real transcript, immediately after the stale-marker fix landed
      on `test-case-a`:** branch switch reset `current-ticket.json` to
      `{}` (expected). User typed `ANG-123`. Agent read the empty file,
      then went straight to running the credit-read/baseline command —
      no profile-icon ask anywhere in the transcript. Confirmed
      directly against real file state, not just the transcript text.
- [x] **New, important fact this occurrence adds: the marker was
      correctly populated.** `.kiro/pending-baseline-confirm.json`
      showed `{"ticket_id": "ANG-123"}` — matching `current-
      ticket.json`'s ticket_id exactly. The stale-marker fix
      (`469ac6e`) worked correctly here; there was no mismatch for the
      agent to be confused by. **This rules out the marker mechanics as
      the cause of this specific skip** — the agent had a correct,
      ready marker in front of it and still skipped the ask. Direct,
      live confirmation of the exact "hard limit" already named in
      `docs/case-a1-ask-skip-mitigation-proposal.md`'s feasibility
      analysis: an agent that gets the marker right and still skips the
      ask is indistinguishable, by any deterministic signal, from a
      compliant run.
- [x] **Second live occurrence of this exact failure shape in one
      session** — strengthens, without proving, the wording-fix
      hypothesis from the same proposal (the "already wrote the
      marker... do NOT write it yourself. Then ask..." framing
      immediately preceding the required action).
- **Given this new evidence, approved to build the wording fix now
  (previously held for review-only).**
- [x] **Built, both sites, edited and verified individually per
      established practice.** `aidlc-ask-for-ticket-if-missing.json`:
      CASE A1's main path and its fuzzy sub-path both reordered so the
      required action ("You must still ask...") leads, with the
      "marker already written" note demoted to a scoped parenthetical
      ("that ONE specific action, and only that one, is not yours to
      repeat") afterward, instead of leading with what's already done.
      One grammar pass needed on the fuzzy path — the first attempt
      awkwardly split "ask once... and wait for their reply" around
      the parenthetical; caught on verification and re-applied so
      "ask, and wait, before proceeding" stays one flowing clause,
      matching the original structure, with the emphasis and
      parenthetical following it rather than interrupting it.
      `docs/case-a1-ask-skip-mitigation-proposal.md` updated to reflect
      item 1 built, item 2 still proposal-only.
- **No live test possible for this one, stated honestly, same as the
  proposal itself said going in:** this is a text-only change with no
  deterministic branch to exercise — verification is JSON validity plus
  a direct read-back confirming the reordering and grammar, not a
  live-tested behavioral case. Whether it actually reduces the skip
  rate can only be judged by watching for further live occurrences,
  not by anything testable here.

## 2026-09-02 (same day, follow-up): feature request — warm combined greeting+ask for an empty-ticket session's first message, proposed not built
- [x] **Real transcript, same narration bug recurring** (`I need to
      read the current ticket file to determine what to do` for a
      plain `hi`, both `Session greeting` and `Ticket fast path` and
      the agent hook all firing on one turn) — same open, unresolved
      "does exit 2 suppress the sibling agent hook" question already
      logged, not re-investigated here.
- [x] **New, separate request:** when no ticket is set, the session's
      first response should be a warm greeting combined with the
      ticket question, not the current cold bare question (or the
      narrated non-answer it's actually getting). This directly
      conflicts with the HARD GATE's deliberately absolute "ONLY the
      ticket question... no exceptions" wording, so proposed properly
      rather than built directly.
- [x] **Proposal written:**
      `docs/session-start-greeting-exception-proposal.md` — a
      one-shot deterministic marker (`.kiro/pending-session-greeting.
      json`), written by `aidlc-session-greeting.json` on `SessionStart`
      when the ticket is empty, checked and consumed by the fast-path
      before its bottom HARD GATE block. Deliberately does NOT rely on
      the agent inferring "this is turn 1 of the session" from
      conversational context (unconfirmed whether `SessionStart`'s
      context reliably carries into the next `UserPromptSubmit` turn)
      — the marker is the sole, deterministic trigger. The HARD GATE's
      own carve-out is tied to a literal stdout signal
      (`SESSION_START_GREETING_EXCEPTION:`), not "use your judgment,"
      to avoid the exception itself becoming a new place to
      rationalize narration.
- **Not built — awaiting review, same process as everything else
  tonight.**
- [x] **Reviewer caught a real gap before approving, confirmed by
      trace, not dismissed:** asked whether a stale marker could
      linger and misfire on a later, unrelated turn. Traced the
      script directly — the original design checked the marker at
      exactly one point, and five other branches in the same script
      exit earlier, before ever reaching it, so an ordinary first
      message (not just a rare session interruption) could leave the
      marker unexamined indefinitely. Confirmed honestly: as
      originally written, yes, it could have misfired. Fixed with a
      time-based expiry (300s, reusing the exact timeout already used
      twice elsewhere in this project) judged by the marker's own
      recorded age rather than by whether it happened to be reached
      soon after creation — doesn't matter which branch fires first or
      how many turns pass. Proposal doc updated in place with the fix,
      an explicit answer to the question asked, and 3 new/revised test
      cases (expiry, malformed timestamp, hygiene cleanup). Still not
      built — back for review with the fix included.
- [x] **Approved and built — all 4 sites, edited and verified
      individually.** `aidlc-session-greeting.json`'s empty-ticket
      branch now writes `.kiro/pending-session-greeting.json` with a
      real `created_at` timestamp. `scripts/ticket-gate-fastpath.sh`
      gets the age-checked block (300s, matching this project's
      existing timeout convention) right before the bottom HARD GATE,
      plus a hygiene cleanup at the existing `CURRENT_TRACKED_TICKET`
      branch. `aidlc-ask-for-ticket-if-missing.json`'s HARD GATE
      preamble gets the one narrow carve-out sentence, tied to a
      literal stdout signal, not agent judgment.
- [x] **Live-tested 7/7, real file state checked after every case, in
      an isolated scratch repo:**
      1. Fresh session, plain greeting → marker written with a real
         timestamp, consumed correctly, `SESSION_START_GREETING_
         EXCEPTION` emitted, exit 0, marker gone after.
      2. Second message, same session → marker already consumed,
         bare-question HARD GATE fires normally, unchanged from today.
      3. First message already a real ticket ID → marker correctly
         left untouched (exact-match branch exits first); a debugging
         catch along the way (a leftover `pending-baseline-confirm.json`
         from that same step correctly took precedence and blocked the
         next check — confirmed as *existing*, correct behavior, not a
         new bug, and cleaned up to isolate the actual test). Then, on
         a LATER turn with the ticket empty again and the same marker
         still fresh, confirmed it's still correctly found and applied
         — proving age, not turn-count, is what's judged.
      4. Ticket already tracked → no marker written at all.
      5. **Expiry — the exact scenario asked about.** A marker aged 10
         real minutes: correctly deleted, NO exception line emitted,
         normal bare-question HARD GATE fires instead. Directly
         confirms a stale marker cannot misfire on a later, unrelated
         turn.
      6. Malformed timestamp (bad string, empty string, and fully
         malformed JSON — three variants): all three fail safe, no
         crash even under `set -euo pipefail`, no exception applied.
      7. Hygiene cleanup: marker present + `ticket_id` already
         non-empty → marker correctly removed via the
         `CURRENT_TRACKED_TICKET` branch, even though the expiry-check
         block at the bottom of the script is never reached on that
         turn.
- **All 7 cases passed on this attempt — no further fixes needed. Real
  repo state (`ANG-123`, git log) confirmed unchanged throughout.**

## 2026-09-02 (same day, follow-up): narration content ban — third pass at the same guard, built, honest about what could and couldn't be verified from here
- [x] **Not presented as a fresh fix — this is a third failure of the
      same guard.** The NARRATION GUARD already exists, already bans a
      list of example phrases, already documents its own 2026-08-31
      origin, and has now failed three distinct ways: two transcripts
      already pasted tonight with different phrasing than any banned
      example, and now a direct report of the agent using the literal
      internal names `pending-baseline-confirm.json` and "HARD GATE" in
      a visible response.
- [x] **Proposed** (`docs/narration-content-ban-proposal.md`): a
      second, independent axis — a ban on specific CONTENT (literal
      internal file/rule names, via a pattern: anything under `.kiro/`
      or `.kiro-tracking/`, and named mechanisms like HARD GATE,
      MARKER FILE, CASE A1) rather than only banning example sentence
      phrasings. Content-based bans generalize past the exact wording
      of any one leak; phrase-based bans only cover what's on the list.
- [x] **Built and verified what's actually verifiable from this
      session:** the sentence is present, unique, reads clearly on
      direct read-back, JSON stays valid, and every internal
      file/mechanism name referenced in the new sentence was checked
      against the real prompt/repo to confirm none are stale or
      misspelled.
- [x] **Stated plainly, not glossed over: "build and test — confirm a
      real response comes back clean" could only be half done from
      here.** Built: yes. Live-verified with a real Kiro response: NO
      — this Claude Code session has no mechanism to drive Kiro's own
      agent and observe a real turn's output. Every confirmed finding
      and fix tonight that touched agent *behavior* (not command-hook
      logic) was verified by the user running a real turn and pasting
      the transcript back — that's the only verification path that
      exists for this category of change, named explicitly rather than
      faked. Also named honestly: unlike tonight's other fixes, this
      one has no deterministic fallback available at all — Kiro's hook
      system (per this project's own understanding of its documented
      trigger types) has no output-filtering or post-response hook, so
      there is no code-enforced version of "never mention this
      filename" the way there was for "never skip this file write."
- **Awaiting a real live transcript to confirm — not claiming this is
  closed.**

## 2026-09-02 (same day, follow-up): wording fix confirmed NOT effective (3/3 skips) + a real blind spot found in the time-window confidence check
- [x] **Narration fix confirmed working, cleanly, by a real transcript
      — no internal file/rule names anywhere.** Good, real result, not
      re-litigated here.
- [x] **Same transcript surfaced a THIRD live ask-skip occurrence — and
      the wording fix (`f937afa`, `11:35:59 IST`) was confirmed active
      on disk 18+ minutes before this episode's baseline was written
      (`11:54:26 IST`).** Not a case of testing against stale
      instructions. **The wording fix is now confirmed NOT effective:
      3/3 confirmed skips, with the fix demonstrably active for the
      third.** Stated plainly rather than left as "inconclusive with
      one data point."
- [x] **`Kiro-Confidence` checked with real evidence, not
      speculation:** no commit existed yet for the episode in question
      — made a real test commit (`4085b0e`) against it. Result:
      `Kiro-Confidence: low`, `Kiro-Credits: 0.0000`,
      `Kiro-Elapsed-Minutes: 2.95`. The deterministic elapsed-time
      check does correctly catch this specific, immediate case.
- [x] **A real, newly-discovered blind spot in that same check, not
      just a known limitation restated:** `Kiro-Confidence`'s
      elapsed-since-baseline logic (`.githooks/pre-commit`) is a
      rolling time window, not a permanent record. A commit made more
      than ~5 minutes after this same, never-honestly-confirmed
      baseline was written will very likely read `Kiro-Confidence:
      high` — purely because enough time passed, with zero
      relationship to whether the ask ever happened. **This is worse
      than the original ask-skip going silently uncaught: it's false
      confidence being actively presented about stale data**, on a
      delay, not a limitation someone reading the trailers would
      already know to discount.
- [x] **Investigated, honestly, whether existing marker-file behavior
      (created and properly consumed, vs. left behind) is a usable
      signal for "was the ask actually observed to complete" — found
      it is NOT, with real evidence, not assumed to work.** Checked
      `.kiro/pending-baseline-confirm.json` for the CURRENT episode
      (the one just confirmed to have skipped its ask): **absent** —
      cleaned up despite the skip. Compare against the earlier
      2026-09-02 finding ("a THIRD marker-related failure variant"),
      where the marker WAS left behind (with a stale, mismatched
      ticket_id) after a different skipped-ask occurrence. **Two
      confirmed instances of the same underlying failure produced
      opposite marker-cleanup outcomes** — the agent's own prose-driven
      marker deletion is inconsistent across occurrences, so "was the
      marker properly consumed" cannot be trusted as the signal on its
      own. This finding is what actually shaped the proposal below —
      not assumed away, investigated first as explicitly instructed.
- **Priority proposal, not a hold item, written immediately below —
  the confidence flag's blind spot means the system can currently
  present false confidence in stale data, worse than the original
  problem being silently uncaught.**
- [x] **Proposal written:** `docs/kiro-confirmed-persistent-signal-
      proposal.md` — not a rolling time window, a permanent,
      once-computed fact per episode (`Kiro-Confirmed: true/false/n/a`),
      built on a timestamp delta between candidate-detection (already
      reliable, command-hook-only) and baseline-write
      (`episode_started_at`, already accurate) — NOT on marker-cleanup
      behavior, which the investigation above just showed is
      inconsistent. Also updates the earlier, now-superseded
      confidence-flag sketch (`docs/case-a1-ask-skip-mitigation-
      proposal.md`, item 2) to point to this one. Not built — proposed
      as priority, per explicit instruction, awaiting review.

## 2026-09-02 (same day, follow-up): Kiro-Confirmed built and live-tested, one real jq bug caught by the build's own test and fixed before shipping
- [x] **Reviewer asked two questions before final approval — both
      answered with real investigation, not reassurance, before
      building:** (1) threshold calibration — revised to ship
      `Kiro-Confirmed-Gap-Seconds` unconditionally (the raw fact, never
      wrong) alongside a `Kiro-Confirmed` boolean using a named,
      tunable, explicitly-`PROVISIONAL` constant (15s, seeded from this
      session's real observed turn timings), with calibration named as
      a defined follow-up using the same "confirmed live" evidence
      standard as every other bug tonight — not a permanent guess. (2)
      `calculate-pr-credits.sh` — confirmed by direct grep it's the
      only script anywhere that reads `Kiro-*` trailers, and didn't
      touch `Kiro-Confirmed` before this build; extended it using this
      project's own already-proven presence-sentinel pattern (`Kiro-
      Elapsed-Minutes`'s `ELAPSED_PRESENT`), not a new one.
- [x] **Built, 5 sites, each verified individually:**
      `scripts/ticket-gate-fastpath.sh` (3 candidate-detection-log
      writes, agent-invisible — reusing the exact points already
      proven for the marker fix; one compute-and-cache block at
      `CURRENT_TRACKED_TICKET`), `.githooks/pre-commit` (read + pass to
      `commit-msg`), `.githooks/commit-msg` (two new trailers),
      `scripts/calculate-pr-credits.sh` (ticket-level aggregation).
- [x] **A real bug caught by this build's own end-to-end test, not
      shipped blind:** the first real commit through the whole pipeline
      showed `Kiro-Confirmed: n/a` for a case that should have read
      `false`. Root cause: `jq -r '.ask_confirmed // empty'` — jq's `//`
      treats a JSON `false` as falsy, identical to `null`, silently
      collapsing the one value this entire feature exists to surface
      into a false "n/a". The exact class of bug this project's own
      `Kiro-Credits`/`Kiro-Elapsed-Minutes` "null"-literal convention
      already exists to avoid — missed on the first pass for a boolean
      specifically, caught by the real test rather than assumed
      correct, fixed with an explicit `if .ask_confirmed == null`
      check instead of `//`, re-verified with the same real commit
      pipeline afterward.
- [x] **Live-tested, real commits and real trailers throughout, not
      simulated output:**
      1. Genuine gap (60s) → `Kiro-Confirmed: true`,
         `Kiro-Confirmed-Gap-Seconds: 60`, real commit.
      2/6. **Same-turn write, replaying the actual 3rd occurrence** →
         `Kiro-Confirmed: false` — this is the exact case that caught
         the jq bug above; failed on the first attempt, fixed, passed
         on the second, both against real commits.
      3. No detection-log entry at all (simulating CASE C1/PRIORITY
         CHECK) → `Kiro-Confirmed: n/a`, `Kiro-Confirmed-Gap-Seconds:
         n/a` — no crash, no false classification.
      4. Multiple episodes, same ticket, one entry backdated to 2020 →
         correctly matched the recent entry (3.0s gap), not the
         6-year-old one.
      5. Second commit against the same episode after tampering with
         the detection log → value unchanged, confirmed cached not
         recomputed.
      7. Gap-seconds confirmed correct in both the true and false
         cases above.
      8. `calculate-pr-credits.sh`, 4 real tickets via real (fabricated
         trailer) commits: single-episode `true` → `confirmed`;
         single-episode `false` → `UNCONFIRMED baseline` surfaced
         explicitly; no `Kiro-Confirmed` trailer at all → `confirmed:
         n/a`, distinct from both, exactly what was asked to be
         confirmed; two episodes on one ticket, one true one false →
         `false` correctly wins and surfaces prominently, not averaged
         or hidden.
- **All 8 test-plan cases pass (after the one real fix found and
  applied mid-testing). Real repo state (`ANG-123`, git log) confirmed
  unchanged throughout — all testing done in isolated scratch repos.**

## 2026-09-02 (same day, follow-up): three distinct real findings from one transcript — uncommitted-work gate confirmed working, a new missing-flag/garbled-input symptom, and Kiro-Confirmed's named CASE C1 gap manifesting for real
- [x] **Good news, confirmed with real evidence:** the uncommitted-work
      gate fired correctly, live, for the first time —
      `hook_status=uncommitted-work-gate-blocked ts=2026-09-02T06:59:31Z
      site=fastpath-c2`, matching the transcript's block message
      exactly (the dirty files listed are tonight's own real pending
      work).
- [ ] **New, separate, serious finding: the agent's own `git commit`
      call omitted `KIRO_AGENT_COMMIT=1`, despite its visible response
      explicitly claiming to follow the mandatory confirm-first
      process** (`"Confirming: the user replied '...' before I
      proceed"` — the tripwire line existed, the flag on the actual
      command did not). Confirmed directly: `hook-health.log` has no
      `pre-commit-refresh-confirmed-via-chat` line for this commit
      (`ad9d497`, `07:03:20Z`) — it fell through to `pre-commit`'s real
      TTY interactive path instead (which logs nothing when answered
      within its timeout), which is why real terminal prompts appeared
      in the transcript at all. Something then answered those prompts
      with a **garbled value** — `New ticket ID (or 'none'): ANG-12
      4571` instead of a clean `ANG-4571`.
- [x] **Investigated as far as this session can go — a real limit,
      stated honestly, not guessed past.** `aidlc-git-conventions.md`'s
      "MANDATORY FIRST STEP, NO EXCEPTIONS" wording for exactly this
      rule is already about as strong as anything in this project and
      still failed — the same reliability ceiling as every other
      skipped-step finding tonight, now in a new shape (an omitted env
      var rather than a skipped step). The garbled ticket-ID value has
      no available explanation from this session — no visibility into
      Kiro's actual terminal-execution plumbing exists here. Logged
      as unexplained, not diagnosed, rather than inventing a mechanism.
- [x] **Direct confirmation, with real evidence, of the exact coverage
      gap `docs/kiro-confirmed-persistent-signal-proposal.md` already
      named as open:** the transcript's switch confirmation ("yes")
      went straight from reading `current-ticket.json` to running the
      credit-read command — the same shape as all three CASE A1
      occurrences, but this is CASE C1. Checked directly:
      `current-ticket.json` for this exact episode
      (`ep_6a97cace208839`, `ANG-4571`) has **no** `ask_confirmed` or
      `ask_confirmed_gap_seconds` fields at all — a commit against it
      right now would read `Kiro-Confirmed: n/a`, not `false`. The
      named-but-theoretical gap manifested for real, on the very next
      real use after shipping.
- **Approved to act on: extend `Kiro-Confirmed` to cover CASE C1 (build
  below). The missing-flag/garbled-input finding is logged as a real,
  separate, open item — investigation hit this session's real limit,
  not resolved.**
- [x] **Built: `Kiro-Confirmed` extended to CASE C1**, reusing the
      already-existing, already-proven C2 detection point in `scripts/
      ticket-gate-fastpath.sh` (the same `HAS_DIFFERENT_TICKET` check
      that already drives the uncommitted-work dirty-gate) rather than
      adding a new one — one `candidate-detection-log.jsonl` write,
      unconditional, before the dirty-check that might otherwise block
      the turn. No agent hook prompt changes needed — CASE C1 already
      reads a reliable `pending_switch_to` field for the ticket ID
      itself; the detection log stays entirely agent-invisible, same
      as the CASE A1 version.
- [x] **Live-tested in an isolated scratch repo, real file state
      checked after each:**
      1. **Direct replay of the real transcript's shape** — C2 detects
         `ANG-4571` while `ANG-123` is tracked, logged; ask skipped
         (12s to write, matching the real gap order of magnitude) →
         `Kiro-Confirmed: false`, correctly computed — this exact
         scenario was `n/a` (invisible) before this extension, now
         caught.
      2. Genuine 60s C1 wait → `Kiro-Confirmed: true`.
      3. CASE A1 confirmed unaffected — a fresh exact-match candidate
         still logs and computes normally (30s gap → `true`).
      4. The log-write confirmed unconditional — fires even on a turn
         where the dirty-files gate itself blocks and re-asks, not
         only on a clean turn (caught during setup, not a separate
         planned case, but real evidence of the intended behavior).
- **Real repo state (`ANG-4571`, `ep_6a97cace208839`, git log)
  confirmed unchanged throughout — all testing done in an isolated
  scratch repo. Not committed yet.**

## 2026-09-02 (same day, follow-up): PRIORITY CHECK root cause fixed — a design gap, not another prose-reliability instance
- [x] **Live state corrected first, per explicit instruction:**
      `current-ticket.json` had `ticket_id: "ANG-4571"` when the user
      had actually typed `ANG-123` — re-ran the real deterministic
      credit-read command with the correct ticket_id before
      investigating further, so tracking stopped being misattributed
      immediately.
- [x] **Root cause traced to exact instruction text, not inferred —
      this is a design gap, not a compliance failure.** PRIORITY CHECK
      states plainly: *"runs BEFORE everything else... on every single
      user message, regardless of what the message is about"* and
      *"validating a flagged ticket takes priority over answering the
      request."* It has no case for "the current message is itself a
      different, valid ticket-ID answer" — that scenario gets the same
      treatment as genuinely unrelated chat. Confirmed by the tool
      calls themselves: `getJiraIssue` was called once, for the STALE
      `ANG-4571`; no validation call for `ANG-123` exists anywhere —
      it was never considered, not skipped by mistake.
- [x] **A contributing factor also found and fixed:** `.githooks/
      post-checkout` only ever cleared `current-ticket.json` on a
      branch switch, never `pending-ticket-check.json` or `pending-
      baseline-confirm.json` — letting a stale `typed_ticket` outlive
      the branch context it was created in and collide with a
      genuinely new one later.
- [x] **Built, three coordinated pieces, each verified individually:**
      1. `.githooks/post-checkout` — now also clears both pending
         marker files on a real branch switch.
      2. `scripts/ticket-gate-fastpath.sh` — deterministic fix, same
         proven pattern as the earlier stale-`pending-baseline-
         confirm.json` fix: before standing down for a pending
         `typed_ticket`, check whether the CURRENT message is itself a
         different, ticket-shaped candidate; if so, discard the stale
         file and fall through to normal candidate detection instead
         of validating the old value.
      3. `aidlc-ask-for-ticket-if-missing.json` — the same carve-out
         added to PRIORITY CHECK's own agent-side instruction, covering
         the case the command hook can't reach at all (`ticket_id`
         non-empty, where the fast-path exits via `CURRENT_TRACKED_
         TICKET` before ever examining `pending-ticket-check.json`).
- [x] **Live-tested, real file state after every case:**
      1. **Exact replay of the real incident** — stale `typed_ticket:
         "ANG-4571"`, current message `"ANG-123"`: stale file
         discarded, `pending-baseline-confirm.json` correctly shows
         `ANG-123`, and — as a direct side effect of falling through
         to normal detection — `candidate-detection-log.jsonl` now
         also has a real entry, closing part of the `Kiro-Confirmed`
         coverage gap for this path too, not just the wrong-ticket bug.
      2. Message matches the pending value → stands down unchanged,
         `pending-ticket-check.json` untouched.
      3. Message isn't ticket-shaped at all (unrelated chat) → stands
         down unchanged, same as before this fix.
      4. **Full end-to-end replay through to a completed baseline:**
         `current-ticket.json` correctly shows `ticket_id: "ANG-123"`
         (not `ANG-4571`) with real `ask_confirmed`/`ask_confirmed_
         gap_seconds` data populated — the wrong-ticket bug and the
         `Kiro-Confirmed` blind spot for this exact scenario both
         closed by the same fix.
- **Real repo state (`ANG-123`, corrected baseline, git log) confirmed
  unchanged by testing — all testing done in isolated scratch repos.
  Not committed yet.**

## 2026-09-02 (same day, follow-up): candidate-detection-log.jsonl gitignored + pruned, and found it had already been committed for real
- [x] **Checked before assuming a pattern to copy — `hook-health.log`
      has the identical gap.** Grepped all 13 append points across
      every hook: zero rotation/truncation/pruning logic anywhere in
      this project for ANY log file. Nothing to match; a new design was
      needed, reasoned from this specific log's use rather than
      copying something that doesn't exist.
- [x] **Design: age-based pruning is provably safe for this specific
      log, not just convenient.** It only ever answers "most recent
      detection for this ticket at or before this baseline's
      timestamp" — a real gap is always seconds to minutes. An entry
      older than 24h can never be that answer, so dropping it can only
      push a borderline case toward `n/a` (safe, honest "don't know"),
      never hide a real `false` skip, which is always same-turn by
      definition. A 1000-line cap added as a backstop for a busy
      window, not the primary mechanism.
- [x] **Built and live-tested, real file state after each case:**
      1. A fresh recent entry survives pruning; a 2020-dated entry and
         a malformed (`not even json`) line are both correctly dropped.
      2. 1500 synthetic entries, all within the 24h window → correctly
         capped at exactly 1000, keeping the most recent, not the
         oldest (first test attempt used an invalid ticket ID format
         and silently triggered nothing — caught and corrected before
         concluding the cap didn't work).
      3. One shared `prune_candidate_detection_log()` function, called
         after each of the script's 4 append points — not duplicated 4
         times, not run unconditionally on every turn.
- [x] **`.gitignore` updated — and a real, worse-than-expected finding
      along the way:** the file wasn't just missing from `.gitignore`,
      it had already been committed for real, by the live session's
      own `git add .`, in commit `28ee3ed` — confirmed directly via
      `git log --all -- .kiro/candidate-detection-log.jsonl`. Added the
      `.gitignore` entry (won't prevent past history, only future
      `git add`s) AND ran `git rm --cached` to actually untrack it
      going forward — the file itself stays on disk, unaffected;
      only git's index entry is removed. The historical commit still
      contains a snapshot of it — not rewriting history to remove that
      without being asked.
- [x] **Real, organic confirmation the whole `Kiro-Confirmed` pipeline
      is now working correctly in live use, found while checking repo
      state, not staged as a test:** the live session's own most recent
      real commit (`28ee3ed`) shows `Kiro-Confirmed-Gap-Seconds: 54`,
      `Kiro-Confirmed: true` — a genuine ask-and-wait cycle, correctly
      measured and recorded, in production, without being prompted.
- **Not committed yet — `.gitignore`, `scripts/ticket-gate-fastpath.sh`,
  and the `git rm --cached` staging are all sitting in the working
  tree/index for review.**

## 2026-09-04: consolidated bug report review — Bug 1's pending hygiene fix committed, plus one more gitignore gap found the same way
- [x] **A second real instance of the exact same omission class,
      found while reviewing Bug 1 for a consolidated report, not
      staged as a new test:** `.kiro/pending-session-greeting.json`
      (added 2026-09-02 alongside the session-start-greeting-exception
      feature) was sitting on disk from a real live session,
      untracked but NOT in `.gitignore` — same accidental-commit risk
      `candidate-detection-log.jsonl` already hit for real. Added to
      `.gitignore` now, same commit as the already-tested
      `candidate-detection-log.jsonl` fix above.
- [x] **Committed for real** — see commit trailers for the real
      episode/credit values this landed under.

## 2026-09-04 (same day, follow-up): Bug 2 root-caused (not a sync issue), Bug 4 designed+built+tested, Bug 3 confirmed genuinely blocked
- [x] **Bug 2 (cloudId guessing, reproduced in HCM-ALCS-BE-AIDLC-TEST)
      conclusively ruled OUT as a copy/deployment issue, with real
      evidence, not assumption.** Found the real, Kiro-IDE-opened clone
      at `/home/srimathi/HCM-ALCS-BE-AIDLC-TEST` (separate from an
      earlier, never-opened `/tmp` scratch copy). Diffed its actual
      `aidlc-ask-for-ticket-if-missing.json` against `v1`'s: byte sizes
      differed (41533 vs 41080), but `json.load(...) == json.load(...)`
      came back `True` — the only difference was `—` vs a literal
      UTF-8 em-dash, pure re-serialization, zero content difference.
      The "call getAccessibleAtlassianResources first" instruction is
      present, correctly worded, 4 times, identically in both. **This
      is a genuine new occurrence of the same prose-reliability failure
      as Bugs 1 and 3, not a sync bug.**
- [x] **Bug 3 (reasoning-vs-output divergence) — searched the FULL
      session transcript file (7.6MB, not just current context) for
      the exact quoted phrase ("I should NOT ask the ticket question").
      Found it in exactly two places: the bug report itself and the
      user's own follow-up message quoting it back — no earlier
      occurrence with an actual reasoning trace + response pair exists
      anywhere in this session.** Reported this plainly rather than
      fabricating or reconstructing a transcript from the description.
      Confirmed by the user: this is real evidence from elsewhere (a
      Kiro chat transcript, not this session) that hasn't been pasted
      yet. **Stays blocked, by explicit agreement, until the user
      pastes it — not guessed at.**
- [x] **Bug 4 (Jira-unavailable fallback) — instruction gap confirmed
      real via direct file inspection of `HEAD`'s shipped text** (no
      live transcript exists for this one; user confirmed this and
      explicitly approved proceeding on file-evidence alone). All three
      fallback sites (PRIORITY CHECK, CASE A1, CASE C1) lumped "network
      error, timeout, ambiguous response" into one bucket with no
      separate case for "the tool itself is structurally unavailable."
- [x] **Proposal written:** `docs/jira-unavailable-hard-stop-
      proposal.md` — option 1 (wording split: structural unavailability
      of getAccessibleAtlassianResources itself → HARD STOP; a single
      lookup's own transient failure → unchanged) + option 2 (new
      `Kiro-Jira-Validated` trailer, same true/false/n/a architecture as
      `Kiro-Confirmed`, honestly caveated as agent-written and NOT
      command-hook-derived — no MCP visibility exists at that layer).
- [x] **Built, 4 files:** `aidlc-ask-for-ticket-if-missing.json` (3
      fallback sites split, 3 baseline-write commands extended with
      `jira_validation_status`), `.githooks/pre-commit` (reads the new
      field), `.githooks/commit-msg` (maps
      validated/skipped_transient/other → true/false/n/a, emits the
      trailer), `scripts/calculate-pr-credits.sh` (presence-sentinel +
      per-ticket "any false wins" aggregation, same pattern as
      `Kiro-Confirmed`).
- [x] **A real self-inflicted bug caught and fixed mid-build, not
      shipped blind:** an early batch text-replacement script (fixing
      one JSON-escaping mistake in a freshly-inserted quote) matched 12
      occurrences of a 3-backslash+quote pattern, not the 2 intended —
      10 were PRE-EXISTING, correct escapings of embedded shell-command
      quotes elsewhere in the same file (e.g. inside the `sqlite3`
      python one-liners). Caught by decoding and diffing against `HEAD`
      before proceeding further, not by inspection alone; reverted to
      `HEAD`, redid the 2 intended edits with precise, verified
      backslash counts this time, confirmed via `content.count(bad3)`
      still reads 10 (unchanged) afterward.
- [x] **Live-tested, 5/5, real commits in an isolated scratch repo,
      real trailers checked after each:** `jira_validation_status`
      of `validated` → `Kiro-Jira-Validated: true`;
      `skipped_transient` → `false`; `none` → `n/a`; field missing
      entirely (old-style baseline) → `n/a`; two episodes on one
      ticket, one true one false → `calculate-pr-credits.sh` correctly
      surfaces `JIRA VALIDATION SKIPPED`, the false wins, not averaged
      or hidden — same aggregation contract as `Kiro-Confirmed`.
- **Honest limit, stated plainly, not glossed over: only the plumbing
  is tested. Whether the new HARD STOP wording actually fires on a
  real structural-unavailability turn is untestable from this
  session — no way to drive a real Kiro chat turn — flagged as
  "awaiting a real live transcript," not claimed passing.**
- **Real repo state confirmed unaffected throughout — all testing in
  an isolated scratch repo under `/tmp`. Approved to commit.**
