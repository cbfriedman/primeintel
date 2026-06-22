// Run with: npx tsx workers/documents/run-cleanup-invalid-documents.ts
// Apply deletions: npx tsx workers/documents/run-cleanup-invalid-documents.ts --apply
import { loadEnvLocal } from '../scraper/env';
import { cleanupInvalidDocuments } from './cleanup-invalid-documents';

const INVALID_DOCS_PREVIEW_COUNT = 5;

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function main() {
  loadEnvLocal({ required: true });

  const apply = hasFlag('--apply');
  const includeUploaded = hasFlag('--include-uploaded');

  console.log('Running PrimeIntel invalid bid_documents cleanup...\n');
  if (!apply) {
    console.log('Dry run only. Re-run with --apply to delete matching rows.\n');
  }

  try {
    const result = await cleanupInvalidDocuments({ apply, includeUploaded });

    console.log('\n--- Cleanup summary ---');
    console.log(`Documents scanned:  ${result.documents_scanned}`);
    console.log(`Documents invalid:  ${result.documents_invalid}`);
    console.log(`Documents deleted:  ${result.documents_deleted}`);
    console.log(`Errors:             ${result.errors.length}`);

    if (Object.keys(result.by_reason).length > 0) {
      console.log('\n--- Invalid by reason ---');
      for (const [reason, count] of Object.entries(result.by_reason)) {
        console.log(`  ${reason}: ${count}`);
      }
    }

    if (result.invalidDocs.length > 0) {
      console.log(`\n--- First ${INVALID_DOCS_PREVIEW_COUNT} invalid ---`);
      console.log(
        JSON.stringify(
          result.invalidDocs.slice(0, INVALID_DOCS_PREVIEW_COUNT),
          null,
          2,
        ),
      );
    }

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach((error) => console.log(`  - ${error}`));
    }

    if (!apply && result.documents_invalid > 0) {
      console.log(
        '\nTo delete pending invalid rows (and site-wide noise even if uploaded):',
      );
      console.log('  npx tsx workers/documents/run-cleanup-invalid-documents.ts --apply');
      console.log(
        '\nTo also delete other invalid rows that already have r2_key:',
      );
      console.log(
        '  npx tsx workers/documents/run-cleanup-invalid-documents.ts --apply --include-uploaded',
      );
    }

    if (result.errors.length > 0) {
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
