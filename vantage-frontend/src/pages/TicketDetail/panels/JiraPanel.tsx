import { useEffect, useState } from 'react';
import Avatar from '@/components/shared/Avatar';
import EmptyState from '@/components/shared/EmptyState';
import StatusPill from '@/components/shared/StatusPill';
import { fetchJiraIssue } from '@/services/jiraApi';
import { getSiteName, isAuthenticated, isJiraConfigured, isSessionExpired, login, logout } from '@/services/jiraAuth';
import { exactTime, priorityArrow, priorityClass, relativeTime } from '@/services/utils';
import type { JiraTicket } from '@/types';

interface JiraPanelProps {
  ticketId: string;
}

type LoadState = 'logged-out' | 'loading' | 'error' | 'ready';

// Real Atlassian OAuth 2.0 (3LO) PKCE flow (services/jiraAuth.ts +
// jiraApi.ts) — not mock data. Logged-out and error states are shown
// honestly rather than papered over with a fabricated ticket summary.
export default function JiraPanel({ ticketId }: JiraPanelProps) {
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>(isAuthenticated() ? 'loading' : 'logged-out');
  const [errorMessage, setErrorMessage] = useState('');
  const [ticket, setTicket] = useState<JiraTicket | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      setLoadState('logged-out');
      return;
    }
    let cancelled = false;
    setLoadState('loading');
    fetchJiraIssue(ticketId)
      .then(res => { if (!cancelled) { setTicket(res); setLoadState('ready'); } })
      .catch(err => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : String(err));
        setLoadState('error');
      });
    return () => { cancelled = true; };
  }, [ticketId]);

  if (loadState === 'logged-out') {
    if (!isJiraConfigured()) {
      return (
        <EmptyState
          title="Jira OAuth isn't configured"
          subtitle="VITE_JIRA_CLIENT_ID / VITE_JIRA_REDIRECT_URI are missing from the frontend's .env."
        />
      );
    }
    // Atlassian's access token here has no refresh token behind it (no
    // offline_access scope — see jiraAuth.ts's docstring), so it really
    // does expire ~1hr after login, every time. Telling the two states
    // apart matters: an expired session looks identical to "never
    // logged in" otherwise, which reads as Jira randomly failing rather
    // than a real, expected timeout with an obvious fix (log in again).
    const expired = isSessionExpired();
    return (
      <div className="panel-jira">
        <EmptyState
          title={expired ? 'Your Jira session expired' : "Jira isn't connected yet"}
          subtitle={
            expired
              ? "Jira access tokens expire after about an hour. Log in again to keep seeing this ticket's summary, assignee, status, and priority."
              : "Log in with Atlassian to see this ticket's summary, assignee, status, and priority."
          }
        />
        <button className="header-btn" onClick={() => login(window.location.pathname)}>
          {expired ? 'Log in with Atlassian again' : 'Log in with Atlassian'}
        </button>
      </div>
    );
  }

  if (loadState === 'loading') {
    return <p>Loading real Jira data…</p>;
  }

  if (loadState === 'error') {
    return (
      <div className="panel-jira">
        <EmptyState title="Failed to load this ticket from Jira" subtitle={errorMessage} />
        <button className="header-btn" onClick={() => { logout(); setLoadState('logged-out'); }}>
          Log out and try again
        </button>
      </div>
    );
  }

  if (!ticket) return null; // unreachable: loadState === 'ready' implies ticket is set

  const descriptionIsLong = ticket.description.length > 200;

  return (
    <div className="panel-jira">
      <div className="jira-connected-bar">
        <span className="text-muted">Connected to {getSiteName() ?? 'Jira'}</span>
        <button className="header-btn" onClick={() => { logout(); setLoadState('logged-out'); }}>
          Log out
        </button>
      </div>
      <table className="detail-table" aria-label="Jira ticket details">
        <tbody>
          {/* Summary row removed 2026-09-09 — the Description section
              below already shows this (often verbatim, as for bug
              tickets whose summary and description are the same
              sentence), making a dedicated row redundant rather than
              informative. */}
          <tr>
            <th scope="row">Issue type</th>
            <td className="cell-with-icon">
              {ticket.issueType.iconUrl && <img src={ticket.issueType.iconUrl} alt="" className="issue-type-icon" />}
              {ticket.issueType.name}
            </td>
          </tr>
          <tr>
            <th scope="row">Assignee</th>
            <td>
              {ticket.assignee ? (
                <div className="person-cell">
                  <Avatar name={ticket.assignee.name} size={24} />
                  <span>{ticket.assignee.name}</span>
                </div>
              ) : <span className="text-muted">Unassigned</span>}
            </td>
          </tr>
          <tr>
            <th scope="row">Reporter</th>
            <td>
              {ticket.reporter ? (
                <div className="person-cell">
                  <Avatar name={ticket.reporter.name} size={24} />
                  <span>{ticket.reporter.name}</span>
                </div>
              ) : <span className="text-muted">—</span>}
            </td>
          </tr>
          <tr>
            <th scope="row">Priority</th>
            <td className="cell-priority">
              <span className={`priority-arrow ${priorityClass(ticket.priority.level)}`}>
                {priorityArrow(ticket.priority.level)}
              </span>
              <span>{ticket.priority.name}</span>
            </td>
          </tr>
          <tr>
            <th scope="row">Status</th>
            <td><StatusPill status={ticket.status} /></td>
          </tr>
          {/* Sprint row removed 2026-09-09 — this project's Jira
              instance doesn't use sprints in a way that maps cleanly
              here (jiraApi.ts never even populates the field — see its
              own comment on why — so this row was always just "—"). */}
          <tr>
            <th scope="row">Project</th>
            <td>{ticket.project}</td>
          </tr>
          <tr>
            <th scope="row">Labels</th>
            <td>
              <div className="labels-row">
                {ticket.labels.map(l => (
                  <span key={l} className="pill label-pill">{l}</span>
                ))}
                {ticket.labels.length === 0 && '—'}
              </div>
            </td>
          </tr>
          <tr>
            <th scope="row">Created</th>
            <td>
              <span title={exactTime(ticket.created)}>{relativeTime(ticket.created)}</span>
            </td>
          </tr>
          <tr>
            <th scope="row">Updated</th>
            <td>
              <span title={exactTime(ticket.updated)}>{relativeTime(ticket.updated)}</span>
            </td>
          </tr>
          {/* Resolution row removed 2026-09-09 — deliberately, not a
              bug fix. jiraApi.ts still requests and maps
              ticket.resolution (see FIELDS + the mapping there); this
              is a display-only change. Jira's `resolution` and
              `status` are independent fields — a ticket can be
              status="Resolved" while resolution stays unset unless
              someone explicitly picked one at close time, so showing
              resolution ?? 'Unresolved' was misleadingly implying an
              open ticket for real tickets that are actually resolved. */}
        </tbody>
      </table>

      {/* Description section */}
      <div className="description-section">
        <h3 className="description-heading">Description</h3>
        <div className={`description-body ${!showFullDescription && descriptionIsLong ? 'collapsed' : ''}`}>
          {ticket.description.split('\n').map((line, i) => (
            <p key={i}>{line || '\u00A0'}</p>
          ))}
        </div>
        {descriptionIsLong && (
          <button
            className="show-more-btn"
            onClick={() => setShowFullDescription(!showFullDescription)}
          >
            {showFullDescription ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}
