import { createAdminClient } from '@/lib/supabase/admin';

import type {
  BidDocumentType,
  NormalizedBidDocument,
  SaveDocumentsResult,
  SavedBidRef,
  SavedDocRef,
} from './types';
import { extractCaltransDocuments } from './caltrans-documents';
import {
  formatDocumentLogLabel,
  isSessionBoundDocumentUrl,
  sanitizeErrorMessage,
} from './document-source-url';

const LOG_PREFIX = '[save-documents]';
const SOURCE_NAME = 'caltrans';

type BidDocumentInsertRow = {
  bid_id: string;
  document_type: string;
  title: string;
  source_url: string;
};

type BidDocumentRow = {
  id: string;
  bid_id: string;
  source_url: string;
  document_type: string;
  title: string | null;
};

function buildDocumentTitle(document: NormalizedBidDocument): string {
  return document.fileSize
    ? `${document.name} (${document.fileSize})`
    : document.name;
}

function toSavedDocRef(
  row: BidDocumentRow,
  document: NormalizedBidDocument,
): SavedDocRef {
  return {
    documentId: row.id,
    bidId: row.bid_id,
    sourceUrl: row.source_url,
    sourceUrlKind: document.sourceUrlKind,
    name: document.name,
    docType: row.document_type as BidDocumentType,
  };
}

function filenameFromSourceUrl(sourceUrl: string): string {
  try {
    const segment = new URL(sourceUrl).pathname.split('/').pop() ?? '';
    return decodeURIComponent(segment.replace(/\+/g, ' '));
  } catch {
    const segment = sourceUrl.split('/').pop() ?? '';
    return decodeURIComponent(segment.replace(/\+/g, ' '));
  }
}

function isEphemeralCaleprocureUrl(sourceUrl: string): boolean {
  return isSessionBoundDocumentUrl(sourceUrl);
}

type ExistingDocumentIndex = {
  byBidAndUrl: Map<string, string>;
  byBidAndFilename: Map<string, string>;
};

function buildExistingDocumentIndex(rows: BidDocumentRow[]): ExistingDocumentIndex {
  const byBidAndUrl = new Map<string, string>();
  const byBidAndFilename = new Map<string, string>();

  for (const row of rows) {
    byBidAndUrl.set(`${row.bid_id}::${row.source_url}`, row.id);

    if (isEphemeralCaleprocureUrl(row.source_url)) {
      const filename = filenameFromSourceUrl(row.source_url);
      if (filename) {
        byBidAndFilename.set(`${row.bid_id}::${filename}`, row.id);
      }
    }

    if (row.title) {
      const titleName = row.title.replace(/\s*\([^)]*\)\s*$/, '').trim();
      if (titleName) {
        byBidAndFilename.set(`${row.bid_id}::${titleName}`, row.id);
      }
    }
  }

  return { byBidAndUrl, byBidAndFilename };
}

function findExistingDocumentId(
  document: NormalizedBidDocument,
  index: ExistingDocumentIndex,
): string | undefined {
  const urlKey = `${document.bidId}::${document.sourceUrl}`;
  const byUrl = index.byBidAndUrl.get(urlKey);
  if (byUrl) {
    return byUrl;
  }

  if (isEphemeralCaleprocureUrl(document.sourceUrl)) {
    const filename = filenameFromSourceUrl(document.sourceUrl);
    return index.byBidAndFilename.get(`${document.bidId}::${filename}`);
  }

  return undefined;
}

async function lookupExistingDocuments(
  supabase: ReturnType<typeof createAdminClient>,
  bidIds: string[],
): Promise<BidDocumentRow[]> {
  const rows: BidDocumentRow[] = [];
  const lookupBatchSize = 50;

  for (let index = 0; index < bidIds.length; index += lookupBatchSize) {
    const batch = bidIds.slice(index, index + lookupBatchSize);
    const { data, error } = await supabase
      .from('bid_documents')
      .select('id, bid_id, source_url, document_type, title')
      .in('bid_id', batch);

    if (error) {
      throw new Error(`Failed to look up existing documents: ${error.message}`);
    }

    rows.push(...((data ?? []) as BidDocumentRow[]));
  }

  return rows;
}

async function upsertDocuments(
  documents: NormalizedBidDocument[],
): Promise<{
  documents_saved: number;
  documents_updated: number;
  errors: string[];
  savedDocs: SavedDocRef[];
}> {
  const supabase = createAdminClient();
  const errors: string[] = [];
  const savedDocs: SavedDocRef[] = [];
  let documents_saved = 0;
  let documents_updated = 0;

  if (documents.length === 0) {
    return { documents_saved, documents_updated, errors, savedDocs };
  }

  const bidIds = [...new Set(documents.map((doc) => doc.bidId))];

  const existingRows = await lookupExistingDocuments(supabase, bidIds);
  const existingIndex = buildExistingDocumentIndex(existingRows);

  for (const document of documents) {
    const key = `${document.bidId}::${document.sourceUrl}`;
    const existingId = findExistingDocumentId(document, existingIndex);

    try {
      const row: BidDocumentInsertRow = {
        bid_id: document.bidId,
        document_type: document.docType,
        title: buildDocumentTitle(document),
        source_url: document.sourceUrl,
      };

      const { data, error: saveError } = existingId
        ? await supabase
            .from('bid_documents')
            .update({
              document_type: row.document_type,
              title: row.title,
              source_url: row.source_url,
            })
            .eq('id', existingId)
            .select('id, bid_id, source_url, document_type, title')
            .single()
        : await supabase
            .from('bid_documents')
            .insert(row)
            .select('id, bid_id, source_url, document_type, title')
            .single();

      if (saveError || !data) {
        const message = sanitizeErrorMessage(
          `Failed to save ${formatDocumentLogLabel({
            bidId: document.bidId,
            name: document.name,
            sourceUrl: document.sourceUrl,
          })}: ${saveError?.message ?? 'no data returned'}`,
        );
        console.log(`${LOG_PREFIX} ${message}`);
        errors.push(message);
        continue;
      }

      savedDocs.push(toSavedDocRef(data as BidDocumentRow, document));

      if (existingId) {
        documents_updated += 1;
      } else {
        documents_saved += 1;
        existingIndex.byBidAndUrl.set(key, data.id);
        if (isEphemeralCaleprocureUrl(document.sourceUrl)) {
          const filename = filenameFromSourceUrl(document.sourceUrl);
          if (filename) {
            existingIndex.byBidAndFilename.set(`${document.bidId}::${filename}`, data.id);
          }
        }
      }
    } catch (err) {
      const message = sanitizeErrorMessage(
        `Failed to save ${formatDocumentLogLabel({
          bidId: document.bidId,
          name: document.name,
          sourceUrl: document.sourceUrl,
        })}: ${err instanceof Error ? err.message : String(err)}`,
      );
      console.log(`${LOG_PREFIX} ${message}`);
      errors.push(message);
    }
  }

  return { documents_saved, documents_updated, errors, savedDocs };
}

export async function loadCaltransSavedBids(): Promise<SavedBidRef[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bids')
    .select('id, source_url')
    .eq('source_name', SOURCE_NAME)
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load Caltrans bids: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    bidId: row.id as string,
    sourceUrl: row.source_url as string,
  }));
}

export async function saveCaltransDocuments(
  savedBids: SavedBidRef[],
): Promise<SaveDocumentsResult> {
  const extractResult = await extractCaltransDocuments(savedBids);

  console.log(
    `${LOG_PREFIX} Saving ${extractResult.documents_found} document record(s) to Supabase...`,
  );

  const { documents_saved, documents_updated, errors: saveErrors, savedDocs } =
    await upsertDocuments(extractResult.documents);

  const errors = [...extractResult.errors, ...saveErrors].map(sanitizeErrorMessage);

  console.log(
    `${LOG_PREFIX} Done. Bids checked: ${extractResult.bids_checked}, Documents found: ${extractResult.documents_found}, Documents saved: ${documents_saved}, Documents updated: ${documents_updated}, Errors: ${errors.length}`,
  );

  return {
    bids_checked: extractResult.bids_checked,
    documents_found: extractResult.documents_found,
    documents_saved,
    documents_updated,
    bids_with_no_documents: extractResult.bids_with_no_documents,
    auth_blocked_bids: extractResult.auth_blocked_bids,
    errors,
    savedDocs,
  };
}
