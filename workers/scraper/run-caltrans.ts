// Run with: npx tsx workers/scraper/run-caltrans.ts
import { scrapeCaltrans } from './caltrans';

const PREVIEW_COUNT = 5;

async function main() {
  console.log('Running Caltrans CCOP scraper...\n');

  try {
    const result = await scrapeCaltrans();

    console.log(`\n--- First ${PREVIEW_COUNT} normalized listings ---`);
    console.log(JSON.stringify(result.listings.slice(0, PREVIEW_COUNT), null, 2));

    console.log('\n--- Summary ---');
    console.log(`Source:  ${result.source}`);
    console.log(`Method:  ${result.method}`);
    console.log(`Found:   ${result.listingsFound}`);
    console.log(`Errors:  ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach((error) => console.log(`  - ${error}`));
    }

    const nullBidDates = result.listings.filter((listing) => listing.bidDate === null).length;
    if (nullBidDates > 0) {
      console.log(`\nNote: ${nullBidDates} listing(s) have a null bidDate.`);
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
