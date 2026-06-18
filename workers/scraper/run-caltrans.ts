// Run with: npx tsx workers/scraper/run-caltrans.ts
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { saveCaltransBids } from './save-bids';

const PREVIEW_COUNT = 5;

function loadEnvLocal(): void {
  const envPath = resolve(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadEnvLocal();

  console.log('Running Caltrans CCOP scraper and saving to Supabase...\n');

  try {
    const result = await saveCaltransBids();

    console.log(`\n--- First ${PREVIEW_COUNT} normalized listings ---`);
    console.log(JSON.stringify(result.listings.slice(0, PREVIEW_COUNT), null, 2));

    console.log('\n--- Summary ---');
    console.log(`Scrape run ID: ${result.scrapeRunId}`);
    console.log(`Method:        ${result.method}`);
    console.log(`Bids found:    ${result.bids_found}`);
    console.log(`Bids new:      ${result.bids_new}`);
    console.log(`Bids updated:  ${result.bids_updated}`);
    console.log(`Errors:        ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach((error) => console.log(`  - ${error}`));
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
