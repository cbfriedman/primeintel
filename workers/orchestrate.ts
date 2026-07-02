/**
 * PrimeIntel worker orchestrator.
 * Runs the full pipeline in sequence on a configurable interval.
 * Deployed as a long-running service on Railway.
 *
 * Pipeline order:
 *   1. Scrape Caltrans bids + discover documents
 *   2. Download PDFs + upload to R2
 *   3. Extract text from PDFs
 *   4. Claude AI extraction
 *   5. OpenAI AI extraction
 *   6. Comparison + confidence scoring
 *   7. Alert matching
 *   8. Digest sending
 */

import { loadEnvLocal } from './scraper/env';
import { saveCaltransBids } from './scraper/save-bids';
import { saveCaltransDocuments } from './scraper/save-documents';
import { uploadPendingDocuments } from './documents/upload-documents';
import { runTextExtraction } from './text-extraction/save-extracted-text';
import { runClaudeExtraction } from './claude-extraction/save-claude-extraction';
import { runOpenAIExtraction } from './openai-extraction/save-openai-extraction';
import { runComparison } from './comparison/save-comparison';
import { matchAlertsForNewBids } from './alerts/match-alerts';
import { sendPendingDigests } from './alerts/send-digests';

// Batch sizes per pipeline run
const LIMITS = {
  r2Upload:        10,
  textExtraction:  10,
  claudeExtract:    5,
  openaiExtract:    5,
  comparison:      10,
  alertMatching:   20,
  digestSend:      50,
};

// How long to sleep between full pipeline runs (default: 2 hours)
const INTERVAL_MS = parseInt(process.env.PIPELINE_INTERVAL_MS ?? '7200000', 10);

const LOG = (msg: string) =>
  console.log(`[${new Date().toISOString()}] ${msg}`);

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  LOG(`▶ ${name}`);
  try {
    const result = await fn();
    LOG(`✓ ${name} done`);
    return result;
  } catch (err) {
    LOG(`✗ ${name} failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

async function runPipeline(): Promise<void> {
  LOG('=== Pipeline run starting ===');

  // 1. Scrape
  const bidResult = await step('Caltrans scraper', () => saveCaltransBids());
  if (bidResult) {
    LOG(
      `  Bids found: ${bidResult.bids_found} | new: ${bidResult.bids_new} | updated: ${bidResult.bids_updated}`,
    );
    await step('Document discovery', () =>
      saveCaltransDocuments(bidResult.savedBids),
    );
  }

  // 2. Download + R2 upload
  const uploadResult = await step('R2 upload', () =>
    uploadPendingDocuments({ limit: LIMITS.r2Upload }),
  );
  if (uploadResult) {
    LOG(
      `  Uploaded: ${uploadResult.documents_uploaded} | failed: ${uploadResult.documents_failed}`,
    );
  }

  // 3. Text extraction
  const textResult = await step('Text extraction', () =>
    runTextExtraction({ limit: LIMITS.textExtraction }),
  );
  if (textResult) {
    LOG(
      `  Extracted: ${textResult.documents_extracted} | failed: ${textResult.documents_failed}`,
    );
  }

  // 4. Claude extraction
  const claudeResult = await step('Claude extraction', () =>
    runClaudeExtraction({ limit: LIMITS.claudeExtract }),
  );
  if (claudeResult) {
    LOG(
      `  Extracted: ${claudeResult.documents_extracted} | skipped: ${claudeResult.documents_skipped} | failed: ${claudeResult.documents_failed}`,
    );
  }

  // 5. OpenAI extraction
  const openaiResult = await step('OpenAI extraction', () =>
    runOpenAIExtraction({ limit: LIMITS.openaiExtract }),
  );
  if (openaiResult) {
    LOG(
      `  Extracted: ${openaiResult.documents_extracted} | skipped: ${openaiResult.documents_skipped} | failed: ${openaiResult.documents_failed}`,
    );
  }

  // 6. Comparison
  const compResult = await step('Comparison engine', () =>
    runComparison({ limit: LIMITS.comparison }),
  );
  if (compResult) {
    LOG(
      `  Completed: ${compResult.comparisons_completed} | conflicts: ${compResult.conflict_total} | reviews: ${compResult.manual_review_required_total}`,
    );
  }

  // 7. Alert matching
  const alertMatchResult = await step('Alert matching', () =>
    matchAlertsForNewBids({ limit: LIMITS.alertMatching }),
  );
  if (alertMatchResult) {
    LOG(
      `  Bids processed: ${alertMatchResult.bids_processed} | alerts created: ${alertMatchResult.alerts_created} | failed: ${alertMatchResult.bids_failed}`,
    );
  }

  // 8. Digest sending
  const digestResult = await step('Digest sending', () =>
    sendPendingDigests({ limit: LIMITS.digestSend }),
  );
  if (digestResult) {
    LOG(`  Digests sent: ${digestResult.digests_sent} | failed: ${digestResult.digests_failed}`);
  }

  LOG(`=== Pipeline run complete. Next run in ${INTERVAL_MS / 60000} minutes ===\n`);
}

async function main(): Promise<void> {
  loadEnvLocal(); // no-op in production; loads .env.local in development

  LOG('PrimeIntel worker orchestrator starting...');
  LOG(`Pipeline interval: ${INTERVAL_MS / 60000} minutes`);

  while (true) {
    await runPipeline();
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error('Fatal orchestrator error:', err);
  process.exit(1);
});
