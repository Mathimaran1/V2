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
