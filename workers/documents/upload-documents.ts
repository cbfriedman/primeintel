import { createHash } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { getR2BucketName, getR2Config, uploadPdfToR2 } from '@/lib/r2/client';
import { buildCaltransStorageKey, sanitizeFilename } from '@/lib/r2/storage-key';

import type { BidDocumentType, SavedDocRef } from '../scraper/types';
import { downloadDocument } from './download-document';

const LOG_PREFIX = '[upload-documents]';

export type UploadDocumentsResult = {
  documents_checked: number;
  documents_uploaded: number;
  documents_skipped: number;
  documents_failed: number;
  errors: string[];
  uploadedDocs: Array<{
    documentId: string;
    bidId: string;
    r2Key: string;
    sizeBytes: number;
  }>;
};

type BidDocumentRow = {
  id: string;
  bid_id: string;
  source_url: string | null;
  document_type: string;
  title: string | null;
  r2_key: string | null;
};

function documentNameFromRow(row: BidDocumentRow): string {
  if (row.title?.trim()) {
    return row.title.replace(/\s*\([^)]*\)\s*$/, '').trim();
  }

  if (row.source_url) {
    try {
      const segment = new URL(row.source_url).pathname.split('/').pop() ?? '';
      return decodeURIComponent(segment.replace(/\+/g, ' '));
    } catch {
      return 'document';
    }
  }

  return 'document';
}

function toSavedDocRef(row: BidDocumentRow): SavedDocRef | null {
  if (!row.source_url?.trim()) {
    return null;
  }

  return {
    documentId: row.id,
    bidId: row.bid_id,
    sourceUrl: row.source_url,
    name: documentNameFromRow(row),
    docType: row.document_type as BidDocumentType,
  };
}

export async function loadPendingUploadDocuments(): Promise<SavedDocRef[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bid_documents')
    .select('id, bid_id, source_url, document_type, title, r2_key')
    .is('r2_key', null)
    .not('source_url', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load pending bid documents: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => toSavedDocRef(row as BidDocumentRow))
    .filter((doc): doc is SavedDocRef => doc != null);
}

async function markDocumentUploaded(
  document: SavedDocRef,
  r2Key: string,
  sizeBytes: number,
  sha256: string,
  fileName: string,
): Promise<string | null> {
  const supabase = createAdminClient();
  const bucket = getR2BucketName();

  const { error } = await supabase
    .from('bid_documents')
    .update({
      r2_bucket: bucket,
      r2_key: r2Key,
      file_name: fileName,
      content_type: 'application/pdf',
      size_bytes: sizeBytes,
      sha256,
      downloaded_at: new Date().toISOString(),
      extraction_error: null,
    })
    .eq('id', document.documentId)
    .is('r2_key', null);

  if (error) {
    return `Failed to update bid_documents row ${document.documentId}: ${error.message}`;
  }

  return null;
}

async function markDocumentDownloadFailed(
  documentId: string,
  errorMessage: string,
): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from('bid_documents')
    .update({ extraction_error: errorMessage })
    .eq('id', documentId);
}

export async function uploadDocuments(
  documents: SavedDocRef[],
): Promise<UploadDocumentsResult> {
  getR2Config();

  const errors: string[] = [];
  const uploadedDocs: UploadDocumentsResult['uploadedDocs'] = [];
  let documents_uploaded = 0;
  let documents_skipped = 0;
  let documents_failed = 0;

  console.log(`${LOG_PREFIX} Processing ${documents.length} document(s)...`);

  for (const document of documents) {
    const label = `document ${document.documentId} (${document.sourceUrl})`;

    try {
      const supabase = createAdminClient();
      const { data: existing, error: lookupError } = await supabase
        .from('bid_documents')
        .select('r2_key')
        .eq('id', document.documentId)
        .single();

      if (lookupError) {
        documents_failed += 1;
        const message = `Failed to look up ${label}: ${lookupError.message}`;
        console.log(`${LOG_PREFIX} ${message}`);
        errors.push(message);
        continue;
      }

      if (existing?.r2_key) {
        documents_skipped += 1;
        console.log(`${LOG_PREFIX} Skipping ${label} — already stored at ${existing.r2_key}`);
        continue;
      }

      const download = await downloadDocument(document.sourceUrl);
      if (!download.ok) {
        documents_failed += 1;
        const message = `Download failed for ${label}: ${download.error}`;
        console.log(`${LOG_PREFIX} ${message}`);
        errors.push(message);
        await markDocumentDownloadFailed(document.documentId, download.error);
        continue;
      }

      const fileName = `${sanitizeFilename(document.name)}.pdf`;
      const r2Key = buildCaltransStorageKey(
        document.bidId,
        document.documentId,
        document.name,
      );
      const sha256 = createHash('sha256').update(download.buffer).digest('hex');

      await uploadPdfToR2({
        key: r2Key,
        body: download.buffer,
        metadata: {
          'document-id': document.documentId,
          'bid-id': document.bidId,
          'doc-type': document.docType,
        },
      });

      const updateError = await markDocumentUploaded(
        document,
        r2Key,
        download.sizeBytes,
        sha256,
        fileName,
      );

      if (updateError) {
        documents_failed += 1;
        console.log(`${LOG_PREFIX} ${updateError}`);
        errors.push(updateError);
        continue;
      }

      documents_uploaded += 1;
      uploadedDocs.push({
        documentId: document.documentId,
        bidId: document.bidId,
        r2Key,
        sizeBytes: download.sizeBytes,
      });

      console.log(
        `${LOG_PREFIX} Uploaded ${label} -> ${r2Key} (${download.sizeBytes} bytes)`,
      );
    } catch (err) {
      documents_failed += 1;
      const message = `Unexpected error for ${label}: ${
        err instanceof Error ? err.message : String(err)
      }`;
      console.log(`${LOG_PREFIX} ${message}`);
      errors.push(message);
    }
  }

  console.log(
    `${LOG_PREFIX} Done. Checked: ${documents.length}, Uploaded: ${documents_uploaded}, Skipped: ${documents_skipped}, Failed: ${documents_failed}, Errors: ${errors.length}`,
  );

  return {
    documents_checked: documents.length,
    documents_uploaded,
    documents_skipped,
    documents_failed,
    errors,
    uploadedDocs,
  };
}

export async function uploadPendingDocuments(): Promise<UploadDocumentsResult> {
  getR2Config();

  const documents = await loadPendingUploadDocuments();

  if (documents.length === 0) {
    console.log(`${LOG_PREFIX} No pending documents with source_url and empty r2_key.`);
    return {
      documents_checked: 0,
      documents_uploaded: 0,
      documents_skipped: 0,
      documents_failed: 0,
      errors: [],
      uploadedDocs: [],
    };
  }

  return uploadDocuments(documents);
}
