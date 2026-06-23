// Run with: npx tsx workers/scraper/run-caltrans-documents.ts
// Limit batch size: npx tsx workers/scraper/run-caltrans-documents.ts --limit 3
import {
  countSessionBoundDocuments,
  printDocumentDiscoveryErrors,
  printDocumentDiscoverySummary,
  printSavedDocsPreview,
  printSessionBoundUrlWarningIfNeeded,
} from './document-discovery-summary';
import { loadEnvLocal } from './env';
import { loadCaltransSavedBids, saveCaltransDocuments } from './save-documents';

const DEFAULT_LIMIT = 3;

function parseLimit(argv: string[]): number {
  const flagIndex = argv.indexOf('--limit');
  if (flagIndex === -1) {
    return DEFAULT_LIMIT;
  }

  const rawValue = argv[flagIndex + 1];
  if (!rawValue || rawValue.startsWith('--')) {
    throw new Error('--limit requires a positive integer value');
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error('--limit must be a positive integer');
  }

  return parsed;
}

async function main() {
  loadEnvLocal({ required: true });

  const limit = parseLimit(process.argv.slice(2));

  console.log('Running Caltrans document discovery against saved bids...\n');
  console.log(`Processing limit: ${limit} bid(s)\n`);

  try {
    const allSavedBids = await loadCaltransSavedBids();

    if (allSavedBids.length === 0) {
      console.log('No Caltrans bids found in Supabase. Run run-caltrans.ts first.');
      return;
    }

    const savedBids = allSavedBids.slice(0, limit);

    console.log(
      `Loaded ${allSavedBids.length} Caltrans bid(s) from Supabase; processing ${savedBids.length}.\n`,
    );

    const docResult = await saveCaltransDocuments(savedBids);

    printSessionBoundUrlWarningIfNeeded(countSessionBoundDocuments(docResult));
    printDocumentDiscoverySummary(docResult);
    printSavedDocsPreview(docResult.savedDocs);
    printDocumentDiscoveryErrors(docResult.errors);

    if (docResult.errors.length > 0) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(
      '\nFatal error:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

main();
