/**
 * Persists RawProject[] from any SourceConnector to the bids table.
 * Uses the same upsert-on-source_url pattern as workers/scraper/save-bids.ts,
 * but accepts the generic RawProject type instead of Caltrans-specific types.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import type { RawProject } from './types';

const LOG_PREFIX = '[save-raw-projects]';

export type SaveRawProjectsResult = {
  scrapeRunId: string;
  projects_new: number;
  projects_updated: number;
  errors: string[];
  /** All upserted bids (new + updated). */
  savedBidRefs: Array<{ bidId: string; sourceUrl: string }>;
  /** Newly inserted bids only (not previously seen source_urls). */
  newBidRefs: Array<{ bidId: string; sourceUrl: string }>;
};

type BidUpsertRow = {
  scrape_run_id: string;
  source_name: string;
  source_id: string | null;
  source_url: string;
  title: string;
  agency: string | null;
  county: string | null;
  city: string | null;
  state: string;
  bid_date: string | null;
  license_requirements: string | null;
};

function toTimestampOrNull(dateStr: string | null): string | null {
  if (!dateStr) return null;
  // Accept YYYY-MM-DD; convert to ISO timestamp at midnight UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return `${dateStr}T00:00:00.000Z`;
  }
  // Already an ISO string or similar — pass through.
  return dateStr;
}

function toUpsertRow(project: RawProject, scrapeRunId: string): BidUpsertRow {
  return {
    scrape_run_id: scrapeRunId,
    source_name: project.sourceSlug,
    source_id: project.sourceId,
    source_url: project.sourceUrl,
    title: project.title,
    agency: project.agency,
    county: project.county,
    city: project.city,
    state: 'CA',
    bid_date: toTimestampOrNull(project.bidDate),
    license_requirements: project.license,
  };
}

async function createScrapeRun(sourceSlug: string): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('scrape_runs')
    .insert({
      source_name: sourceSlug,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `${LOG_PREFIX} Failed to create scrape run for ${sourceSlug}: ${error?.message ?? 'no data'}`,
    );
  }

  return data.id;
}

async function finishScrapeRun(
  scrapeRunId: string,
  result: {
    status: 'completed' | 'failed';
    listings_found: number;
    bids_created: number;
    bids_updated: number;
    errors: string[];
    error_message?: string;
  },
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('scrape_runs')
    .update({
      status: result.status,
      finished_at: new Date().toISOString(),
      listings_found: result.listings_found,
      bids_created: result.bids_created,
      bids_updated: result.bids_updated,
      error_message: result.error_message ?? null,
      metadata: { errors: result.errors },
    })
    .eq('id', scrapeRunId);

  if (error) {
    console.error(
      `${LOG_PREFIX} Failed to update scrape run ${scrapeRunId}: ${error.message}`,
    );
  }
}

export async function saveRawProjects(
  sourceSlug: string,
  projects: RawProject[],
): Promise<SaveRawProjectsResult> {
  const scrapeRunId = await createScrapeRun(sourceSlug);
  const errors: string[] = [];
  const savedBidRefs: Array<{ bidId: string; sourceUrl: string }> = [];
  const newBidRefs: Array<{ bidId: string; sourceUrl: string }> = [];
  let projects_new = 0;
  let projects_updated = 0;

  if (projects.length === 0) {
    await finishScrapeRun(scrapeRunId, {
      status: 'completed',
      listings_found: 0,
      bids_created: 0,
      bids_updated: 0,
      errors,
    });
    return { scrapeRunId, projects_new, projects_updated, errors, savedBidRefs, newBidRefs };
  }

  const supabase = createAdminClient();

  // Bulk-check which source_urls already exist to classify new vs updated.
  const sourceUrls = projects.map((p) => p.sourceUrl);
  const { data: existing, error: lookupError } = await supabase
    .from('bids')
    .select('source_url')
    .in('source_url', sourceUrls);

  if (lookupError) {
    const msg = `Failed to look up existing bids: ${lookupError.message}`;
    await finishScrapeRun(scrapeRunId, {
      status: 'failed',
      listings_found: projects.length,
      bids_created: 0,
      bids_updated: 0,
      errors: [msg],
      error_message: msg,
    });
    throw new Error(`${LOG_PREFIX} ${msg}`);
  }

  const existingUrls = new Set((existing ?? []).map((r) => r.source_url as string));

  for (const project of projects) {
    try {
      const row = toUpsertRow(project, scrapeRunId);
      const { data, error: upsertError } = await supabase
        .from('bids')
        .upsert(row, { onConflict: 'source_url' })
        .select('id')
        .single();

      if (upsertError || !data) {
        const msg = `Failed to upsert ${project.sourceUrl}: ${upsertError?.message ?? 'no data'}`;
        console.error(`${LOG_PREFIX} ${msg}`);
        errors.push(msg);
        continue;
      }

      const ref = { bidId: data.id, sourceUrl: project.sourceUrl };
      savedBidRefs.push(ref);

      if (existingUrls.has(project.sourceUrl)) {
        projects_updated += 1;
      } else {
        newBidRefs.push(ref);
        projects_new += 1;
      }
    } catch (err) {
      const msg = `Unexpected error upserting ${project.sourceUrl}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`${LOG_PREFIX} ${msg}`);
      errors.push(msg);
    }
  }

  await finishScrapeRun(scrapeRunId, {
    status: 'completed',
    listings_found: projects.length,
    bids_created: projects_new,
    bids_updated: projects_updated,
    errors,
  });

  console.log(
    `${LOG_PREFIX} [${sourceSlug}] Done. Found: ${projects.length}, New: ${projects_new}, Updated: ${projects_updated}, Errors: ${errors.length}`,
  );

  return { scrapeRunId, projects_new, projects_updated, errors, savedBidRefs, newBidRefs };
}
