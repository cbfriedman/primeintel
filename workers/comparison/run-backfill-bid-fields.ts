/**
 * One-time backfill: reads all completed ai_extraction_comparisons and writes
 * the consensus extracted fields back to the bids table.
 *
 * Run with:
 *   npx tsx workers/comparison/run-backfill-bid-fields.ts
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { loadEnvLocal } from '../scraper/env';
import { extractedFieldsSchema } from '../claude-extraction/schema';
import { comparisonResultSchema } from './comparison-schema';
import { writeBidFieldsFromComparison } from './write-bid-fields';
import { writeRiskFlagsFromComparison } from './write-risk-flags';

const LOG = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

async function main(): Promise<void> {
  loadEnvLocal();

  const supabase = createAdminClient();

  const { data: comparisons, error: compError } = await supabase
    .from('ai_extraction_comparisons')
    .select('id, bid_id, claude_run_id, comparison_result')
    .eq('status', 'completed');

  if (compError) {
    LOG(`Failed to load comparisons: ${compError.message}`);
    process.exit(1);
  }

  const rows = comparisons ?? [];
  LOG(`Found ${rows.length} completed comparison(s) to backfill`);

  let success = 0;
  let failed = 0;

  for (const comp of rows) {
    const compValidated = comparisonResultSchema.safeParse(comp.comparison_result);
    if (!compValidated.success) {
      LOG(`Skip comparison ${comp.id}: invalid comparison_result — ${compValidated.error.issues[0]?.message ?? 'unknown'}`);
      failed++;
      continue;
    }

    const { data: claudeRun, error: runError } = await supabase
      .from('ai_extraction_runs')
      .select('parsed_output')
      .eq('id', comp.claude_run_id)
      .single();

    if (runError || !claudeRun?.parsed_output) {
      LOG(`Skip comparison ${comp.id}: could not load Claude run ${comp.claude_run_id}`);
      failed++;
      continue;
    }

    const output = claudeRun.parsed_output as Record<string, unknown>;
    const fieldsValidated = extractedFieldsSchema.safeParse(output.fields);
    if (!fieldsValidated.success) {
      LOG(`Skip comparison ${comp.id}: Claude fields invalid — ${fieldsValidated.error.issues[0]?.message ?? 'unknown'}`);
      failed++;
      continue;
    }

    try {
      await writeBidFieldsFromComparison({
        bidId: comp.bid_id,
        comparisonResult: compValidated.data,
        claudeFields: fieldsValidated.data,
      });

      try {
        await writeRiskFlagsFromComparison({
          bidId: comp.bid_id,
          claudeFields: fieldsValidated.data,
        });
      } catch (riskErr) {
        LOG(`Warning: risk flag write-back failed for bid ${comp.bid_id}: ${riskErr instanceof Error ? riskErr.message : String(riskErr)}`);
      }

      LOG(`Wrote fields for bid ${comp.bid_id}`);
      success++;
    } catch (err) {
      LOG(`Failed for bid ${comp.bid_id}: ${err instanceof Error ? err.message : String(err)}`);
      failed++;
    }
  }

  LOG(`Done. Success: ${success} | Failed: ${failed}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
