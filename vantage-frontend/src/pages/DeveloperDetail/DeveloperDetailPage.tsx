import { ArrowLeft, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import Avatar from '@/components/shared/Avatar';
import StatusPill from '@/components/shared/StatusPill';
import { getMockDeveloperDetail } from '@/services/mockData';
import { formatTier, relativeTime, tierColor } from '@/services/utils';
import type { Commit } from '@/types';

export default function DeveloperDetailPage() {
  const { developerId } = useParams<{ developerId: string }>();
  const navigate = useNavigate();

  const detail = useMemo(() => getMockDeveloperDetail(developerId ?? ''), [developerId]);

  if (!detail) {
    return (
      <div className="page-developer-detail">
        <button className="back-link" onClick={() => navigate('/users')}>← Back to Users</button>
        <p>Developer not found.</p>
      </div>
    );
  }

  return (
    <div className="page-developer-detail">
      {/* Header */}
      <button className="back-link" onClick={() => navigate('/users')}>
        <ArrowLeft size={16} />
        Back to Users
      </button>

      <header className="developer-header">
        <Avatar name={detail.name} size={48} />
        <div>
          <h1 className="developer-name">{detail.name}</h1>
          <p className="developer-email">{detail.email}</p>
        </div>
      </header>

      {/* Summary row */}
      <div className="developer-summary-row">
        <span className="pill tier-pill" style={{ backgroundColor: tierColor(detail.tier), color: '#fff' }}>
          {formatTier(detail.tier)}
        </span>
        <span className="summary-item">Active since {new Date(detail.activeSince).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</span>
        <span className="summary-item">Last active {relativeTime(detail.lastActive)}</span>
      </div>

      {/* Stats strip */}
      <div className="stats-strip">
        <div className="stat-card">
          <div className="stat-label">Total credits used</div>
          <div className="stat-value">{detail.creditsUsed} <span className="stat-unit">credits</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            Coverage %
            <span
              className="stat-info-icon"
              title="Low coverage usually means tracking isn't set up correctly, not low usage"
            >
              <Info size={14} />
            </span>
          </div>
          <div className="stat-value">{detail.coveragePercent}%</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Tickets worked on</div>
          <div className="stat-value">{detail.ticketsWorkedOn}</div>
        </div>
      </div>

      {/* Credit usage trend chart */}
      <div className="chart-card">
        <h3 className="chart-title">Credit usage trend</h3>
        <ResponsiveContainer width="100%" height={240}>
          <AreaChart data={detail.creditHistory} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="creditGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#378ADD" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#378ADD" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 12, fill: '#6b7280' }}
              tickFormatter={v => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            />
            <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} />
            <Tooltip
              labelFormatter={v => new Date(v as string).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              formatter={(v: number) => [`${v} credits`, 'Credits']}
            />
            <Area type="monotone" dataKey="credits" stroke="#378ADD" fillOpacity={1} fill="url(#creditGradient)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Tickets table */}
      <div className="section-card">
        <h3 className="section-title">Tickets</h3>
        <table className="data-table" aria-label="Developer tickets">
          <thead>
            <tr>
              <th>Ticket ID</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Credits used</th>
              <th>Last commit</th>
            </tr>
          </thead>
          <tbody>
            {detail.tickets.map(t => (
              <tr
                key={t.ticketId}
                className="table-row-clickable"
                onClick={() => navigate(`/ticket/${t.ticketId}`)}
                role="link"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/ticket/${t.ticketId}`)}
              >
                <td className="cell-ticket-id">{t.ticketId}</td>
                <td>{t.summary}</td>
                <td><StatusPill status={t.status} /></td>
                <td>{t.creditsUsed} credits</td>
                <td className="cell-updated">{relativeTime(t.lastCommit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Recent commits */}
      <div className="section-card">
        <h3 className="section-title">Recent commits</h3>
        <RecentCommitsList commits={detail.recentCommits} />
      </div>
    </div>
  );
}

function RecentCommitsList({ commits }: { commits: Commit[] }) {
  const [expandedHash, setExpandedHash] = useState<string | null>(null);

  return (
    <div className="recent-commits">
      {commits.map(c => (
        <div key={c.hash} className="recent-commit-item">
          <div
            className="recent-commit-header table-row-clickable"
            onClick={() => setExpandedHash(prev => prev === c.hash ? null : c.hash)}
            aria-expanded={expandedHash === c.hash}
          >
            <span className="cell-hash">{c.shortHash}</span>
            <span className="recent-commit-subject">{c.subject}</span>
            <span className="cell-branch">{c.branch}</span>
            <div className="cell-change-size">
              <span className="additions">+{c.additions}</span>
              <span className="deletions">−{c.deletions}</span>
            </div>
            {c.kiroConfidence && (
              <span className={`pill confidence-${c.kiroConfidence}`}>
                {c.kiroConfidence === 'high' ? 'High' : 'Low'}
              </span>
            )}
            <span className="cell-updated">{relativeTime(c.timestamp)}</span>
            {expandedHash === c.hash ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </div>
          {expandedHash === c.hash && (
            <div className="recent-commit-detail">
              <table className="detail-table">
                <tbody>
                  <tr><th scope="row">Full hash</th><td className="cell-hash-full">{c.hash}</td></tr>
                  <tr><th scope="row">Repository</th><td>{c.repositoryName}</td></tr>
                  <tr><th scope="row">Credits</th><td>{c.kiroCredits ?? 0} credits</td></tr>
                  <tr><th scope="row">Files</th><td>{c.filesChanged.join(', ')}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
