// AWS CodeCommit's GetCommit returns commit.author.date in git's raw
// author-date format ("<epoch seconds> <+HHMM offset>", e.g.
// "1788625651 +0530") — confirmed against real API output, not ISO 8601.
// `new Date("1788625651 +0530")` is Invalid Date, so this must be parsed
// explicitly before falling back to standard Date parsing for the ISO
// strings still-mock data (SonarQube, Jira) uses.
const GIT_RAW_DATE_RE = /^(\d+)\s+[+-]\d{4}$/;

function parseTimestamp(timestamp: string): Date {
  const match = GIT_RAW_DATE_RE.exec(timestamp.trim());
  if (match) {
    return new Date(Number(match[1]) * 1000);
  }
  return new Date(timestamp);
}

/**
 * Format a timestamp as relative time (e.g. "12m ago", "2h ago", "3d ago").
 */
export function relativeTime(timestamp: string): string {
  const now = Date.now();
  const then = parseTimestamp(timestamp).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  if (diffWeeks < 5) return `${diffWeeks}w ago`;

  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

/**
 * Format a timestamp as an exact date-time string for tooltips.
 */
export function exactTime(timestamp: string): string {
  return parseTimestamp(timestamp).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Generate initials from a name for avatar fallbacks.
 */
export function getInitials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

/**
 * Get a deterministic color for an avatar based on the name.
 */
export function getAvatarColor(name: string): string {
  const colors = [
    '#378ADD', '#6366f1', '#8b5cf6', '#ec4899',
    '#f59e0b', '#10b981', '#ef4444', '#06b6d4',
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/**
 * Status category → CSS class mapping for pill badges.
 */
export function statusClass(category: string): string {
  switch (category) {
    case 'in-progress': return 'status-in-progress';
    case 'done': return 'status-done';
    case 'to-do':
    default: return 'status-todo';
  }
}

/**
 * Priority level → arrow direction.
 */
export function priorityArrow(level: string): string {
  switch (level) {
    case 'highest':
    case 'high': return '↑';
    case 'medium': return '→';
    case 'low':
    case 'lowest': return '↓';
    default: return '→';
  }
}

/**
 * Priority level → CSS class.
 */
export function priorityClass(level: string): string {
  switch (level) {
    case 'highest':
    case 'high': return 'priority-high';
    case 'medium': return 'priority-medium';
    case 'low':
    case 'lowest': return 'priority-low';
    default: return 'priority-medium';
  }
}

/**
 * Severity → CSS class for SonarQube pills.
 */
export function severityClass(severity: string): string {
  switch (severity) {
    case 'blocker':
    case 'critical': return 'severity-critical';
    case 'major': return 'severity-major';
    case 'minor': return 'severity-minor';
    default: return 'severity-info';
  }
}

/**
 * Grade → CSS color for SonarQube metric badges.
 */
export function gradeColor(grade: string): string {
  switch (grade) {
    case 'A': return '#10b981';
    case 'B': return '#378ADD';
    case 'C': return '#f59e0b';
    case 'D': return '#f97316';
    case 'E': return '#ef4444';
    default: return '#6b7280';
  }
}

/**
 * Get a consistent badge color for a data-driven tier value.
 */
const tierColorCache = new Map<string, string>();
const TIER_PALETTE = ['#378ADD', '#8b5cf6', '#10b981', '#f59e0b', '#ec4899', '#06b6d4', '#ef4444', '#6366f1'];

export function tierColor(tier: string): string {
  if (tierColorCache.has(tier)) return tierColorCache.get(tier)!;
  const idx = tierColorCache.size % TIER_PALETTE.length;
  const color = TIER_PALETTE[idx];
  tierColorCache.set(tier, color);
  return color;
}

/**
 * Format tier strings for display (e.g. PRO_PLUS → "Pro plus").
 */
export function formatTier(tier: string): string {
  return tier.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
}
