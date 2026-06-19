// Run with: npx tsx workers/scraper/run-caltrans-documents.ts
import { loadEnvLocal } from './env';
import { loadCaltransSavedBids, saveCaltransDocuments } from './save-documents';

const SAVED_DOCS_PREVIEW_COUNT = 3;

async function main() {
  loadEnvLocal();

  console.log('Running Caltrans document extraction against saved bids...\n');

  try {
    const savedBids = await loadCaltransSavedBids();

    if (savedBids.length === 0) {
      console.log('No Caltrans bids found in Supabase. Run run-caltrans.ts first.');
      return;
    }

    console.log(`Loaded ${savedBids.length} Caltrans bid(s) from Supabase.\n`);

    const docResult = await saveCaltransDocuments(savedBids);

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
