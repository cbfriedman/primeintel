/**
 * Runs all active non-Caltrans sources through the scrape → save pipeline.
 *
 * Caltrans continues to use its own proven path (saveCaltransBids /
 * saveCaltransDocuments) during the transition. Once Phase C lands and the
 * CaleProcure adapter is fully validated, Caltrans can be moved here too.
 *
 * For each active source this function:
 *   1. discoverProjects  — fetches all current bid listings
 *   2. saveRawProjects   — upserts new/updated bids in Supabase
 *   3. discoverDocuments — finds document links for new bids
 *   4. saves documents   — inserts bid_documents rows for download queue
 *   5. updates health    — records success/failure on the sources row
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveConnectors } from './registry';
import { saveRawProjects } from './save-raw-projects';
import {
  recordSourceSuccess,
  recordSourceFailure,
  incrementSourceTotals,
} from './health-updater';
import type { RawDocument, SourceConnector } from './types';

const LOG_PREFIX = '[run-sources]';

// Slugs handled by the legacy Caltrans path; skip them here.
const LEGACY_SLUGS = new Set(['caltrans']);

export type RunSourcesResult = {
  sources_attempted: number;
  sources_succeeded: number;
  sources_failed: number;
  total_projects_new: number;
  total_projects_updated: number;
  total_documents_queued: number;
  errors: string[];
};

// ---------------------------------------------------------------------------
// Document discovery and queuing
// ---------------------------------------------------------------------------

type SavedBidRef = { bidId: string; sourceUrl: string };

type DocumentInsertRow = {
  bid_id: string;
  document_type: string;
  title: string;
  source_url: string;
};

function toDocInsertRow(
  bidId: string,
  doc: RawDocument,
): DocumentInsertRow {
  return {
    bid_id: bidId,
    document_type: doc.docType,
    title: doc.filename,
    source_url: doc.sourceUrl,
  };
}

async function saveDocuments(
  savedBidRefs: SavedBidRef[],
  connector: SourceConnector,
): Promise<{ queued: number; errors: string[] }> {
  const supabase = createAdminClient();
  const errors: string[] = [];
  let queued = 0;

  for (const ref of savedBidRefs) {
    try {
      const project = {
        sourceSlug: connector.config.slug,
        sourceId: null,
        sourceUrl: ref.sourceUrl,
        title: '',
        agency: null,
        county: null,
        city: null,
        bidDate: null,
        advertiseDate: null,
        license: null,
        status: null,
        rawData: {},
      };

      const docs = await connector.discoverDocuments(project);

      if (docs.length === 0) continue;

      const rows = docs.map((doc) => toDocInsertRow(ref.bidId, doc));

      const { error } = await supabase
        .from('bid_documents')
        .upsert(rows, { onConflict: 'bid_id,source_url' })
        .select('id');

      if (error) {
        const msg = `Failed to save documents for bid ${ref.bidId}: ${error.message}`;
        console.error(`${LOG_PREFIX} ${msg}`);
        errors.push(msg);
        continue;
      }

      queued += docs.length;
    } catch (err) {
      const msg = `Document discovery error for ${ref.sourceUrl}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`${LOG_PREFIX} ${msg}`);
      errors.push(msg);
    }
  }

  return { queued, errors };
}

// ---------------------------------------------------------------------------
// Per-source runner
// ---------------------------------------------------------------------------

async function runOneSource(connector: SourceConnector): Promise<{
  projects_new: number;
  projects_updated: number;
  documents_queued: number;
  errors: string[];
}> {
  const slug = connector.config.slug;
  const label = `[${slug}]`;

  console.log(`${LOG_PREFIX} ${label} Starting...`);

  // 1. Discover projects
  let projects;
  try {
    const result = await connector.discoverProjects();
    projects = result.projects;
    console.log(`${LOG_PREFIX} ${label} Discovered ${projects.length} project(s)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} ${label} discoverProjects failed: ${msg}`);
    await recordSourceFailure(slug, msg);
    return { projects_new: 0, projects_updated: 0, documents_queued: 0, errors: [msg] };
  }

  // 2. Save projects
  let saveResult;
  try {
    saveResult = await saveRawProjects(slug, projects);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} ${label} saveRawProjects failed: ${msg}`);
    await recordSourceFailure(slug, msg);
    return { projects_new: 0, projects_updated: 0, documents_queued: 0, errors: [msg] };
  }

  // 3. Discover and queue documents for newly created bids only.
  //    Updating existing bids doesn't trigger re-download.
  const newBidRefs = saveResult.newBidRefs;
  const { queued, errors: docErrors } = await saveDocuments(newBidRefs, connector);

  // 4. Update health — success even if some document discovery failed.
  await recordSourceSuccess(slug, projects.length);
  await incrementSourceTotals(slug, saveResult.projects_new, queued);

  const allErrors = [...saveResult.errors, ...docErrors];

  console.log(
    `${LOG_PREFIX} ${label} Done. New: ${saveResult.projects_new}, Updated: ${saveResult.projects_updated}, Docs queued: ${queued}, Errors: ${allErrors.length}`,
  );

  return {
    projects_new: saveResult.projects_new,
    projects_updated: saveResult.projects_updated,
    documents_queued: queued,
    errors: allErrors,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runAdditionalSources(): Promise<RunSourcesResult> {
  console.log(`${LOG_PREFIX} Loading active connectors (excluding legacy: ${[...LEGACY_SLUGS].join(', ')})...`);

  const connectors = await getActiveConnectors({
    excludeSlugs: [...LEGACY_SLUGS],
  });

  if (connectors.length === 0) {
    console.log(`${LOG_PREFIX} No additional active sources to run.`);
    return {
      sources_attempted: 0,
      sources_succeeded: 0,
      sources_failed: 0,
      total_projects_new: 0,
      total_projects_updated: 0,
      total_documents_queued: 0,
      errors: [],
    };
  }

  console.log(`${LOG_PREFIX} Running ${connectors.length} source(s)...`);

  let sources_succeeded = 0;
  let sources_failed = 0;
  let total_projects_new = 0;
  let total_projects_updated = 0;
  let total_documents_queued = 0;
  const allErrors: string[] = [];

  // Run sources sequentially to avoid hammering Supabase or portal sites.
  for (const connector of connectors) {
    const result = await runOneSource(connector);

    if (result.errors.some((e) => e.includes('discoverProjects failed') || e.includes('saveRawProjects failed'))) {
      sources_failed += 1;
    } else {
      sources_succeeded += 1;
    }

    total_projects_new += result.projects_new;
    total_projects_updated += result.projects_updated;
    total_documents_queued += result.documents_queued;
    allErrors.push(...result.errors);
  }

  console.log(
    `${LOG_PREFIX} All done. Succeeded: ${sources_succeeded}, Failed: ${sources_failed}, ` +
    `New projects: ${total_projects_new}, Docs queued: ${total_documents_queued}`,
  );

  return {
    sources_attempted: connectors.length,
    sources_succeeded,
    sources_failed,
    total_projects_new,
    total_projects_updated,
    total_documents_queued,
    errors: allErrors,
  };
}
