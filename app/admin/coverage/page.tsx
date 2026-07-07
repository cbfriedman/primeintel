import { createAdminClient } from '@/lib/supabase/admin';

export const metadata = { title: 'PrimeIntel — Source Coverage' };

// Revalidate every 5 minutes so health data stays reasonably fresh without
// requiring a full redeploy.
export const revalidate = 300;

type SourceRow = {
  slug: string;
  agency_name: string;
  short_name: string | null;
  entity_type: string;
  county: string | null;
  region: string | null;
  portal_provider: string;
  scraper_status: string;
  coverage_status: string;
  legal_status: string;
  priority_tier: number;
  estimated_annual_projects: number | null;
  last_successful_run_at: string | null;
  last_failed_run_at: string | null;
  consecutive_failure_count: number;
  total_projects_discovered: number;
  expected_update_hours: number | null;
};

async function getSources(): Promise<SourceRow[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('sources')
    .select(
      'slug, agency_name, short_name, entity_type, county, region, portal_provider,' +
      'scraper_status, coverage_status, legal_status, priority_tier,' +
      'estimated_annual_projects, last_successful_run_at, last_failed_run_at,' +
      'consecutive_failure_count, total_projects_discovered, expected_update_hours',
    )
    .order('priority_tier', { ascending: true })
    .order('agency_name', { ascending: true });

  if (error) throw new Error(`Failed to load sources: ${error.message}`);
  // sources table is not yet in generated Supabase types; cast through unknown.
  return (data ?? []) as unknown as SourceRow[];
}

// ---------------------------------------------------------------------------
// Badge helpers
// ---------------------------------------------------------------------------

const SCRAPER_STATUS_STYLES: Record<string, string> = {
  active:         'bg-green-100 text-green-700',
  testing:        'bg-blue-100 text-blue-700',
  in_development: 'bg-yellow-100 text-yellow-700',
  degraded:       'bg-orange-100 text-orange-700',
  blocked:        'bg-red-100 text-red-700',
  not_started:    'bg-zinc-100 text-zinc-500',
  retired:        'bg-zinc-100 text-zinc-400',
};

const LEGAL_STATUS_STYLES: Record<string, string> = {
  approved:   'bg-green-100 text-green-700',
  unreviewed: 'bg-zinc-100 text-zinc-500',
  flagged:    'bg-yellow-100 text-yellow-700',
  blocked:    'bg-red-100 text-red-700',
};

function StatusBadge({ value, styles }: { value: string; styles: Record<string, string> }) {
  const cls = styles[value] ?? 'bg-zinc-100 text-zinc-500';
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}

function HealthIndicator({ source }: { source: SourceRow }) {
  if (source.scraper_status !== 'active') return <span className="text-zinc-300">—</span>;

  if (source.consecutive_failure_count >= 3) {
    return (
      <span className="text-xs font-medium text-red-600">
        {source.consecutive_failure_count} failures
      </span>
    );
  }

  if (!source.last_successful_run_at) {
    return <span className="text-xs text-zinc-400">never run</span>;
  }

  const lastRun = new Date(source.last_successful_run_at);
  const hoursAgo = Math.round((Date.now() - lastRun.getTime()) / 3600000);
  const isStale =
    source.expected_update_hours != null &&
    hoursAgo > source.expected_update_hours * 1.5;

  return (
    <span className={`text-xs ${isStale ? 'text-orange-600 font-medium' : 'text-zinc-500'}`}>
      {hoursAgo < 1 ? '< 1h ago' : `${hoursAgo}h ago`}
      {isStale && ' ⚠'}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function CoveragePage() {
  const sources = await getSources();

  const total = sources.length;
  const active = sources.filter((s) => s.scraper_status === 'active').length;
  const blocked = sources.filter((s) => s.scraper_status === 'blocked').length;
  const notStarted = sources.filter((s) => s.scraper_status === 'not_started').length;
  const failing = sources.filter((s) => s.consecutive_failure_count >= 3).length;
  const totalDiscovered = sources.reduce((sum, s) => sum + s.total_projects_discovered, 0);

  const byPortal: Record<string, number> = {};
  for (const s of sources) {
    byPortal[s.portal_provider] = (byPortal[s.portal_provider] ?? 0) + 1;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-zinc-900">Source Coverage</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Registry of all tracked public-works bid sources.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { label: 'Total sources', value: total },
          { label: 'Active', value: active, highlight: active > 0 },
          { label: 'Not started', value: notStarted },
          { label: 'Blocked', value: blocked, warn: blocked > 0 },
          { label: 'Failing (≥3)', value: failing, alert: failing > 0 },
          { label: 'Projects found', value: totalDiscovered.toLocaleString() },
        ].map(({ label, value, highlight, warn, alert }) => (
          <div
            key={label}
            className={`rounded-xl border p-4 ${
              alert
                ? 'border-red-200 bg-red-50'
                : warn
                ? 'border-orange-200 bg-orange-50'
                : highlight
                ? 'border-green-200 bg-green-50'
                : 'border-zinc-200 bg-white'
            }`}
          >
            <div
              className={`text-2xl font-bold tabular-nums ${
                alert ? 'text-red-700' : warn ? 'text-orange-700' : highlight ? 'text-green-700' : 'text-zinc-900'
              }`}
            >
              {value}
            </div>
            <div className="mt-1 text-xs text-zinc-500">{label}</div>
          </div>
        ))}
      </div>

      {/* Portal family breakdown */}
      {Object.keys(byPortal).length > 0 && (
        <div className="rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-zinc-700 mb-3">By portal family</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(byPortal)
              .sort((a, b) => b[1] - a[1])
              .map(([provider, count]) => (
                <span
                  key={provider}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600"
                >
                  <span className="font-medium">{provider.replace(/_/g, ' ')}</span>
                  <span className="text-zinc-400">{count}</span>
                </span>
              ))}
          </div>
        </div>
      )}

      {/* Source table */}
      {sources.length === 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center">
          <p className="text-sm text-zinc-400">
            No sources in registry yet.{' '}
            <span className="font-mono text-xs">supabase/migrations/013_sources_table.sql</span>{' '}
            may not have been applied.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 bg-zinc-50 text-left text-xs font-medium text-zinc-500 uppercase tracking-wide">
                <th className="px-4 py-3">P</th>
                <th className="px-4 py-3">Agency</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">County</th>
                <th className="px-4 py-3">Portal</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Legal</th>
                <th className="px-4 py-3">Health</th>
                <th className="px-4 py-3 text-right">Projects</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {sources.map((source) => (
                <tr
                  key={source.slug}
                  className={`hover:bg-zinc-50 transition-colors ${
                    source.consecutive_failure_count >= 3 ? 'bg-red-50' : ''
                  }`}
                >
                  {/* Priority tier */}
                  <td className="px-4 py-3 text-zinc-400 text-xs tabular-nums">
                    {source.priority_tier}
                  </td>

                  {/* Agency */}
                  <td className="px-4 py-3">
                    <div className="font-medium text-zinc-900">
                      {source.short_name ?? source.agency_name}
                    </div>
                    <div className="text-xs text-zinc-400 font-mono">{source.slug}</div>
                  </td>

                  {/* Entity type */}
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {source.entity_type.replace(/_/g, ' ')}
                  </td>

                  {/* County */}
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {source.county ?? source.region ?? '—'}
                  </td>

                  {/* Portal */}
                  <td className="px-4 py-3 text-zinc-500 text-xs">
                    {source.portal_provider.replace(/_/g, ' ')}
                  </td>

                  {/* Scraper status */}
                  <td className="px-4 py-3">
                    <StatusBadge value={source.scraper_status} styles={SCRAPER_STATUS_STYLES} />
                  </td>

                  {/* Legal status */}
                  <td className="px-4 py-3">
                    <StatusBadge value={source.legal_status} styles={LEGAL_STATUS_STYLES} />
                  </td>

                  {/* Health */}
                  <td className="px-4 py-3">
                    <HealthIndicator source={source} />
                  </td>

                  {/* Projects found */}
                  <td className="px-4 py-3 text-right text-zinc-600 tabular-nums">
                    {source.total_projects_discovered > 0
                      ? source.total_projects_discovered.toLocaleString()
                      : <span className="text-zinc-300">—</span>}
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
