"""
Port of vantage-frontend/src/services/api.ts's computeCreditsUsed():
MAX-PER-EPISODE-THEN-SUM — group commits by Kiro-Episode, take the max
Kiro-Credits seen within each episode, then sum across episodes.

This is also the same two-step aggregation scripts/calculate-pr-credits.sh
implements for PR/range totals (see that file's own comments on why:
episodes can restart their credit baseline, so credits are cumulative
WITHIN an episode, not incremental across a whole ticket/PR).

A commit contributes to the total only if it has BOTH a real episode id
and a real numeric credits value. Trailers that are semantically absent
show up as the strings "none" / "n/a" (see commit-msg's own trailer
writer) rather than being omitted entirely — those must be treated as
null, exactly like the frontend's `Commit.kiroEpisode: string | null` /
`kiroCredits: number | null` typing already assumes.
"""

from __future__ import annotations


def compute_credits_used(commits: list[dict]) -> float:
    """
    commits: list of dicts with at least 'kiroEpisode' (str | None) and
    'kiroCredits' (float | None) keys — matching the shape
    codecommit_service.py produces.

    Mirrors api.ts's computeCreditsUsed exactly:

        for (const c of commits) {
          if (c.kiroEpisode && c.kiroCredits != null) {
            const current = episodeMaxMap.get(c.kiroEpisode) ?? 0;
            if (c.kiroCredits > current) episodeMaxMap.set(c.kiroEpisode, c.kiroCredits);
          }
        }
        let total = 0;
        for (const max of episodeMaxMap.values()) total += max;
        return Math.round(total * 100) / 100;
    """
    episode_max: dict[str, float] = {}

    for c in commits:
        episode = c.get("kiroEpisode")
        credits = c.get("kiroCredits")
        if episode and credits is not None:
            current = episode_max.get(episode, 0)
            if credits > current:
                episode_max[episode] = credits

    total = sum(episode_max.values())
    return round(total * 100) / 100


def jira_validation_summary(commits: list[dict]) -> str:
    """
    Same "false anywhere wins" rule as calculate-pr-credits.sh: a ticket's
    Jira-validation status is not per-commit, it's per-episode (cached
    once per episode) — so checking whether ANY commit for this ticket
    carries kiroJiraValidated == False is exactly equivalent to checking
    whether any episode's ticket association was never actually confirmed
    against Jira. A False anywhere wins over a True anywhere else,
    deliberately: a hidden unvalidated episode is worse than a validated
    one looking unremarkable.

    Returns one of: "false" (at least one episode not validated),
    "true" (all present values were true), "n/a" (no commit carried the
    trailer at all).
    """
    saw_false = False
    saw_true = False
    for c in commits:
        v = c.get("kiroJiraValidated")
        if v is False:
            saw_false = True
        elif v is True:
            saw_true = True

    if saw_false:
        return "false"
    if saw_true:
        return "true"
    return "n/a"
