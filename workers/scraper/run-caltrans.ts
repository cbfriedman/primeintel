// Run with: npx tsx workers/scraper/run-caltrans.ts
import { loadEnvLocal } from './env';
import { saveCaltransBids } from './save-bids';
import { saveCaltransDocuments } from './save-documents';

const PREVIEW_COUNT = 5;
const SAVED_DOCS_PREVIEW_COUNT = 3;

async function main() {
  loadEnvLocal({ required: true });

  console.log(
    'Running Caltrans CCOP scraper, saving bids, and extracting documents...\n',
  );

  try {
    const bidResult = await saveCaltransBids();

    console.log(`\n--- First ${PREVIEW_COUNT} normalized listings ---`);
    console.log(
      JSON.stringify(bidResult.listings.slice(0, PREVIEW_COUNT), null, 2),
    );

    console.log('\n--- Bid save summary ---');
    console.log(`Scrape run ID: ${bidResult.scrapeRunId}`);
    console.log(`Method:        ${bidResult.method}`);
    console.log(`Bids found:    ${bidResult.bids_found}`);
    console.log(`Bids new:      ${bidResult.bids_new}`);
    console.log(`Bids updated:  ${bidResult.bids_updated}`);
    console.log(`Errors:        ${bidResult.errors.length}`);

    if (bidResult.errors.length > 0) {
      console.log('\nBid save errors:');
      bidResult.errors.forEach((error) => console.log(`  - ${error}`));
    }

    const docResult = await saveCaltransDocuments(bidResult.savedBids);

    console.log('\n--- Document save summary ---');
    console.log(`Bids checked:        ${docResult.bids_checked}`);
    console.log(`Documents found:     ${docResult.documents_found}`);
    console.log(`Documents saved:     ${docResult.documents_saved}`);
    console.log(`Documents updated:   ${docResult.documents_updated}`);
    console.log(`Errors:              ${docResult.errors.length}`);

    if (docResult.savedDocs.length > 0) {
      console.log(`\n--- First ${SAVED_DOCS_PREVIEW_COUNT} savedDocs ---`);
      console.log(
        JSON.stringify(
          docResult.savedDocs.slice(0, SAVED_DOCS_PREVIEW_COUNT),
          null,
          2,
        ),
      );
    }

    if (docResult.errors.length > 0) {
      console.log('\nDocument errors:');
      docResult.errors.forEach((error) => console.log(`  - ${error}`));
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
