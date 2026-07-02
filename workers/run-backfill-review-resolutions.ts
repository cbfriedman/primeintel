/**
 * One-time backfill: finds manual_reviews already resolved as 'approved' or
 * 'corrected' before patchReview() started writing back to bids, and applies
 * that resolution (extraction_status, manual_review_required, corrected_fields)
 * to the bid now.
 *
 * Run with:
 *   npx tsx workers/run-backfill-review-resolutions.ts
 */

import { loadEnvLocal } from './scraper/env';
import { createAdminClient } from '@/lib/supabase/admin';

const LOG = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function main(): Promise<void> {
  loadEnvLocal();
  const supabase = createAdminClient();

  const { data: reviews, error: reviewsError } = await supabase
    .from('manual_reviews')
    .select('id, bid_id, status, corrected_fields')
    .in('status', ['approved', 'corrected']);

  if (reviewsError) {
    LOG(`Failed to load resolved reviews: ${reviewsError.message}`);
    process.exit(1);
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const review of reviews ?? []) {
    const { data: bid, error: bidFetchError } = await supabase
      .from('bids')
      .select('id, extraction_status')
      .eq('id', review.bid_id)
      .single();

    if (bidFetchError || !bid) {
      LOG(`Skip review ${review.id}: could not load bid ${review.bid_id}`);
      failed++;
      continue;
    }

    if (bid.extraction_status === 'completed') {
      skipped++;
      continue;
    }

    const { error: updateError } = await supabase
      .from('bids')
      .update({
        extraction_status: 'completed',
        manual_review_required: false,
        updated_at: new Date().toISOString(),
        ...(review.corrected_fields ?? {}),
      })
      .eq('id', review.bid_id);

    if (updateError) {
      LOG(`Failed for bid ${review.bid_id}: ${updateError.message}`);
      failed++;
      continue;
    }

    LOG(`Updated bid ${review.bid_id} from review ${review.id} (${review.status})`);
    updated++;
  }

  LOG(`Done. Updated: ${updated} | Already completed: ${skipped} | Failed: ${failed}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
