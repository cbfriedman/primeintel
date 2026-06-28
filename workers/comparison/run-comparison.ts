// Run with: npx tsx workers/comparison/run-comparison.ts
// Limit batch size: npx tsx workers/comparison/run-comparison.ts --limit 1
import { loadEnvLocal } from '../scraper/env';
import { runComparison } from './save-comparison';

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

  console.log('Running PrimeIntel comparison engine...\n');
  console.log(`Processing limit: ${limit} eligible pair(s)\n`);

  try {
    const result = await runComparison({ limit });

    console.log('\n--- Comparison summary ---');
    console.log(`Pairs checked:              ${result.pairs_checked}`);
    console.log(`Comparisons completed:      ${result.comparisons_completed}`);
    console.log(`Comparisons failed:         ${result.comparisons_failed}`);
    console.log(`Pairs skipped:              ${result.pairs_skipped}`);
    console.log(`  Exact matches (total):    ${result.exact_match_total}`);
    console.log(`  Normalized matches:       ${result.normalized_match_total}`);
    console.log(`  Conflicts:                ${result.conflict_total}`);
    console.log(`  High-risk conflicts:      ${result.high_risk_conflict_total}`);
    console.log(`  Manual reviews required:  ${result.manual_review_required_total}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach((error) => console.log(`  - ${error}`));
    }

    if (result.comparisons_failed > 0) {
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
