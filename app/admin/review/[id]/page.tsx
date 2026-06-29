import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, ArrowLeft } from 'lucide-react';
import { ConfidenceBadge } from '@/components/review/ConfidenceBadge';
import { PriorityBadge } from '@/components/review/PriorityBadge';
import { FieldComparisonTable } from '@/components/review/FieldComparisonTable';
import { ReviewActions } from '@/components/review/ReviewActions';
import type { ReviewDetail } from '@/lib/supabase/reviews';

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/reviews/${id}`, { cache: 'no-store' });

  if (!res.ok) notFound();
  const data = await res.json();
  if (!data.ok) notFound();

  const review = data.review as ReviewDetail;
  const fieldComparisons = review.field_comparisons ?? [];

  return (
    <div className="space-y-6">
      <Link
        href="/admin/review"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Queue
      </Link>

      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-zinc-900 leading-tight">
            {review.bid_title}
          </h1>
          <PriorityBadge priority={review.priority} />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <a
            href={review.bid_source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
          >
            {review.bid_source_url} <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs text-zinc-500">Confidence</p>
          <div className="mt-1">
            <ConfidenceBadge score={review.overall_comparison_confidence} />
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs text-zinc-500">Conflicts</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900">
            {review.conflict_count ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs text-zinc-500">High-risk conflicts</p>
          <p
            className={`mt-1 text-lg font-semibold ${(review.high_risk_conflict_count ?? 0) > 0 ? 'text-red-600' : 'text-zinc-900'}`}
          >
            {review.high_risk_conflict_count ?? 0}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs text-zinc-500">Status</p>
          <p className="mt-1 text-sm font-medium text-zinc-700 capitalize">
            {review.status.replace('_', ' ')}
          </p>
        </div>
      </div>

      {review.review_reasons && review.review_reasons.length > 0 && (
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
          <p className="text-xs font-medium text-yellow-800 mb-1">Why this was flagged</p>
          <ul className="space-y-0.5">
            {review.review_reasons.map((reason, i) => (
              <li key={i} className="text-xs text-yellow-700">
                • {reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600 space-y-1">
          <p className="font-medium text-zinc-700">Claude Scanner</p>
          <p>Model: {review.claude_model ?? '—'}</p>
          <p>Confidence: {review.claude_confidence?.toFixed(1) ?? '—'}</p>
          <p>
            Completed:{' '}
            {review.claude_completed_at
              ? new Date(review.claude_completed_at).toLocaleString()
              : '—'}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600 space-y-1">
          <p className="font-medium text-zinc-700">OpenAI Scanner</p>
          <p>Model: {review.openai_model ?? '—'}</p>
          <p>Confidence: {review.openai_confidence?.toFixed(1) ?? '—'}</p>
          <p>
            Completed:{' '}
            {review.openai_completed_at
              ? new Date(review.openai_completed_at).toLocaleString()
              : '—'}
          </p>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-zinc-900 mb-3">
          Field Comparison
          <span className="ml-2 text-xs font-normal text-zinc-500">
            Click a row to see source excerpts
          </span>
        </h2>
        {fieldComparisons.length > 0 ? (
          <FieldComparisonTable fieldComparisons={fieldComparisons} />
        ) : (
          <p className="text-sm text-zinc-500">No field comparison data available.</p>
        )}
      </div>

      <ReviewActions
        reviewId={review.id}
        currentStatus={review.status}
        existingNotes={review.reviewer_notes}
      />
    </div>
  );
}
