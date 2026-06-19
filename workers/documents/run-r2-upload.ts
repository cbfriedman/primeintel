// Run with: npx tsx workers/documents/run-r2-upload.ts
import { loadEnvLocal } from '../scraper/env';
import { uploadPendingDocuments } from './upload-documents';

const UPLOADED_DOCS_PREVIEW_COUNT = 3;

async function main() {
  loadEnvLocal({ required: true });

  console.log('Running PrimeIntel PDF download and R2 upload pipeline...\n');

  try {
    const result = await uploadPendingDocuments();

    console.log('\n--- R2 upload summary ---');
    console.log(`Documents checked:   ${result.documents_checked}`);
    console.log(`Documents uploaded:  ${result.documents_uploaded}`);
    console.log(`Documents skipped:   ${result.documents_skipped}`);
    console.log(`Documents failed:    ${result.documents_failed}`);
    console.log(`Errors:              ${result.errors.length}`);

    if (result.uploadedDocs.length > 0) {
      console.log(`\n--- First ${UPLOADED_DOCS_PREVIEW_COUNT} uploaded ---`);
      console.log(
        JSON.stringify(
          result.uploadedDocs.slice(0, UPLOADED_DOCS_PREVIEW_COUNT),
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
