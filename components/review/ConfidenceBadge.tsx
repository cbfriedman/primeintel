import { clsx } from 'clsx';

export function ConfidenceBadge({ score }: { score: number | null }) {
  if (score === null) {
    return <span className="text-xs text-zinc-400">—</span>;
  }

  const label = score.toFixed(1);

  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        score >= 80 && 'bg-green-50 text-green-700 ring-1 ring-green-600/20',
        score >= 60 && score < 80 && 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-600/20',
        score < 60 && 'bg-red-50 text-red-700 ring-1 ring-red-600/20',
      )}
    >
      {label}
    </span>
  );
}
