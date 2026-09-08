import { ArrowLeft, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { computeCreditsUsed, fetchCommits, fetchPullRequests, fetchTicketSummary } from '@/services/api';
import type { CommitRecord, PullRequest, TicketSummary } from '@/types';
import CommitsPanel from './panels/CommitsPanel';
import JiraPanel from './panels/JiraPanel';
import PullRequestsPanel from './panels/PullRequestsPanel';
import SonarQubePanel from './panels/SonarQubePanel';

type TabId = 'jira' | 'commits' | 'prs' | 'sonarqube';

const TABS: { id: TabId; label: string }[] = [
  { id: 'jira', label: 'Jira' },
  { id: 'commits', label: 'Commits' },
  { id: 'prs', label: 'Pull Requests' },
  { id: 'sonarqube', label: 'SonarQube' },
];

// SonarQube isn't wired yet (Step 3 of the integration plan — blocked on
// a real server URL + token from the user). This is an honest
// "not connected" SonarQubeData, not fabricated metrics — SonarQubePanel
// already renders its own EmptyState whenever connected is false.
const SONARQUBE_NOT_CONNECTED = {
  connected: false as const,
  qualityGate: null,
  lastScan: null,
  metrics: null,
  issues: [],
  trend: null,
};

type LoadState = 'loading' | 'not-found' | 'error' | 'ready';

export default function TicketDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('jira');

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [ticket, setTicket] = useState<TicketSummary | null>(null);
  const [commits, setCommits] = useState<CommitRecord[]>([]);
  const [prs, setPrs] = useState<PullRequest[]>([]);

  useEffect(() => {
    if (!ticketId) return;
    let cancelled = false;

    setLoadState('loading');
    (async () => {
      try {
        const [ticketRes, commitsRes, prsRes] = await Promise.all([
          fetchTicketSummary(ticketId),
          fetchCommits(ticketId),
          fetchPullRequests(ticketId),
        ]);
        if (cancelled) return;
        setTicket(ticketRes);
        setCommits(commitsRes);
        setPrs(prsRes);
        setLoadState('ready');
      } catch (err) {
        if (cancelled) return;
        // GET /api/tickets/:id returns a real 404 for an untracked ticket
        // (see routes/tickets.py) — treat that as "not found", not a
        // generic error.
        if (err instanceof Error && err.message.includes('404')) {
          setLoadState('not-found');
        } else {
          setErrorMessage(err instanceof Error ? err.message : String(err));
          setLoadState('error');
        }
      }
    })();

    return () => { cancelled = true; };
  }, [ticketId]);

  const creditsUsed = useMemo(() => computeCreditsUsed(commits), [commits]);
  const qualityGateResult = SONARQUBE_NOT_CONNECTED.qualityGate;

  if (loadState === 'loading') {
    return (
      <div className="page-ticket-detail">
        <button className="back-link" onClick={() => navigate('/')}>← Back to Overview</button>
        <p>Loading real ticket data…</p>
      </div>
    );
  }

  if (loadState === 'not-found') {
    return (
      <div className="page-ticket-detail">
        <button className="back-link" onClick={() => navigate('/')}>← Back to Overview</button>
        <p>Ticket {ticketId} isn't tracked yet — run scripts/refresh_data.py --ticket {ticketId} first.</p>
      </div>
    );
  }

  if (loadState === 'error' || !ticket) {
    return (
      <div className="page-ticket-detail">
        <button className="back-link" onClick={() => navigate('/')}>← Back to Overview</button>
        <p>Failed to load {ticketId}: {errorMessage}</p>
      </div>
    );
  }

  return (
    <div className="page-ticket-detail">
      {/* Header */}
      <button className="back-link" onClick={() => navigate('/')}>
        <ArrowLeft size={16} />
        Back to Overview
      </button>

      <header className="ticket-header">
        <span className="ticket-id">{ticket.ticketId}</span>
        <h1 className="ticket-title">
          Jira summary unavailable
          <span className="stat-info-icon" title="Jira isn't connected yet — see the Jira tab below">
            <Info size={14} />
          </span>
        </h1>
      </header>

      {/* Stats strip */}
      <div className="stats-strip">
        <div className="stat-card">
          <div className="stat-label">
            Credits used (this ticket)
            <span className="stat-info-icon" title="Computed using max-per-episode-then-sum logic across all commits">
              <Info size={14} />
            </span>
          </div>
          <div className="stat-value">{creditsUsed} <span className="stat-unit">credits</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Commit count</div>
          <div className="stat-value">{commits.length} <span className="stat-unit">commits</span></div>
        </div>
        <div className="stat-card">
          <div className="stat-label">
            Quality gate result
            <span className="stat-info-icon" title="From the latest SonarQube scan">
              <Info size={14} />
            </span>
          </div>
          <div className="stat-value">
            {qualityGateResult ? (
              <span className={`pill ${qualityGateResult === 'passed' ? 'quality-passed' : 'quality-failed'}`}>
                {qualityGateResult === 'passed' ? 'Passed' : 'Failed'}
              </span>
            ) : (
              <span className="text-muted">N/A</span>
            )}
          </div>
        </div>
      </div>

      {/* Tab chips */}
      <div className="tab-chips" role="tablist">
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`tab-chip ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Panels */}
      <div className="tab-panel" role="tabpanel" id={`panel-${activeTab}`}>
        {activeTab === 'jira' && <JiraPanel ticket={null} />}
        {activeTab === 'commits' && <CommitsPanel commits={commits} />}
        {activeTab === 'prs' && <PullRequestsPanel pullRequests={prs} commitCount={commits.length} />}
        {activeTab === 'sonarqube' && <SonarQubePanel data={SONARQUBE_NOT_CONNECTED} />}
      </div>
    </div>
  );
}
