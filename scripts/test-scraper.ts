// Run with: npx tsx scripts/test-scraper.ts
import { scrapeCaltransCcop } from '../lib/scrapers/sources/caltrans-ccop';

async function main() {
  console.log('Fetching Caltrans CCOP listings...\n');

  try {
    const result = await scrapeCaltransCcop();

    // Print first 5 listings in full
    console.log('--- First 5 listings ---');
    console.log(JSON.stringify(result.listings.slice(0, 5), null, 2));

    // Summary
    console.log('\n--- Summary ---');
    console.log(`Source:  ${result.source}`);
    console.log(`Found:   ${result.listingsFound}`);
    console.log(`Errors:  ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\nErrors:');
      result.errors.forEach((e) => console.log(`  - ${e}`));
    }

    // Spot-check: how many rows have a null bidDate?
    const nullBidDates = result.listings.filter((l) => l.bidDate === null).length;
    if (nullBidDates > 0) {
      console.log(`\nWarning: ${nullBidDates} listing(s) have a null bidDate.`);
    }

    // Spot-check: destination split
    const serviceNow = result.listings.filter((l) =>
      l.sourceUrl.includes('service-now.com'),
    ).length;
    const caleProcure = result.listings.filter((l) =>
      l.sourceUrl.includes('caleprocure.ca.gov'),
    ).length;
    const other = result.listingsFound - serviceNow - caleProcure;
    console.log(
      `\nURL destinations: ${caleProcure} CaleProcure, ${serviceNow} ServiceNow, ${other} other`,
    );
  } catch (err) {
    console.error(
      '\nFatal error:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

main();
