import { Bell, Download, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '@/components/shared/Avatar';
import Pagination from '@/components/shared/Pagination';
import { fetchTicketsSummary } from '@/services/api';
import { exactTime, relativeTime } from '@/services/utils';
import type { TicketSummary } from '@/types';

// One CSV field, quoted only when it actually needs it (contains a
// comma, quote, or newline) — RFC 4180. Ticket IDs/counts never need
// quoting in practice, but this doesn't assume that.
function csvField(value: string | number): string {
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Exports exactly the rows currently visible in the (search-)filtered
// table — every matching ticket, not just the current page — using the
// same real TicketSummary data the table itself renders, so the file
// can never disagree with what's on screen. lastCommitAt is CodeCommit's
// raw author-date format (see TicketSummary's own doc comment), so it's
// run through the same exactTime() the table's tooltip uses rather than
// dumped raw.
function ticketsToCsv(tickets: TicketSummary[]): string {
  const header = ['Ticket ID', 'Commits', 'Pull requests', 'Credits used', 'Last commit'];
  const rows = tickets.map(t => [
    t.ticketId,
    t.commitCount,
    t.prCount,
    t.creditsUsed,
    t.lastCommitAt ? exactTime(t.lastCommitAt) : '',
  ]);
  return [header, ...rows].map(row => row.map(csvField).join(',')).join('\r\n') + '\r\n';
}

export default function OverviewPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    fetchTicketsSummary()
      .then(res => { if (!cancelled) { setTickets(res); setLoadState('ready'); } })
      .catch(err => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!search) return tickets;
    const s = search.toLowerCase();
    return tickets.filter(t => t.ticketId.toLowerCase().includes(s));
  }, [tickets, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageItems = filtered.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  // Was previously a button with no onClick at all — clicking it did
  // literally nothing (confirmed: no console error, no network request,
  // no download event; there was simply no handler wired up). Exports
  // every currently-filtered ticket (not just the current page) as a
  // real CSV file via a Blob + temporary <a download>, matching exactly
  // what's in the table above it.
  const handleExport = useCallback(() => {
    const csv = ticketsToCsv(filtered);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `vantage-tickets-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [filtered]);

  return (
    <div className="page-overview">
      {/* Header */}
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">End-to-end visibility from Jira ticket to production.</p>
        </div>
        <div className="page-header-right">
          <button className="header-btn" aria-label="Export" onClick={handleExport}>
            <Download size={16} />
            <span>Export</span>
          </button>
          <button className="header-btn icon-only" aria-label="Notifications">
            <Bell size={18} />
            <span className="notification-badge">3</span>
          </button>
          <div className="admin-profile">
            <Avatar name="Admin" size={32} />
            <div className="admin-info">
              <span className="admin-name">Admin</span>
              <span className="admin-role">Administrator</span>
            </div>
          </div>
        </div>
      </header>

      {/* Filters */}
      <div className="filter-bar">
        <div className="search-input">
          <Search size={16} />
          <input
            type="text"
            placeholder="Search by ticket ID..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            aria-label="Search tickets"
          />
        </div>
        <span className="text-muted" title="Summary, assignee, status, and priority require Jira, which isn't connected yet (see Step 2 of the integration plan).">
          Jira details (summary, assignee, status, priority) unavailable until Jira is connected
        </span>
      </div>

      {/* Table header with count */}
      <div className="table-header-bar">
        <h2 className="table-title">All tickets</h2>
        <span className="table-count-badge">{filtered.length}</span>
      </div>

      {loadState === 'loading' && <p>Loading real ticket data…</p>}
      {loadState === 'error' && <p>Failed to load tickets: {errorMessage}</p>}

      {loadState === 'ready' && (
        <>
          {/* Table */}
          <div className="table-container">
            <table className="data-table" aria-label="Tickets">
              <thead>
                <tr>
                  <th>Ticket ID</th>
                  <th>Commits</th>
                  <th>Pull requests</th>
                  <th>Credits used</th>
                  <th>Last commit</th>
                  <th aria-hidden="true"></th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map(ticket => (
                  <tr
                    key={ticket.ticketId}
                    className="table-row-clickable"
                    onClick={() => navigate(`/ticket/${ticket.ticketId}`)}
                    role="link"
                    tabIndex={0}
                    onKeyDown={e => e.key === 'Enter' && navigate(`/ticket/${ticket.ticketId}`)}
                    aria-label={ticket.ticketId}
                  >
                    <td className="cell-ticket-id">{ticket.ticketId}</td>
                    <td>{ticket.commitCount}</td>
                    <td>{ticket.prCount}</td>
                    <td>{ticket.creditsUsed} credits</td>
                    <td className="cell-updated">{ticket.lastCommitAt ? relativeTime(ticket.lastCommitAt) : '—'}</td>
                    <td className="cell-chevron">›</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <Pagination
            page={page}
            totalPages={totalPages}
            total={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
          />
        </>
      )}
    </div>
  );
}
