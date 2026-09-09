import { ArrowDown, ArrowUp, ArrowUpDown, Download, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Pagination from '@/components/shared/Pagination';
import { fetchDevelopers } from '@/services/api';
import { formatTier, tierColor } from '@/services/utils';
import type { Developer, TierDistribution } from '@/types';

type DaysWindow = 1 | 30 | 90;

// The only two numeric columns worth sorting by — credits for the
// selected period, and the all-time lifetime total. Defaults to
// lifetimeCreditsUsed descending so the top credit users lead the
// list out of the box (matches the backend's own default order —
// see get_developer_usage()'s docstring — this just makes that
// order a real, user-controllable sort instead of an implicit one).
type SortField = 'creditsUsed' | 'lifetimeCreditsUsed';
type SortDirection = 'asc' | 'desc';

// Real per-developer usage from S3, real date-range filtering, real
// lifetime totals — see backend/routes/developers.py and
// backend/services/s3_usage_service.py. Coverage-percent matching
// against CodeCommit is still computed for real in the backend
// response (see that route's docstring), just not rendered here right
// now — a deliberate, not a broken, removal (every developer's real
// coveragePercent is honestly null today; see the backend docstring
// for the full investigation of why).
export default function UsersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('all');
  const [days, setDays] = useState<DaysWindow>(30);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<SortField>('lifetimeCreditsUsed');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const [developers, setDevelopers] = useState<Developer[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDevelopers(null); // real refetch on period change — not a client-side re-slice of stale data
    setLoadError(null);
    fetchDevelopers(days)
      .then(res => { if (!cancelled) setDevelopers(res.developers); })
      .catch(err => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [days]);

  const distinctTiers = useMemo(() => {
    if (!developers) return [];
    return Array.from(new Set(developers.map(d => d.tier))).sort();
  }, [developers]);

  const filtered = useMemo(() => {
    if (!developers) return [];
    let items = developers;
    if (search) {
      const s = search.toLowerCase();
      items = items.filter(d => d.name.toLowerCase().includes(s) || d.email.toLowerCase().includes(s));
    }
    if (tier !== 'all') {
      items = items.filter(d => d.tier === tier);
    }
    return items;
  }, [developers, search, tier]);

  const sorted = useMemo(() => {
    const dir = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => (a[sortField] - b[sortField]) * dir);
  }, [filtered, sortField, sortDirection]);

  const handleSort = useCallback((field: SortField) => {
    // Deliberately NOT a setSortField(prev => ...) updater that calls
    // setSortDirection from inside it — StrictMode's dev-mode double
    // invocation of updater functions would then fire that nested
    // setSortDirection twice per click, toggling the direction there
    // and right back, so clicking an already-active header appeared to
    // do nothing. Reading sortField from the closure and branching here
    // instead means each setState call only ever runs once per click.
    if (sortField === field) {
      setSortDirection(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc'); // switching columns: start highest-first, same as the page's initial default
    }
    setPage(1);
  }, [sortField]);

  const total = sorted.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const pageItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, page, pageSize]);

  const tierDistribution: TierDistribution[] = useMemo(() => {
    if (!developers || developers.length === 0) return [];
    const counts = new Map<string, number>();
    for (const d of developers) counts.set(d.tier, (counts.get(d.tier) ?? 0) + 1);
    const totalDevs = developers.length;
    return Array.from(counts.entries()).map(([t, count]) => ({
      tier: t,
      count,
      percentage: Math.round((count / totalDevs) * 1000) / 10,
    }));
  }, [developers]);

  const topUsers = useMemo(() => {
    if (!developers) return [];
    // Ranked by the currently-selected period's creditsUsed, not
    // lifetime — "top users this period" should reorder when the
    // period changes, matching what the date selector implies.
    return [...developers].sort((a, b) => b.creditsUsed - a.creditsUsed).slice(0, 5);
  }, [developers]);

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
          <p className="page-subtitle">Monitor developer adoption and credit usage across your team.</p>
        </div>
        <div className="page-header-right">
          <button className="header-btn" aria-label="Export">
            <Download size={16} />
            <span>Export</span>
          </button>
        </div>
      </header>

      {loadError && (
        <div className="empty-state" style={{ margin: '16px 0' }}>
          <p><strong>Failed to load real developer data</strong></p>
          <p className="text-muted">{loadError}</p>
        </div>
      )}

      {!loadError && developers === null && (
        <p style={{ padding: '24px 0' }}>Loading real developer usage from S3…</p>
      )}

      {developers !== null && (
        <>
          {/* Filters */}
          <div className="filter-bar">
            <div className="search-input">
              <Search size={16} />
              <input
                type="text"
                placeholder="Search developers by name or email..."
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
            <select
              className="filter-select"
              value={days}
              onChange={e => {
                setDays(Number(e.target.value) as DaysWindow);
                // Re-rank by that period's usage, not whatever was
                // previously sorted (usually Lifetime, the page's
                // default — see handleSort's own comment). Leaving the
                // old sort in place after switching periods is how the
                // table ends up showing a 0-credit developer above one
                // with 359 credits at "Last 1 day": the row order was
                // still following lifetime rank, unrelated to the
                // period just selected — reads as the filter not doing
                // anything even though every number on the row is
                // real and did update.
                setSortField('creditsUsed');
                setSortDirection('desc');
                setPage(1);
              }}
              aria-label="Date range"
            >
              <option value={1}>Last 1 day</option>
              <option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option>
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
                      <th
                        className="th-sortable"
                        aria-sort={sortField === 'creditsUsed' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <button className="th-sort-btn" onClick={() => handleSort('creditsUsed')}>
                          Credits used ({days === 1 ? 'last 1 day' : `last ${days} days`})
                          <SortIcon active={sortField === 'creditsUsed'} direction={sortDirection} />
                        </button>
                      </th>
                      <th
                        className="th-sortable"
                        aria-sort={sortField === 'lifetimeCreditsUsed' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
                      >
                        <button className="th-sort-btn" onClick={() => handleSort('lifetimeCreditsUsed')}>
                          Lifetime credits
                          <SortIcon active={sortField === 'lifetimeCreditsUsed'} direction={sortDirection} />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map(dev => (
                      <tr
                        key={dev.id}
                        className="table-row-clickable"
                        onClick={() => navigate(`/users/${dev.id}`)}
                        role="link"
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && navigate(`/users/${dev.id}`)}
                      >
                        <td>
                          <div>
                            <div className="cell-link">{dev.name}</div>
                            <div className="text-muted" style={{ fontSize: 12 }}>{dev.email}</div>
                          </div>
                        </td>
                        <td>
                          <span className="pill tier-pill" style={{ backgroundColor: tierColor(dev.tier), color: '#fff' }}>
                            {formatTier(dev.tier)}
                          </span>
                        </td>
                        <td>
                          {/* .cell-credits sets display:flex — applied to
                              an inner span, not the <td> itself. A <td>
                              needs to stay display:table-cell to
                              participate in the table's column layout;
                              overriding that to flex breaks it out of the
                              row entirely (this was the layout bug: with
                              a second flex <td> added right after it for
                              Lifetime credits, this cell visibly
                              collapsed onto its own line under the row). */}
                          <span className="cell-credits">
                            <span>{dev.creditsUsed.toLocaleString()} credits</span>
                            {/* Period-over-period trend (vs the previous
                                equivalent window) still isn't computed —
                                this shows an absolute period total, not a
                                trend, so no arrow here; not shown rather
                                than a fabricated one. */}
                            {dev.creditsTrend != null && (
                              <span className={`trend-arrow ${dev.creditsTrend >= 0 ? 'trend-up' : 'trend-down'}`}>
                                {dev.creditsTrend >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                {Math.abs(dev.creditsTrend)}%
                              </span>
                            )}
                          </span>
                        </td>
                        <td>
                          <span>{dev.lifetimeCreditsUsed.toLocaleString()} credits</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
              />
            </div>

            {/* Right sidebar */}
            <aside className="users-sidebar">
              <div className="sidebar-card">
                <h3 className="sidebar-card-title">Tier distribution</h3>
                <DonutChart tiers={tierDistribution} total={developers.length} />
              </div>

              <div className="sidebar-card">
                <h3 className="sidebar-card-title">Top users ({days === 1 ? 'last 1 day' : `last ${days} days`})</h3>
                <div className="top-users-list">
                  {topUsers.map(u => (
                    <div key={u.id} className="top-user-row">
                      <span className="top-user-name">{u.name}</span>
                      <span className="top-user-credits">{u.creditsUsed.toLocaleString()} credits</span>
                    </div>
                  ))}
                </div>
                <button className="view-all-link" onClick={() => { /* already on users page */ }}>
                  View all users →
                </button>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function SortIcon({ active, direction }: { active: boolean; direction: SortDirection }) {
  if (!active) return <ArrowUpDown size={13} className="th-sort-icon th-sort-icon-inactive" />;
  return direction === 'asc'
    ? <ArrowUp size={13} className="th-sort-icon" />
    : <ArrowDown size={13} className="th-sort-icon" />;
}

function DonutChart({ tiers, total }: { tiers: TierDistribution[]; total: number }) {
  const size = 160;
  const strokeWidth = 24;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const segments = tiers.map(t => {
    const pct = total > 0 ? t.count / total : 0;
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
