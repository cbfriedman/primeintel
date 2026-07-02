import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { createClient } from '@/lib/supabase/server';
import { getBids } from '@/lib/supabase/bids';
import { getSavedBidIds, getSavedBids } from '@/lib/supabase/saved-bids';
import { ConfidenceBadge } from '@/components/review/ConfidenceBadge';
import { BookmarkButton } from '@/components/bids/BookmarkButton';
import type { BidDbExtractionStatus } from '@/types/extraction';
import type { Bid } from '@/types/bid';

type ActiveTab = BidDbExtractionStatus | 'all' | 'saved';

const TABS: { label: string; value: ActiveTab }[] = [
  { label: 'All',          value: 'all' },
  { label: 'Saved',        value: 'saved' },
  { label: 'Needs Review', value: 'needs_review' },
  { label: 'Completed',    value: 'completed' },
  { label: 'Processing',   value: 'processing' },
  { label: 'Failed',       value: 'failed' },
];

const STATUS_CONFIG: Record<BidDbExtractionStatus, { label: string; className: string }> = {
  completed:    { label: 'Completed',    className: 'bg-green-50 text-green-700 ring-1 ring-green-600/20' },
  needs_review: { label: 'Needs Review', className: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-600/20' },
  processing:   { label: 'Processing',   className: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20' },
  pending:      { label: 'Pending',      className: 'bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200' },
  failed:       { label: 'Failed',       className: 'bg-red-50 text-red-700 ring-1 ring-red-600/20' },
};

function StatusBadge({ status }: { status: BidDbExtractionStatus }) {
  const { label, className } = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={clsx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', className)}>
      {label}
    </span>
  );
}

function formatDate(iso: string | null): { text: string; urgent: boolean } {
  if (!iso) return { text: '—', urgent: false };
  const date = new Date(iso);
  const daysUntil = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  return {
    text: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    urgent: daysUntil >= 0 && daysUntil <= 7,
  };
}

function formatEstimate(cents: number | null): string {
  if (cents === null) return '—';
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(1)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

function tabHref(tab: ActiveTab): string {
  if (tab === 'all') return '/bids';
  return `/bids?tab=${tab}`;
}

export default async function BidFeedPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const params = await searchParams;
  const activeTab = (params.tab as ActiveTab) || (params.status as ActiveTab) || 'all';

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id ?? null;

  let bids: Bid[] = [];
  let total = 0;
  let savedIds: Set<string> = new Set();

  if (activeTab === 'saved') {
    bids = userId ? await getSavedBids(userId) : [];
    total = bids.length;
    savedIds = new Set(bids.map((b) => b.id));
  } else {
    const filters: Parameters<typeof getBids>[0] = { limit: 50, upcoming_only: true };
    if (activeTab !== 'all') {
      filters.extraction_status = activeTab as BidDbExtractionStatus;
    }
    const result = await getBids(filters);
    bids = result.bids;
    total = result.total;
    if (userId) {
      savedIds = await getSavedBidIds(userId);
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-zinc-900">Bid Feed</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {total} upcoming bid{total !== 1 ? 's' : ''}
          {activeTab === 'saved' ? ' saved' : ''}
        </p>
      </div>

      <div className="mb-4 flex gap-1 border-b border-zinc-200">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={tabHref(tab.value)}
            className={clsx(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.value
                ? 'border-zinc-900 text-zinc-900'
                : 'border-transparent text-zinc-500 hover:text-zinc-700',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {bids.length === 0 ? (
        <div className="rounded-lg border border-zinc-200 bg-white py-16 text-center">
          <p className="text-sm text-zinc-500">
            {activeTab === 'saved' ? 'No saved bids yet.' : 'No bids found.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <table className="min-w-full divide-y divide-zinc-200 text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th className="w-8 px-3 py-3" />
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Status</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Bid</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">County</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Bid Date</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Est. Value</th>
                <th className="px-4 py-3 text-left font-medium text-zinc-500">Confidence</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {bids.map((bid: Bid) => (
                <tr
                  key={bid.id}
                  className={clsx(
                    'hover:bg-zinc-50 transition-colors',
                    bid.manual_review_required && 'bg-yellow-50/20',
                  )}
                >
                  <td className="px-3 py-3">
                    <BookmarkButton bidId={bid.id} isSaved={savedIds.has(bid.id)} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={bid.extraction_status} />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/bids/${bid.id}`}
                      className="font-medium text-zinc-900 hover:text-zinc-600 max-w-[280px] truncate block transition-colors"
                    >
                      {bid.title}
                    </Link>
                    {bid.agency && (
                      <p className="text-xs text-zinc-500 mt-0.5 max-w-[280px] truncate">
                        {bid.agency}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600">
                    {bid.county ?? '—'}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {(() => {
                      const { text, urgent } = formatDate(bid.bid_date);
                      return (
                        <span className={urgent ? 'font-medium text-orange-600' : 'text-zinc-600'}>
                          {text}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-3 text-xs text-zinc-600 whitespace-nowrap">
                    {formatEstimate(bid.engineers_estimate_cents)}
                  </td>
                  <td className="px-4 py-3">
                    <ConfidenceBadge score={bid.extraction_confidence} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-3">
                      <a
                        href={bid.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-400 hover:text-zinc-600 transition-colors"
                        title="View source"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                      {bid.manual_review_required && (
                        <Link
                          href="/admin/review"
                          className="text-xs font-medium text-yellow-700 hover:text-yellow-900 transition-colors"
                        >
                          Review →
                        </Link>
                      )}
                    </div>
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
