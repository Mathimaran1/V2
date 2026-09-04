import { CheckCircle, ChevronDown, ChevronUp, Copy, ExternalLink, Info } from 'lucide-react';
import { useState } from 'react';
import Avatar from '@/components/shared/Avatar';
import { relativeTime } from '@/services/utils';
import type { Commit } from '@/types';

interface CommitsPanelProps {
  commits: Commit[];
}

export default function CommitsPanel({ commits }: CommitsPanelProps) {
  const [expandedHash, setExpandedHash] = useState<string | null>(null);

  const toggleExpand = (hash: string) => {
    setExpandedHash(prev => prev === hash ? null : hash);
  };

  return (
    <div className="panel-commits">
      <table className="data-table commits-table" aria-label="Commits">
        <thead>
          <tr>
            <th>Commit hash</th>
            <th>Message</th>
            <th>Branch</th>
            <th>Author</th>
            <th>Change size</th>
            <th>Confidence</th>
            <th>Timestamp</th>
            <th aria-hidden="true"></th>
          </tr>
        </thead>
        <tbody>
          {commits.map(commit => (
            <>
              <tr
                key={commit.hash}
                className={`table-row-clickable ${expandedHash === commit.hash ? 'expanded' : ''}`}
                onClick={() => toggleExpand(commit.hash)}
                aria-expanded={expandedHash === commit.hash}
              >
                <td className="cell-hash">{commit.shortHash}</td>
                <td className="cell-summary">{commit.subject.length > 40 ? commit.subject.slice(0, 40) + '...' : commit.subject}</td>
                <td className="cell-branch">{commit.branch}</td>
                <td className="cell-author">
                  <div className="assignee-cell">
                    <Avatar name={commit.author.name} size={24} />
                    <span>{commit.author.name}</span>
                  </div>
                </td>
                <td className="cell-change-size">
                  <span className="additions">+{commit.additions}</span>
                  <span className="deletions">−{commit.deletions}</span>
                </td>
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
                  <td colSpan={8}>
                    <div className="commit-detail">
                      <table className="detail-table">
                        <tbody>
                          <tr>
                            <th scope="row">Full commit hash</th>
                            <td className="cell-hash-full">
                              {commit.hash}
                              <button
                                className="copy-btn"
                                onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(commit.hash); }}
                                aria-label="Copy full hash"
                              >
                                <Copy size={14} />
                              </button>
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Repository name</th>
                            <td className="cell-link">{commit.repositoryName}</td>
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
                            <th scope="row">Commit message</th>
                            <td className="cell-message-full">
                              {commit.body.split('\n').map((line, i) => (
                                <div key={i}>{line || '\u00A0'}</div>
                              ))}
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Files changed</th>
                            <td>
                              <div className="files-list">
                                {commit.filesChanged.slice(0, 6).map(f => (
                                  <div key={f} className="file-item">{f}</div>
                                ))}
                                {commit.filesChanged.length > 6 && (
                                  <button className="show-more-btn">+{commit.filesChanged.length - 6} more files</button>
                                )}
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">Secret scan status</th>
                            <td>
                              <div className="secret-scan-clean">
                                <CheckCircle size={16} />
                                <span>No secrets found</span>
                              </div>
                            </td>
                          </tr>
                          <tr>
                            <th scope="row">View full commit</th>
                            <td>
                              <a href="#" className="external-link" target="_blank" rel="noopener noreferrer">
                                View in AWS CodeCommit <ExternalLink size={14} />
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
