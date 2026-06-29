import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, ExternalLink, AlertTriangle, FileText } from 'lucide-react';
import { clsx } from 'clsx';
import { createClient } from '@/lib/supabase/server';
import { getBidById, getBidDocuments, getBidRiskFlags } from '@/lib/supabase/bids';
import { getSavedBidIds } from '@/lib/supabase/saved-bids';
import { ConfidenceBadge } from '@/components/review/ConfidenceBadge';
import { BookmarkButton } from '@/components/bids/BookmarkButton';
import type { BidRiskFlag, BidDocument } from '@/types/bid';
import type { RiskSeverity } from '@/types/bid';

// ── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatEstimate(cents: number | null): string {
  if (cents === null) return '—';
  const dollars = cents / 100;
  if (dollars >= 1_000_000) return `$${(dollars / 1_000_000).toFixed(2)}M`;
  if (dollars >= 1_000) return `$${(dollars / 1_000).toFixed(0)}K`;
  return `$${dollars.toFixed(0)}`;
}

function formatPercent(val: number | null): string {
  if (val === null) return '—';
  return `${val}%`;
}

function formatBoolean(val: boolean | null): string {
  if (val === null) return '—';
  return val ? 'Yes' : 'No';
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes >= 1_048_576) return ` · ${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1_024) return ` · ${(bytes / 1_024).toFixed(0)} KB`;
  return ` · ${bytes} B`;
}

// ── sub-components ────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-900">{value ?? '—'}</dd>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: RiskSeverity }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1',
        severity === 'high'   && 'bg-red-50 text-red-700 ring-red-600/20',
        severity === 'medium' && 'bg-yellow-50 text-yellow-700 ring-yellow-600/20',
        severity === 'low'    && 'bg-green-50 text-green-700 ring-green-600/20',
      )}
    >
      {severity}
    </span>
  );
}

function TextQualityBadge({ quality }: { quality: string | null }) {
  if (!quality) return null;
  return (
    <span
      className={clsx(
        'text-xs rounded-full px-2 py-0.5 ring-1',
        quality === 'good'   && 'bg-green-50 text-green-700 ring-green-600/20',
        quality === 'medium' && 'bg-yellow-50 text-yellow-700 ring-yellow-600/20',
        quality === 'poor'   && 'bg-red-50 text-red-700 ring-red-600/20',
      )}
    >
      {quality} quality
    </span>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default async function BidDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [bid, documents, riskFlags, savedIds] = await Promise.all([
    getBidById(id),
    getBidDocuments(id),
    getBidRiskFlags(id),
    user ? getSavedBidIds(user.id) : Promise.resolve(new Set<string>()),
  ]);

  if (!bid) notFound();

  const isSaved = savedIds.has(bid.id);

  return (
    <div className="space-y-6">
      {/* Back */}
      <Link
        href="/bids"
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Feed
      </Link>

      {/* Review banner */}
      {bid.manual_review_required && (
        <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-yellow-600 shrink-0" />
          <p className="text-sm text-yellow-800">
            This bid has conflicting AI extractions and requires manual review.
          </p>
          <Link
            href="/admin/review"
            className="ml-auto text-xs font-medium text-yellow-700 hover:text-yellow-900 whitespace-nowrap"
          >
            Go to Review Queue →
          </Link>
        </div>
      )}

      {/* Header */}
      <div>
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-xl font-semibold text-zinc-900 leading-tight">
            {bid.title}
          </h1>
          <div className="flex items-center gap-3 shrink-0 mt-1">
            <BookmarkButton bidId={bid.id} isSaved={isSaved} />
            <a
              href={bid.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-600"
            >
              Source <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
        {bid.agency && (
          <p className="mt-1 text-sm text-zinc-500">{bid.agency}</p>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs text-zinc-500">Bid Opens</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">{formatDate(bid.bid_date)}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs text-zinc-500">
            {bid.engineers_estimate_cents !== null ? 'Est. Value' : bid.bid_cap_cents !== null ? 'Bid Cap' : 'Est. Value'}
          </p>
          <p className="mt-1 text-sm font-medium text-zinc-900">
            {formatEstimate(bid.engineers_estimate_cents ?? bid.bid_cap_cents)}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs text-zinc-500">Confidence</p>
          <div className="mt-1">
            <ConfidenceBadge score={bid.extraction_confidence} />
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <p className="text-xs text-zinc-500">Location</p>
          <p className="mt-1 text-sm font-medium text-zinc-900">
            {[bid.city, bid.county].filter(Boolean).join(', ') || bid.state}
          </p>
        </div>
      </div>

      {/* Description */}
      {bid.description && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
          <p className="text-xs font-medium text-zinc-500 mb-1">Description</p>
          <p className="text-sm text-zinc-700 leading-relaxed">{bid.description}</p>
        </div>
      )}

      {/* Fields grid */}
      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
        <h2 className="text-sm font-semibold text-zinc-900 mb-4">Extracted Fields</h2>
        <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
          <Field label="Bid Date"        value={formatDate(bid.bid_date)} />
          <Field label="Pre-bid Meeting" value={formatDate(bid.prebid_meeting_at)} />
          <Field label="Questions Due"   value={formatDate(bid.question_deadline_at)} />
          <Field
            label={bid.engineers_estimate_cents !== null ? 'Engineers Est.' : bid.bid_cap_cents !== null ? 'Bid Cap' : 'Engineers Est.'}
            value={formatEstimate(bid.engineers_estimate_cents ?? bid.bid_cap_cents)}
          />
          <Field label="Project Duration" value={bid.project_duration} />
          <Field label="Trade"           value={bid.trade} />
          <Field label="Bid Security"    value={bid.bid_security_text ?? formatPercent(bid.bid_bond_percent)} />
          <Field label="Perf. & Payment Bonds" value={bid.perf_payment_bond_text} />
          <Field label="DBE Goal"        value={formatPercent(bid.dbe_goal_percent)} />
          <Field label="Liquidated Damages" value={bid.liquidated_damages} />
          <Field label="Prevailing Wage" value={formatBoolean(bid.prevailing_wage_required)} />
        </dl>

        {bid.license_requirements && (
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <dt className="text-xs text-zinc-500">License Requirements</dt>
            <dd className="mt-0.5 text-sm text-zinc-900">{bid.license_requirements}</dd>
          </div>
        )}

        {bid.project_location && (
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <dt className="text-xs text-zinc-500">Project Location</dt>
            <dd className="mt-0.5 text-sm text-zinc-900">{bid.project_location}</dd>
          </div>
        )}
      </div>

      {/* Contact */}
      {(bid.contact_name || bid.contact_email || bid.contact_phone) && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">Contact</h2>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <Field label="Name"  value={bid.contact_name} />
            <Field label="Email" value={
              bid.contact_email
                ? <a href={`mailto:${bid.contact_email}`} className="text-blue-600 hover:underline">{bid.contact_email}</a>
                : null
            } />
            <Field label="Phone" value={bid.contact_phone} />
          </dl>
        </div>
      )}

      {/* Risk flags */}
      {riskFlags.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">
            Risk Flags
            <span className="ml-2 text-xs font-normal text-zinc-500">
              {riskFlags.filter((f) => f.severity === 'high').length} high ·{' '}
              {riskFlags.filter((f) => f.severity === 'medium').length} medium ·{' '}
              {riskFlags.filter((f) => f.severity === 'low').length} low
            </span>
          </h2>
          <div className="space-y-3">
            {riskFlags.map((flag: BidRiskFlag) => (
              <div
                key={flag.id}
                className={clsx(
                  'rounded-lg border px-4 py-3',
                  flag.severity === 'high'   && 'border-red-100 bg-red-50/40',
                  flag.severity === 'medium' && 'border-yellow-100 bg-yellow-50/40',
                  flag.severity === 'low'    && 'border-green-100 bg-green-50/20',
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <SeverityBadge severity={flag.severity} />
                  <span className="text-xs text-zinc-500">{flag.risk_type}</span>
                </div>
                <p className="text-sm font-medium text-zinc-900">{flag.title}</p>
                {flag.detail && (
                  <p className="mt-1 text-xs text-zinc-600">{flag.detail}</p>
                )}
                {flag.source_excerpt && (
                  <p className="mt-2 text-xs text-zinc-500 italic border-l-2 border-zinc-200 pl-2">
                    {flag.source_excerpt}
                    {flag.page_number ? ` (p. ${flag.page_number})` : ''}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Documents */}
      {documents.length > 0 && (
        <div className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
          <h2 className="text-sm font-semibold text-zinc-900 mb-4">
            Documents
            <span className="ml-2 text-xs font-normal text-zinc-500">{documents.length}</span>
          </h2>
          <div className="divide-y divide-zinc-100">
            {documents.map((doc: BidDocument) => (
              <div key={doc.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                <FileText className="h-4 w-4 text-zinc-400 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-900 truncate">
                    {doc.title ?? doc.file_name ?? 'Untitled document'}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-zinc-500 capitalize">
                      {doc.document_type.replace(/_/g, ' ')}
                      {doc.page_count ? ` · ${doc.page_count} pages` : ''}
                      {formatBytes(doc.size_bytes)}
                    </span>
                    <TextQualityBadge quality={doc.text_quality} />
                  </div>
                </div>
                {doc.source_url && (
                  <a
                    href={doc.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-zinc-400 hover:text-zinc-600 transition-colors shrink-0"
                    title="Download"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
