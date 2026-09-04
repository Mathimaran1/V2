import { ArrowLeft, Info } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { computeCreditsUsed } from '@/services/api';
import { getMockCommits, getMockPullRequests, getMockSonarQube, getMockTicketDetail } from '@/services/mockData';
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

export default function TicketDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>('jira');

  const ticket = useMemo(() => getMockTicketDetail(ticketId ?? ''), [ticketId]);
  const commits = useMemo(() => getMockCommits(ticketId ?? ''), [ticketId]);
  const prs = useMemo(() => getMockPullRequests(ticketId ?? ''), [ticketId]);
  const sonarqube = useMemo(() => getMockSonarQube(ticketId ?? ''), [ticketId]);

  const creditsUsed = useMemo(() => computeCreditsUsed(commits), [commits]);
  const qualityGateResult = sonarqube.qualityGate;

  if (!ticket) {
    return (
      <div className="page-ticket-detail">
        <button className="back-link" onClick={() => navigate('/')}>← Back to Overview</button>
        <p>Ticket not found.</p>
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
        <span className="ticket-id">{ticket.key}</span>
        <h1 className="ticket-title">{ticket.summary}</h1>
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
        {activeTab === 'jira' && <JiraPanel ticket={ticket} />}
        {activeTab === 'commits' && <CommitsPanel commits={commits} />}
        {activeTab === 'prs' && <PullRequestsPanel pullRequests={prs} commitCount={commits.length} />}
        {activeTab === 'sonarqube' && <SonarQubePanel data={sonarqube} />}
      </div>
    </div>
  );
}
