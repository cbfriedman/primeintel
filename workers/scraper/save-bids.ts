import { createAdminClient } from '@/lib/supabase/admin';

import { scrapeCaltrans } from './caltrans';
import type { CaltransScraperResult, NormalizedBidListing } from './types';

const LOG_PREFIX = '[save-bids]';
const SOURCE_NAME = 'caltrans';

export type SavedBidRef = {
  bidId: string;
  sourceUrl: string;
};

export type SaveBidsResult = {
  scrapeRunId: string;
  method: CaltransScraperResult['method'];
  bids_found: number;
  bids_new: number;
  bids_updated: number;
  errors: string[];
  savedBids: SavedBidRef[];
  listings: NormalizedBidListing[];
};

type BidInsertRow = {
  scrape_run_id: string;
  source_name: string;
  source_id: string | null;
  source_url: string;
  title: string;
  agency: string | null;
  county: string | null;
  state: string;
  bid_date: string | null;
  license_requirements: string | null;
};

function toTimestampOrNull(date: string | null): string | null {
  if (!date) return null;
  return `${date}T00:00:00.000Z`;
}

function mapListingToBidRow(
  listing: NormalizedBidListing,
  scrapeRunId: string,
): BidInsertRow {
  return {
    scrape_run_id: scrapeRunId,
    source_name: listing.source,
    source_id: listing.sourceId,
    source_url: listing.sourceUrl,
    title: listing.title,
    agency: listing.agency,
    county: listing.county,
    state: 'CA',
    bid_date: toTimestampOrNull(listing.bidDate),
    license_requirements: listing.license,
  };
}

async function createScrapeRun(): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('scrape_runs')
    .insert({
      source_name: SOURCE_NAME,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create scrape run: ${error?.message ?? 'no data returned'}`,
    );
  }

  console.log(`${LOG_PREFIX} Created scrape run ${data.id}`);
  return data.id;
}

async function finishScrapeRun(
  scrapeRunId: string,
  update: {
    status: 'completed' | 'failed';
    listings_found: number;
    bids_created: number;
    bids_updated: number;
    errors: string[];
    metadata?: Record<string, unknown>;
    error_message?: string | null;
  },
): Promise<void> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('scrape_runs')
    .update({
      status: update.status,
      finished_at: new Date().toISOString(),
      listings_found: update.listings_found,
      bids_created: update.bids_created,
      bids_updated: update.bids_updated,
      error_message: update.error_message ?? null,
      metadata: {
        errors: update.errors,
        ...update.metadata,
      },
    })
    .eq('id', scrapeRunId);

  if (error) {
    throw new Error(`Failed to update scrape run: ${error.message}`);
  }

  console.log(`${LOG_PREFIX} Updated scrape run ${scrapeRunId} (${update.status})`);
}

async function upsertListings(
  scrapeRunId: string,
  listings: NormalizedBidListing[],
  scrapeErrors: string[],
): Promise<{
  bids_new: number;
  bids_updated: number;
  errors: string[];
  savedBids: SavedBidRef[];
}> {
  const supabase = createAdminClient();
  const errors = [...scrapeErrors];
  const savedBids: SavedBidRef[] = [];
  let bids_new = 0;
  let bids_updated = 0;

  if (listings.length === 0) {
    return { bids_new, bids_updated, errors, savedBids };
  }

  const sourceUrls = listings.map((listing) => listing.sourceUrl);

  // TODO: Supabase .in() has practical limits (~100 values). Batch lookups if listings exceed that.
  const { data: existingRows, error: lookupError } = await supabase
    .from('bids')
    .select('source_url')
    .in('source_url', sourceUrls);

  if (lookupError) {
    throw new Error(`Failed to look up existing bids: ${lookupError.message}`);
  }

  const existingUrls = new Set(
    (existingRows ?? []).map((row) => row.source_url as string),
  );

  for (const listing of listings) {
    const isNew = !existingUrls.has(listing.sourceUrl);

    try {
      const row = mapListingToBidRow(listing, scrapeRunId);
      const { data, error: upsertError } = await supabase
        .from('bids')
        .upsert(row, { onConflict: 'source_url' })
        .select('id')
        .single();

      if (upsertError || !data) {
        const message = `Failed to upsert bid ${listing.sourceUrl}: ${
          upsertError?.message ?? 'no data returned'
        }`;
        console.log(`${LOG_PREFIX} ${message}`);
        errors.push(message);
        continue;
      }

      savedBids.push({
        bidId: data.id,
        sourceUrl: listing.sourceUrl,
      });

      if (isNew) {
        bids_new += 1;
      } else {
        bids_updated += 1;
      }
    } catch (err) {
      const message = `Failed to upsert bid ${listing.sourceUrl}: ${
        err instanceof Error ? err.message : String(err)
      }`;
      console.log(`${LOG_PREFIX} ${message}`);
      errors.push(message);
    }
  }

  return { bids_new, bids_updated, errors, savedBids };
}

export async function saveCaltransBids(): Promise<SaveBidsResult> {
  const scrapeRunId = await createScrapeRun();

  try {
    console.log(`${LOG_PREFIX} Running Caltrans scraper...`);
    const scrapeResult = await scrapeCaltrans();

    console.log(
      `${LOG_PREFIX} Scraper finished. ${scrapeResult.listingsFound} bids found. Saving to Supabase...`,
    );

    const { bids_new, bids_updated, errors, savedBids } = await upsertListings(
      scrapeRunId,
      scrapeResult.listings,
      scrapeResult.errors,
    );

    try {
      await finishScrapeRun(scrapeRunId, {
        status: 'completed',
        listings_found: scrapeResult.listingsFound,
        bids_created: bids_new,
        bids_updated,
        errors,
        metadata: {
          method: scrapeResult.method,
          saved_bids: savedBids,
        },
      });
    } catch (updateErr) {
      console.error(
        `${LOG_PREFIX} Bids saved, but failed to update scrape run ${scrapeRunId}: ${
          updateErr instanceof Error ? updateErr.message : String(updateErr)
        }`,
      );
      errors.push(
        `Scrape run update failed after bid save: ${
          updateErr instanceof Error ? updateErr.message : String(updateErr)
        }`,
      );
    }

    console.log(
      `${LOG_PREFIX} Done. Found: ${scrapeResult.listingsFound}, New: ${bids_new}, Updated: ${bids_updated}, Errors: ${errors.length}`,
    );

    return {
      scrapeRunId,
      method: scrapeResult.method,
      bids_found: scrapeResult.listingsFound,
      bids_new,
      bids_updated,
      errors,
      savedBids,
      listings: scrapeResult.listings,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${LOG_PREFIX} Fatal error: ${message}`);

    try {
      await finishScrapeRun(scrapeRunId, {
        status: 'failed',
        listings_found: 0,
        bids_created: 0,
        bids_updated: 0,
        errors: [message],
        error_message: message,
      });
    } catch (updateErr) {
      console.error(
        `${LOG_PREFIX} Failed to mark scrape run as failed: ${
          updateErr instanceof Error ? updateErr.message : String(updateErr)
        }`,
      );
    }

    throw err;
  }
}
