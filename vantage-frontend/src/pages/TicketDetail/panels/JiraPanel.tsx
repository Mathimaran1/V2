import { useState } from 'react';
import Avatar from '@/components/shared/Avatar';
import StatusPill from '@/components/shared/StatusPill';
import { exactTime, priorityArrow, priorityClass, relativeTime } from '@/services/utils';
import type { JiraTicket } from '@/types';

interface JiraPanelProps {
  ticket: JiraTicket;
}

export default function JiraPanel({ ticket }: JiraPanelProps) {
  const [showFullDescription, setShowFullDescription] = useState(false);
  const descriptionIsLong = ticket.description.length > 200;

  return (
    <div className="panel-jira">
      <table className="detail-table" aria-label="Jira ticket details">
        <tbody>
          <tr>
            <th scope="row">Summary</th>
            <td>{ticket.summary}</td>
          </tr>
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
              <div className="person-cell">
                <Avatar name={ticket.assignee.name} size={24} />
                <span>{ticket.assignee.name}</span>
              </div>
            </td>
          </tr>
          <tr>
            <th scope="row">Reporter</th>
            <td>
              <div className="person-cell">
                <Avatar name={ticket.reporter.name} size={24} />
                <span>{ticket.reporter.name}</span>
              </div>
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
          <tr>
            <th scope="row">Sprint</th>
            <td>{ticket.sprint ?? '—'}</td>
          </tr>
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
          <tr>
            <th scope="row">Resolution</th>
            <td>{ticket.resolution ?? 'Unresolved'}</td>
          </tr>
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
