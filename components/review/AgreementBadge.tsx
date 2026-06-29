import { clsx } from 'clsx';
import type { AgreementClassification } from '@/workers/comparison/comparison-schema';

const LABELS: Record<AgreementClassification, string> = {
  exact_match: 'Match',
  normalized_match: 'Near match',
  partial_match: 'Partial',
  conflict: 'Conflict',
  claude_only: 'Claude only',
  openai_only: 'OpenAI only',
  both_null: 'Both null',
  invalid_evidence: 'Bad evidence',
  not_comparable: 'N/A',
};

export function AgreementBadge({ agreement }: { agreement: AgreementClassification }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        (agreement === 'exact_match' || agreement === 'normalized_match') &&
          'bg-green-50 text-green-700 ring-1 ring-green-600/20',
        agreement === 'partial_match' &&
          'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-600/20',
        agreement === 'conflict' &&
          'bg-red-50 text-red-700 ring-1 ring-red-600/20',
        (agreement === 'claude_only' || agreement === 'openai_only') &&
          'bg-orange-50 text-orange-700 ring-1 ring-orange-600/20',
        agreement === 'invalid_evidence' &&
          'bg-red-50 text-red-700 ring-1 ring-red-600/20',
        (agreement === 'both_null' || agreement === 'not_comparable') &&
          'bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200',
      )}
    >
      {LABELS[agreement]}
    </span>
  );
}
