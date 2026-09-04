import { Bug, CheckCircle, ChevronDown, ChevronUp, Code, ExternalLink, Shield, XCircle } from 'lucide-react';
import { useState } from 'react';
import EmptyState from '@/components/shared/EmptyState';
import { gradeColor, relativeTime, severityClass } from '@/services/utils';
import type { SonarIssue, SonarQubeData } from '@/types';

interface SonarQubePanelProps {
  data: SonarQubeData;
}

export default function SonarQubePanel({ data }: SonarQubePanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!data.connected) {
    return (
      <EmptyState
        title="SonarQube isn't connected yet"
        subtitle="Connect your SonarQube instance to see quality metrics and findings."
      />
    );
  }

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const typeIcon = (type: SonarIssue['type']) => {
    switch (type) {
      case 'bug': return <Bug size={16} />;
      case 'vulnerability': return <Shield size={16} />;
      case 'code-smell': return <Code size={16} />;
    }
  };

  const typeLabel = (type: SonarIssue['type']) => {
    switch (type) {
      case 'bug': return 'Bug';
      case 'vulnerability': return 'Vulnerability';
      case 'code-smell': return 'Code smell';
    }
  };

  return (
    <div className="panel-sonarqube">
      {/* Quality gate badge */}
      <div className="quality-gate-header">
        <div className={`quality-gate-badge ${data.qualityGate === 'passed' ? 'qg-passed' : 'qg-failed'}`}>
          {data.qualityGate === 'passed' ? <CheckCircle size={20} /> : <XCircle size={20} />}
          <span>Quality gate {data.qualityGate === 'passed' ? 'passed' : 'failed'}</span>
        </div>
        {data.lastScan && (
          <div className="last-scan">
            Last scan <span>{relativeTime(data.lastScan)}</span>
          </div>
        )}
      </div>

      {/* Metric cards */}
      {data.metrics && (
        <div className="metric-cards">
          <MetricCard icon={<Bug size={18} />} label="Bugs" value={data.metrics.bugs.value} grade={data.metrics.bugs.grade} />
          <MetricCard icon={<Shield size={18} />} label="Vulnerabilities" value={data.metrics.vulnerabilities.value} grade={data.metrics.vulnerabilities.grade} />
          <MetricCard icon={<Code size={18} />} label="Code smells" value={data.metrics.codeSmells.value} grade={data.metrics.codeSmells.grade} />
          <MetricCard icon={<Shield size={18} />} label="Coverage" value={`${data.metrics.coverage.value}%`} grade={data.metrics.coverage.grade} />
        </div>
      )}

      {/* Issues table */}
      {data.issues.length > 0 && (
        <>
          <h3 className="panel-section-title">Issues</h3>
          <table className="data-table sonar-issues-table" aria-label="SonarQube issues">
            <thead>
              <tr>
                <th>File + line</th>
                <th>Description</th>
                <th>Severity</th>
                <th>Type</th>
                <th aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              {data.issues
                .sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity))
                .map(issue => (
                  <>
                    <tr
                      key={issue.id}
                      className={`table-row-clickable ${expandedId === issue.id ? 'expanded' : ''}`}
                      onClick={() => toggleExpand(issue.id)}
                      aria-expanded={expandedId === issue.id}
                    >
                      <td className="cell-link">{issue.file}:{issue.line}</td>
                      <td>{issue.description}</td>
                      <td>
                        <span className={`pill ${severityClass(issue.severity)}`}>
                          {issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1)}
                        </span>
                      </td>
                      <td className="cell-with-icon">
                        {typeIcon(issue.type)} {typeLabel(issue.type)}
                      </td>
                      <td className="cell-chevron">
                        {expandedId === issue.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </td>
                    </tr>
                    {expandedId === issue.id && (
                      <tr key={`${issue.id}-detail`} className="expanded-row">
                        <td colSpan={5}>
                          <div className="sonar-issue-detail">
                            <table className="detail-table">
                              <tbody>
                                <tr>
                                  <th scope="row">Full description</th>
                                  <td>{issue.ruleDescription}</td>
                                </tr>
                                <tr>
                                  <th scope="row">Suggested fix</th>
                                  <td>{issue.suggestedFix}</td>
                                </tr>
                                <tr>
                                  <th scope="row">View in SonarQube</th>
                                  <td>
                                    <a href={issue.sonarQubeUrl} className="external-link" target="_blank" rel="noopener noreferrer">
                                      Open issue in SonarQube <ExternalLink size={14} />
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
        </>
      )}

      {/* Trend note */}
      {data.trend && (
        <div className="quality-trend">
          <CheckCircle size={18} className="trend-icon" />
          <span className="trend-label">Quality trend</span>
          <span className="trend-text">{data.trend}</span>
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon, label, value, grade }: {
  icon: React.ReactNode; label: string; value: number | string; grade: string;
}) {
  return (
    <div className="metric-card">
      <div className="metric-card-header">
        {icon}
        <span className="metric-card-label">{label}</span>
      </div>
      <div className="metric-card-body">
        <span className="metric-card-value">{value}</span>
        <span className="metric-grade-badge" style={{ backgroundColor: gradeColor(grade), color: '#fff' }}>
          {grade}
        </span>
      </div>
    </div>
  );
}

function severityOrder(severity: string): number {
  switch (severity) {
    case 'blocker': return 0;
    case 'critical': return 1;
    case 'major': return 2;
    case 'minor': return 3;
    case 'info': return 4;
    default: return 5;
  }
}
