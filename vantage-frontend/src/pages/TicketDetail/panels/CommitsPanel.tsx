import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Copy, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import EmptyState from '@/components/shared/EmptyState';
import { relativeTime, timestampMs } from '@/services/utils';
import type { CommitRecord } from '@/types';

interface CommitsPanelProps {
  commits: CommitRecord[];
}

const JIRA_VALIDATED_TOOLTIP =
  '"Yes" = this ticket was confirmed real against live Jira at commit time. ' +
  '"No" = validation was attempted but did not succeed (e.g. Jira was unreachable, or the check was skipped). ' +
  '"N/A" = this commit predates this tracking field being added to the project.';

type ConfidenceFilter = 'all' | 'high' | 'low';
type JiraValidatedFilter = 'all' | 'yes' | 'no' | 'n/a';

function jiraValidatedLabel(value: boolean | null): 'Yes' | 'No' | 'N/A' {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'N/A';
}

// AWS CodeCommit's GetCommit has no diff-stats, branch, or secret-scan
// concept exposed through the API (see services/codecommit_service.py's
// module docstring) — so unlike the richer mock Commit shape this real
// data doesn't carry additions/deletions, branch, filesChanged, or
// secretScanStatus at all. Those columns/rows are dropped below rather
// than filled with fabricated zeros or a fake "clean" status.
export default function CommitsPanel({ commits }: CommitsPanelProps) {
  const [expandedHash, setExpandedHash] = useState<string | null>(null);
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>('all');
  const [jiraValidatedFilter, setJiraValidatedFilter] = useState<JiraValidatedFilter>('all');
  // The backend returns commits oldest-first (see duckdb_service.py's
  // get_commits_for_ticket — it walks CodeCommit newest->oldest from
  // HEAD then reverses, to match the real API's own convention), so
  // without a real sort here the most recent work is buried at the
  // bottom of a long ticket's commit list. Defaulting to descending
  // (most recent first) instead — same "highest/most-relevant first"
  // default already used for Users page's credit columns.
  const [timestampSortDirection, setTimestampSortDirection] = useState<'asc' | 'desc'>('desc');

  const filteredCommits = useMemo(() => {
    return commits.filter(commit => {
      if (confidenceFilter !== 'all' && commit.kiroConfidence !== confidenceFilter) return false;
      if (jiraValidatedFilter !== 'all' && jiraValidatedLabel(commit.kiroJiraValidated).toLowerCase() !== jiraValidatedFilter) return false;
      return true;
    });
  }, [commits, confidenceFilter, jiraValidatedFilter]);

  const sortedCommits = useMemo(() => {
    const dir = timestampSortDirection === 'asc' ? 1 : -1;
    return [...filteredCommits].sort((a, b) => (timestampMs(a.timestamp) - timestampMs(b.timestamp)) * dir);
  }, [filteredCommits, timestampSortDirection]);

  if (commits.length === 0) {
    return <EmptyState title="No commits found for this ticket" />;
  }

  const toggleExpand = (hash: string) => {
    setExpandedHash(prev => prev === hash ? null : hash);
  };

  return (
    <div className="panel-commits">
      <div className="filter-bar">
        <select
          className="filter-select"
          value={confidenceFilter}
          onChange={e => setConfidenceFilter(e.target.value as ConfidenceFilter)}
          aria-label="Filter by confidence"
        >
          <option value="all">Confidence: All</option>
          <option value="high">Confidence: High</option>
          <option value="low">Confidence: Low</option>
        </select>
        <select
          className="filter-select"
          value={jiraValidatedFilter}
          onChange={e => setJiraValidatedFilter(e.target.value as JiraValidatedFilter)}
          aria-label="Filter by Jira ticket validated"
        >
          <option value="all">Jira ticket validated: All</option>
          <option value="yes">Jira ticket validated: Yes</option>
          <option value="no">Jira ticket validated: No</option>
          <option value="n/a">Jira ticket validated: N/A</option>
        </select>
      </div>

      {filteredCommits.length === 0 ? (
        <EmptyState title="No commits match the selected filters" />
      ) : (
      <table className="data-table commits-table" aria-label="Commits">
        <thead>
          <tr>
            <th>Commit hash</th>
            <th>Message</th>
            <th>Author</th>
            <th>Confidence</th>
            <th
              className="th-sortable"
              aria-sort={timestampSortDirection === 'asc' ? 'ascending' : 'descending'}
            >
              <button
                className="th-sort-btn"
                onClick={() => setTimestampSortDirection(d => (d === 'asc' ? 'desc' : 'asc'))}
              >
                Timestamp
                {timestampSortDirection === 'asc'
                  ? <ArrowUp size={13} className="th-sort-icon" />
                  : <ArrowDown size={13} className="th-sort-icon" />}
              </button>
            </th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {sortedCommits.map(commit => (
            <>
              <tr
                key={commit.hash}
                className={`table-row-clickable ${expandedHash === commit.hash ? 'expanded' : ''}`}
                onClick={() => toggleExpand(commit.hash)}
                aria-expanded={expandedHash === commit.hash}
              >
                <td className="cell-hash">{commit.hash}</td>
                <td className="cell-summary">{commit.subject.length > 40 ? commit.subject.slice(0, 40) + '...' : commit.subject}</td>
                <td className="cell-author">{commit.author}</td>
                <td>
                  {commit.kiroConfidence && (
                    <span className={`pill confidence-${commit.kiroConfidence}`}>
                      {commit.kiroConfidence === 'high' ? 'High' : 'Low'}
                    </span>
                  )}
                </td>
                <td className="cell-updated">{relativeTime(commit.timestamp)}</td>
                <td className="cell-chevron">
                  {expandedHash === commit.hash ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </td>
              </tr>
              {expandedHash === commit.hash && (
                <tr key={`${commit.hash}-detail`} className="expanded-row">
                  <td colSpan={6}>
                    <div className="commit-detail">
                      <table className="detail-table">
                        <tbody>
                          <tr>
                            <th scope="row">Full commit hash</th>
                            <td className="cell-hash-full">
                              {commit.fullHash}
                              <button
                                className="copy-btn"
                                onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(commit.fullHash); }}
                                aria-label="Copy full hash"
                              >
                                <Copy size={14} />
                              </button>
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Author email</th>
                            <td>{commit.authorEmail}</td>
                          </tr>
                          <tr>
                            <th scope="row">Full commit message</th>
                            <td className="cell-message-full">{commit.subject}</td>
                          </tr>
                          <tr>
                            <th scope="row">Kiro-Credits</th>
                            <td>
                              {commit.kiroCredits != null ? `${commit.kiroCredits} credits` : 'N/A'}
                              <span
                                className="stat-info-icon"
                                title="High confidence means the credit reading was recently refreshed. Low confidence means the number may be slightly out of date."
                              >
                                <Info size={14} />
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Kiro-Episode</th>
                            <td>{commit.kiroEpisode ?? 'N/A'}</td>
                          </tr>
                          <tr>
                            <th scope="row">Kiro-Session</th>
                            <td>{commit.kiroSession ?? 'N/A'}</td>
                          </tr>
                          <tr>
                            <th scope="row">
                              Jira ticket validated
                              <span className="stat-info-icon" title={JIRA_VALIDATED_TOOLTIP}>
                                <Info size={14} />
                              </span>
                            </th>
                            <td>{jiraValidatedLabel(commit.kiroJiraValidated)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
              )}
            </>
          ))}
        </tbody>
      </table>
      )}
    </div>
  );
}
