// Re-link an orphaned R2 PDF back into bid_documents for pipeline testing.
//
// Default (object from your R2 bucket screenshot):
//   npx tsx workers/documents/run-relink-r2-document.ts
//
// Custom key:
//   npx tsx workers/documents/run-relink-r2-document.ts --r2-key "raw/caltrans/{bidId}/{docId}-name.pdf"
//
// Then run text extraction:
//   npx tsx workers/text-extraction/run-extract-text.ts --limit 1
import { loadEnvLocal } from '../scraper/env';
import {
  DEFAULT_TEST_R2_KEY,
  relinkR2Document,
} from './relink-r2-document';

function readArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

async function main() {
  loadEnvLocal({ required: true });

  const r2Key = readArg('--r2-key') ?? DEFAULT_TEST_R2_KEY;

  console.log('Re-linking orphaned R2 object into bid_documents...\n');
  console.log(`R2 key: ${r2Key}\n`);

  try {
    const result = await relinkR2Document({ r2Key });

    console.log('\n--- Relink summary ---');
    console.log(`Action:      ${result.action}`);
    console.log(`Document ID: ${result.documentId}`);
    console.log(`Bid ID:      ${result.bidId}`);
    console.log(`R2 bucket:   ${result.r2Bucket}`);
    console.log(`R2 key:      ${result.r2Key}`);
    console.log('\nNext: npx tsx workers/text-extraction/run-extract-text.ts --limit 1');
  } catch (err) {
    console.error(
      '\nFatal error:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

main();
