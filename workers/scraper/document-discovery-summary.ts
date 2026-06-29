import type { SaveDocumentsResult, SavedDocRef } from './types';
import {
  SESSION_BOUND_URL_WARNING,
  sanitizeSavedDocForDisplay,
} from './document-source-url';

const SAVED_DOCS_PREVIEW_COUNT = 3;

export function countSessionBoundDocuments(docResult: SaveDocumentsResult): number {
  return docResult.savedDocs.filter(
    (doc) => doc.sourceUrlKind === 'session_bound_caleprocure',
  ).length;
}

export function printSessionBoundUrlWarningIfNeeded(sessionBoundCount: number): void {
  if (sessionBoundCount > 0) {
    console.log(`\n${SESSION_BOUND_URL_WARNING}`);
  }
}

export function printDocumentDiscoverySummary(docResult: SaveDocumentsResult): void {
  console.log('\n--- Document discovery summary ---');
  console.log(`Bids checked:                 ${docResult.bids_checked}`);
  console.log(`Documents found:              ${docResult.documents_found}`);
  console.log(`Documents saved:              ${docResult.documents_saved}`);
  console.log(`Documents updated:            ${docResult.documents_updated}`);
  console.log(`Bids with no document links:  ${docResult.bids_with_no_documents}`);
  console.log(`Authentication-blocked pages:   ${docResult.auth_blocked_bids}`);
  console.log(`Errors:                       ${docResult.errors.length}`);
}

export function printSavedDocsPreview(
  savedDocs: SavedDocRef[],
  previewCount = SAVED_DOCS_PREVIEW_COUNT,
): void {
  if (savedDocs.length === 0) {
    return;
  }

  console.log(`\n--- First ${previewCount} savedDocs ---`);
  console.log(
    JSON.stringify(
      savedDocs.slice(0, previewCount).map(sanitizeSavedDocForDisplay),
      null,
      2,
    ),
  );
}

export function printDocumentDiscoveryErrors(errors: string[]): void {
  if (errors.length === 0) {
    return;
  }

  console.log('\nDocument errors:');
  errors.forEach((error) => console.log(`  - ${error}`));
}
