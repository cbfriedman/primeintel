import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { ConfidenceBadge } from '@/components/review/ConfidenceBadge';
import { PriorityBadge } from '@/components/review/PriorityBadge';
import type { ReviewListItem } from '@/lib/supabase/reviews';
import type { ManualReviewStatus } from '@/types/extraction';

const STATUS_TABS: { label: string; value: ManualReviewStatus | 'all' }[] = [
  { label: 'Open', value: 'open' },
  { label: 'In Progress', value: 'in_progress' },
  { label: 'Resolved', value: 'approved' },
  { label: 'All', value: 'all' },
];

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'Just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const activeStatus: ManualReviewStatus | 'all' =
    status === 'all' ? 'all' : ((status as ManualReviewStatus) || 'open');

  const params = new URLSearchParams();
  if (activeStatus !== 'all') params.set('status', activeStatus);
  params.set('limit', '50');

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const res = await fetch(`${baseUrl}/api/reviews?${params}`, {
    cache: 'no-store',
  });
  const data = await res.json();
  const reviews: ReviewListItem[] = data.reviews ?? [];
  const total: number = data.total ?? 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">Manual Review Queue</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {total}{' '}
          {activeStatus === 'all' ? 'total' : activeStatus.replace('_', ' ')} review
          {total !== 1 ? 's' : ''}
        </p>
      </div>

      <div className="mb-4 flex gap-1 border-b border-zinc-200">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={
              tab.value === 'open'
                ? '/admin/review'
                : `/admin/review?status=${tab.value}`
            }
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              activeStatus === tab.value
                ? 'border-zinc-900 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {reviews.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white py-16 text-center">
          <p className="text-sm text-zinc-500">No reviews found.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Priority</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Bid</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Confidence</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Conflicts</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">High-risk</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Age</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {reviews.map((review) => (
                <tr key={review.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3">
                    <PriorityBadge priority={review.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-medium text-zinc-900 max-w-[280px] truncate">
                      {review.bid_title}
                    </p>
                    {review.bid_source_url ? (
                      <a
                        href={review.bid_source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-0.5 inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
                      >
                        Source <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <ConfidenceBadge score={review.overall_comparison_confidence} />
                  </td>
                  <td className="px-4 py-3 text-zinc-700">{review.conflict_count ?? 0}</td>
                  <td className="px-4 py-3">
                    {(review.high_risk_conflict_count ?? 0) > 0 ? (
                      <span className="font-semibold text-red-600">
                        {review.high_risk_conflict_count}
                      </span>
                    ) : (
                      <span className="text-zinc-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {formatAge(review.created_at)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-zinc-500 capitalize">
                      {review.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/review/${review.id}`}
                      className="text-xs font-medium text-zinc-700 hover:text-zinc-900 underline underline-offset-2"
                    >
                      Review →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
