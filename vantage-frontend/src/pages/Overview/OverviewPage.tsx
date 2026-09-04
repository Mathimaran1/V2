import { Bell, Calendar, Download, Search } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '@/components/shared/Avatar';
import Pagination from '@/components/shared/Pagination';
import StatusPill from '@/components/shared/StatusPill';
import { getMockTickets } from '@/services/mockData';
import { priorityArrow, priorityClass, relativeTime } from '@/services/utils';

export default function OverviewPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [project, setProject] = useState('all');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const result = useMemo(
    () => getMockTickets({ page, pageSize, search, project: project === 'all' ? '' : project, status: status === 'all' ? '' : status }),
    [page, pageSize, search, project, status],
  );

  const handleSearch = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  return (
    <div className="page-overview">
      {/* Header */}
      <header className="page-header">
        <div className="page-header-left">
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">End-to-end visibility from Jira ticket to production.</p>
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
            placeholder="Search by ID, summary, assignee..."
            value={search}
            onChange={e => handleSearch(e.target.value)}
            aria-label="Search tickets"
          />
        </div>
        <select
          className="filter-select"
          value={project}
          onChange={e => { setProject(e.target.value); setPage(1); }}
          aria-label="Filter by project"
        >
          <option value="all">Project: All</option>
          <option value="Vantage">Vantage</option>
        </select>
        <select
          className="filter-select"
          value={status}
          onChange={e => { setStatus(e.target.value); setPage(1); }}
          aria-label="Filter by status"
        >
          <option value="all">Status: All</option>
          <option value="to-do">To do</option>
          <option value="in-progress">In progress</option>
          <option value="done">Done</option>
        </select>
      </div>

      {/* Table header with count */}
      <div className="table-header-bar">
        <h2 className="table-title">All tickets</h2>
        <span className="table-count-badge">{result.total}</span>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="data-table" aria-label="Tickets">
          <thead>
            <tr>
              <th>Jira ID</th>
              <th>Summary</th>
              <th>Assignee</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Updated</th>
              <th aria-hidden="true"></th>
            </tr>
          </thead>
          <tbody>
            {result.items.map(ticket => (
              <tr
                key={ticket.key}
                className="table-row-clickable"
                onClick={() => navigate(`/ticket/${ticket.key}`)}
                role="link"
                tabIndex={0}
                onKeyDown={e => e.key === 'Enter' && navigate(`/ticket/${ticket.key}`)}
                aria-label={`${ticket.key}: ${ticket.summary}`}
              >
                <td className="cell-ticket-id">{ticket.key}</td>
                <td className="cell-summary">{ticket.summary}</td>
                <td className="cell-assignee">
                  <div className="assignee-cell">
                    <Avatar name={ticket.assignee.name} size={28} />
                    <span>{ticket.assignee.name}</span>
                  </div>
                </td>
                <td><StatusPill status={ticket.status} /></td>
                <td className="cell-priority">
                  <span className={`priority-arrow ${priorityClass(ticket.priority.level)}`}>
                    {priorityArrow(ticket.priority.level)}
                  </span>
                  <span>{ticket.priority.name}</span>
                </td>
                <td className="cell-updated">{relativeTime(ticket.updated)}</td>
                <td className="cell-chevron">›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <Pagination
        page={page}
        totalPages={result.totalPages}
        total={result.total}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
      />
    </div>
  );
}
