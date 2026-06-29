// Run with: npx tsx workers/claude-extraction/run-claude-extraction.ts
// Limit batch size: npx tsx workers/claude-extraction/run-claude-extraction.ts --limit 1
import { loadEnvLocal } from '../scraper/env';
import { runClaudeExtraction } from './save-claude-extraction';

const EXTRACTED_DOCS_PREVIEW_COUNT = 3;
const DEFAULT_LIMIT = 1;

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

  console.log('Running PrimeIntel Claude AI extraction pipeline...\n');
  console.log(`Processing limit: ${limit} eligible document(s)\n`);

  try {
    const result = await runClaudeExtraction({ limit });

    console.log('\n--- Claude extraction summary ---');
    console.log(`Documents checked:    ${result.documents_checked}`);
    console.log(`Documents extracted:  ${result.documents_extracted}`);
    console.log(`Documents skipped:    ${result.documents_skipped}`);
    console.log(`Documents failed:     ${result.documents_failed}`);
    console.log(`Errors:               ${result.errors.length}`);

    if (result.extractedDocs.length > 0) {
      console.log(`\n--- First ${EXTRACTED_DOCS_PREVIEW_COUNT} extracted ---`);
      console.log(
        JSON.stringify(
          result.extractedDocs.slice(0, EXTRACTED_DOCS_PREVIEW_COUNT),
          null,
          2,
        ),
      );
    }

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach((error) => console.log(`  - ${error}`));
    }

    if (result.documents_failed > 0) {
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
