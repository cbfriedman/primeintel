import { clsx } from 'clsx';
import type { ManualReviewPriority } from '@/types/extraction';

export function PriorityBadge({ priority }: { priority: ManualReviewPriority }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
        priority === 'high' && 'bg-red-50 text-red-700 ring-1 ring-red-600/20',
        priority === 'normal' && 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-600/20',
        priority === 'low' && 'bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200',
      )}
    >
      {priority}
    </span>
  );
}
