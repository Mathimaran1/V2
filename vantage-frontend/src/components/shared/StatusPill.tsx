import { statusClass } from '@/services/utils';
import type { TicketStatus } from '@/types';

interface StatusPillProps {
  status: TicketStatus;
}

export default function StatusPill({ status }: StatusPillProps) {
  return (
    <span className={`pill ${statusClass(status.category)}`}>
      {status.name}
    </span>
  );
}
