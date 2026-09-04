import { Calendar, Download, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '@/components/shared/Avatar';
import Pagination from '@/components/shared/Pagination';
import { getMockDevelopers, getMockTierDistribution, getMockTopUsers } from '@/services/mockData';
import { formatTier, tierColor } from '@/services/utils';
import type { TierDistribution } from '@/types';

export default function UsersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const result = useMemo(
    () => getMockDevelopers({ page, pageSize, search, tier: tier === 'all' ? '' : tier }),
    [page, pageSize, search, tier],
  );

  const tiers = useMemo(() => getMockTierDistribution(), []);
  const topUsers = useMemo(() => getMockTopUsers(5), []);
  const distinctTiers = useMemo(() => tiers.map(t => t.tier), [tiers]);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  return (
    <div className="page-users">
      {/* Header */}
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Users / Developers</h1>
          <p className="page-subtitle">Monitor developer adoption, credit usage, and data coverage across your team.</p>
        </div>
        <div className="page-header-right">
          <button className="header-btn" aria-label="Date range">
            <Calendar size={16} />
            <span>May 11 – May 17, 2025</span>
          </button>
          <button className="header-btn" aria-label="Export">
            <Download size={16} />
            <span>Export</span>
          </button>
        </div>
      </header>

      {/* Filters */}
      <div className="filter-bar">
        <div className="search-input">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search developers by name..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            aria-label="Search developers"
          />
        </div>
        <select
          className="filter-select"
          value={tier}
          onChange={e => { setTier(e.target.value); setPage(1); }}
          aria-label="Filter by tier"
        >
          <option value="all">Tier: All</option>
          {distinctTiers.map(t => (
            <option key={t} value={t}>{formatTier(t)}</option>
          ))}
        </select>
        <select className="filter-select" aria-label="Filter by activity">
          <option value="all">Activity: Active last 30 days</option>
          <option value="7d">Active last 7 days</option>
          <option value="90d">Active last 90 days</option>
        </select>
        <select className="filter-select" aria-label="Filter by coverage">
          <option value="all">Coverage: All</option>
          <option value="high">High (80%+)</option>
          <option value="low">Low (&lt;50%)</option>
        </select>
      </div>

      <div className="users-layout">
        {/* Table */}
        <div className="users-table-section">
          <div className="table-container">
            <table className="data-table" aria-label="Developers">
              <thead>
                <tr>
                  <th>Developer name</th>
                  <th>Kiro tier</th>
                  <th>Credits used</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map(dev => (
                  <tr
                    key={dev.id}
                    className="table-row-clickable"
                    onClick={() => navigate(`/users/${dev.id}`)}
                    role="link"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && navigate(`/users/${dev.id}`)}
                  >
                    <td>
                      <div className="dev-name-cell">
                        <Avatar name={dev.name} size={28} />
                        <span className="cell-link">{dev.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="pill tier-pill" style={{ backgroundColor: tierColor(dev.tier), color: '#fff' }}>
                        {formatTier(dev.tier)}
                      </span>
                    </td>
                    <td className="cell-credits">
                      <span>{dev.creditsUsed} credits</span>
                      <span className={`trend-arrow ${dev.creditsTrend >= 0 ? 'trend-up' : 'trend-down'}`}>
                        {dev.creditsTrend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                        {Math.abs(dev.creditsTrend)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            totalPages={result.totalPages}
            total={result.total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </div>

        {/* Right sidebar */}
        <aside className="users-sidebar">
          <div className="sidebar-card">
            <h3 className="sidebar-card-title">Tier distribution</h3>
            <DonutChart tiers={tiers} total={result.total} />
          </div>

          <div className="sidebar-card">
            <h3 className="sidebar-card-title">Top users this period</h3>
            <div className="top-users-list">
              {topUsers.map((u, i) => (
                <div key={i} className="top-user-row">
                  <span className="top-user-name">{u.name}</span>
                  <span className="top-user-credits">{u.creditsUsed} credits</span>
                </div>
              ))}
            </div>
            <button className="view-all-link" onClick={() => { /* already on users page */ }}>
              View all users →
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function DonutChart({ tiers, total }: { tiers: TierDistribution[]; total: number }) {
  const size = 160;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = tiers.map(t => {
    const pct = t.count / total;
    const dashArray = `${pct * circumference} ${circumference}`;
    const dashOffset = -offset * circumference;
    offset += pct;
    return { ...t, dashArray, dashOffset };
  });

  return (
    <div className="donut-chart-container">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="donut-chart" aria-label="Tier distribution chart">
        {segments.map(seg => (
          <circle
            key={seg.tier}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={tierColor(seg.tier)}
            strokeWidth={strokeWidth}
            strokeDasharray={seg.dashArray}
            strokeDashoffset={seg.dashOffset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ))}
        <text x="50%" y="46%" textAnchor="middle" className="donut-center-number">{total}</text>
        <text x="50%" y="58%" textAnchor="middle" className="donut-center-label">Total users</text>
      </svg>
      <div className="donut-legend">
        {tiers.map(t => (
          <div key={t.tier} className="donut-legend-item">
            <span className="donut-legend-dot" style={{ backgroundColor: tierColor(t.tier) }} />
            <span>{formatTier(t.tier)}</span>
            <span className="donut-legend-count">{t.count} ({t.percentage}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}
