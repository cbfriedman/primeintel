import { createAdminClient } from '@/lib/supabase/admin';

import type {
  BidDocumentType,
  NormalizedBidDocument,
  SaveDocumentsResult,
  SavedBidRef,
  SavedDocRef,
} from './types';
import { extractCaltransDocuments } from './caltrans-documents';

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
    name: document.name,
    docType: row.document_type as BidDocumentType,
  };
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
  const sourceUrls = documents.map((doc) => doc.sourceUrl);

  // TODO: Supabase .in() has practical limits (~100 values). Batch lookups if documents exceed that.
  const { data: existingRows, error: lookupError } = await supabase
    .from('bid_documents')
    .select('id, bid_id, source_url')
    .in('bid_id', bidIds)
    .in('source_url', sourceUrls);

  if (lookupError) {
    throw new Error(`Failed to look up existing documents: ${lookupError.message}`);
  }

  const existingByKey = new Map(
    (existingRows ?? []).map((row) => [
      `${row.bid_id}::${row.source_url}`,
      row.id as string,
    ]),
  );

  for (const document of documents) {
    const key = `${document.bidId}::${document.sourceUrl}`;
    const existingId = existingByKey.get(key);

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
        const message = `Failed to save document ${document.sourceUrl} for bid ${document.bidId}: ${
          saveError?.message ?? 'no data returned'
        }`;
        console.log(`${LOG_PREFIX} ${message}`);
        errors.push(message);
        continue;
      }

      savedDocs.push(toSavedDocRef(data as BidDocumentRow, document));

      if (existingId) {
        documents_updated += 1;
      } else {
        documents_saved += 1;
        existingByKey.set(key, data.id);
      }
    } catch (err) {
      const message = `Failed to save document ${document.sourceUrl} for bid ${document.bidId}: ${
        err instanceof Error ? err.message : String(err)
      }`;
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

  const errors = [...extractResult.errors, ...saveErrors];

  console.log(
    `${LOG_PREFIX} Done. Bids checked: ${extractResult.bids_checked}, Documents found: ${extractResult.documents_found}, Documents saved: ${documents_saved}, Documents updated: ${documents_updated}, Errors: ${errors.length}`,
  );

  return {
    bids_checked: extractResult.bids_checked,
    documents_found: extractResult.documents_found,
    documents_saved,
    documents_updated,
    errors,
    savedDocs,
  };
}
