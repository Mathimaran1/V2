import { CheckCircle, ChevronDown, ChevronUp, ExternalLink, Info, XCircle } from 'lucide-react';
import { useState } from 'react';
import Avatar from '@/components/shared/Avatar';
import EmptyState from '@/components/shared/EmptyState';
import { relativeTime } from '@/services/utils';
import type { PullRequest } from '@/types';

interface PullRequestsPanelProps {
  pullRequests: PullRequest[];
  commitCount: number;
}

export default function PullRequestsPanel({ pullRequests, commitCount }: PullRequestsPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (pullRequests.length === 0) {
    return (
      <EmptyState
        title="No pull request yet for this ticket"
        subtitle={`${commitCount} commit${commitCount !== 1 ? 's' : ''} found — a PR may still be in progress.`}
      />
    );
  }

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  return (
    <div className="panel-prs">
      <table className="data-table prs-table" aria-label="Pull requests">
        <thead>
          <tr>
            <th>PR ID</th>
            <th>Title</th>
            <th>Status</th>
            <th>Branches</th>
            <th>Author</th>
            <th>Review status</th>
            <th>Opened</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {pullRequests.map(pr => (
            <>
              <tr
                key={pr.id}
                className={`table-row-clickable ${expandedId === pr.id ? 'expanded' : ''}`}
                onClick={() => toggleExpand(pr.id)}
                aria-expanded={expandedId === pr.id}
              >
                <td className="cell-ticket-id">#{pr.id}</td>
                <td className="cell-summary">{pr.title}</td>
                <td>
                  <span className={`pill pr-status-${pr.status}`}>
                    {pr.status.charAt(0).toUpperCase() + pr.status.slice(1)}
                  </span>
                </td>
                <td className="cell-branches">
                  {pr.sourceBranch} → {pr.targetBranch}
                </td>
                <td className="cell-author">
                  <div className="assignee-cell">
                    <Avatar name={pr.author.name} size={24} />
                    <span>{pr.author.name}</span>
                  </div>
                </td>
                <td className="cell-review-status">
                  <div className="reviewer-avatars">
                    {pr.reviewers.map(r => (
                      <div key={r.person.email} className="reviewer-avatar-wrapper" title={`${r.person.name}: ${r.status}`}>
                        <Avatar name={r.person.name} size={24} />
                        <span className={`reviewer-status-dot reviewer-${r.status}`} />
                      </div>
                    ))}
                    {pr.reviewers.length > 2 && (
                      <span className="reviewer-more">+{pr.reviewers.length - 2}</span>
                    )}
                  </div>
                </td>
                <td className="cell-updated">{relativeTime(pr.opened)}</td>
                <td className="cell-chevron">
                  {expandedId === pr.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </td>
              </tr>
              {expandedId === pr.id && (
                <tr key={`${pr.id}-detail`} className="expanded-row">
                  <td colSpan={8}>
                    <div className="pr-detail">
                      <table className="detail-table">
                        <tbody>
                          <tr>
                            <th scope="row">Full PR description</th>
                            <td>{pr.description}</td>
                          </tr>
                          <tr>
                            <th scope="row">Reviewers</th>
                            <td>
                              <div className="reviewers-list">
                                {pr.reviewers.map(r => (
                                  <div key={r.person.email} className="reviewer-row">
                                    <Avatar name={r.person.name} size={28} />
                                    <span className="reviewer-name">{r.person.name}</span>
                                    <span className={`reviewer-status-label reviewer-${r.status}`}>
                                      {r.status === 'approved' && '✓ Approved'}
                                      {r.status === 'pending' && '○ Pending'}
                                      {r.status === 'changes-requested' && '✕ Changes requested'}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Commits in this PR</th>
                            <td>
                              {pr.commitCount} commits{' '}
                              <a href="#" className="external-link" onClick={e => e.stopPropagation()}>
                                View commits in Commits tab <ExternalLink size={14} />
                              </a>
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Files changed</th>
                            <td>
                              {pr.filesChanged} files changed{' '}
                              <span className="additions">+{pr.additions}</span>{' '}
                              <span className="deletions">−{pr.deletions}</span>
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Checks</th>
                            <td>
                              <div className="checks-section">
                                <div className="checks-summary">
                                  {pr.checks.filter(c => c.status === 'passed').length} / {pr.checks.length} passed
                                </div>
                                <div className="checks-progress-bar">
                                  <div
                                    className="checks-progress-fill"
                                    style={{ width: `${(pr.checks.filter(c => c.status === 'passed').length / pr.checks.length) * 100}%` }}
                                  />
                                  <div
                                    className="checks-progress-fail"
                                    style={{ width: `${(pr.checks.filter(c => c.status === 'failed').length / pr.checks.length) * 100}%` }}
                                  />
                                </div>
                                <div className="checks-list">
                                  {pr.checks.map(check => (
                                    <div key={check.name} className="check-item">
                                      {check.status === 'passed' ? (
                                        <CheckCircle size={16} className="check-passed" />
                                      ) : (
                                        <XCircle size={16} className="check-failed" />
                                      )}
                                      <span>{check.name}</span>
                                      <span className={`check-status-label check-${check.status}`}>
                                        {check.status.charAt(0).toUpperCase() + check.status.slice(1)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Kiro credits for this PR</th>
                            <td>
                              {pr.kiroCredits ?? 0} credits
                              <span
                                className="stat-info-icon"
                                title="Computed using max-per-episode-then-sum logic across this PR's commits"
                              >
                                <Info size={14} />
                              </span>
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">View in CodeCommit</th>
                            <td>
                              <a href={pr.codeCommitUrl} className="external-link" target="_blank" rel="noopener noreferrer">
                                View this pull request in AWS CodeCommit <ExternalLink size={14} />
                              </a>
                            </td>
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
    </div>
  );
}
