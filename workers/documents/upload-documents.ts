import { createHash } from 'node:crypto';

import { chromium, type BrowserContext } from 'playwright';

import { createAdminClient } from '@/lib/supabase/admin';
import {
  getR2BucketName,
  getR2Config,
  getStablePublicR2Url,
  uploadPdfToR2,
} from '@/lib/r2/client';
import { buildDocumentStorageKey, sanitizeFilename } from '@/lib/r2/storage-key';

import type { BidDocumentType, SavedDocRef } from '../scraper/types';
import {
  classifyDocumentSourceUrl,
  formatDocumentLogLabel,
  isSessionBoundDocumentUrl,
  sanitizeErrorMessage,
} from '../scraper/document-source-url';
import {
  CALEPROCURE_PLAYWRIGHT_USER_AGENT,
  downloadCaleprocureDocumentsForBid,
} from './download-caleprocure-document';
import {
  downloadDocument,
  type DownloadDocumentResult,
} from './download-document';

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

export type UploadPendingDocumentsOptions = {
  limit?: number;
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
    sourceUrlKind: classifyDocumentSourceUrl(row.source_url),
    name: documentNameFromRow(row),
    docType: row.document_type as BidDocumentType,
  };
}

export async function loadPendingUploadDocuments(
  limit: number,
): Promise<SavedDocRef[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bid_documents')
    .select('id, bid_id, source_url, document_type, title, r2_key')
    .is('r2_key', null)
    .not('source_url', 'is', null)
    .order('created_at', { ascending: true })
    .limit(limit);

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

  // Private bucket: r2_key holds the deterministic object key (source of truth).
  // r2_url is only set when a stable public base URL is configured.
  // Signed download URLs are generated on demand and are not stored here.
  const updatePayload: Record<string, unknown> = {
    r2_bucket: bucket,
    r2_key: r2Key,
    file_name: fileName,
    content_type: 'application/pdf',
    size_bytes: sizeBytes,
    sha256,
    downloaded_at: new Date().toISOString(),
    extraction_error: null,
  };

  const stablePublicUrl = getStablePublicR2Url(r2Key);
  if (stablePublicUrl) {
    updatePayload.r2_url = stablePublicUrl;
  }

  const { error } = await supabase
    .from('bid_documents')
    .update(updatePayload)
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

async function loadBidEventUrls(bidIds: string[]): Promise<Map<string, string>> {
  if (bidIds.length === 0) {
    return new Map();
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('bids')
    .select('id, source_url')
    .in('id', bidIds);

  if (error) {
    throw new Error(`Failed to load bid event URLs: ${error.message}`);
  }

  return new Map(
    (data ?? []).map((row) => [row.id as string, row.source_url as string]),
  );
}

function groupDocumentsByBid(documents: SavedDocRef[]): Map<string, SavedDocRef[]> {
  const grouped = new Map<string, SavedDocRef[]>();

  for (const document of documents) {
    const existing = grouped.get(document.bidId) ?? [];
    existing.push(document);
    grouped.set(document.bidId, existing);
  }

  return grouped;
}

async function uploadDownloadedDocument(
  document: SavedDocRef,
  download: DownloadDocumentResult,
): Promise<{
  ok: true;
  r2Key: string;
  sizeBytes: number;
} | {
  ok: false;
  error: string;
  skipped?: boolean;
}> {
  const label = formatDocumentLogLabel({
    documentId: document.documentId,
    bidId: document.bidId,
    name: document.name,
    sourceUrl: document.sourceUrl,
  });

  const supabase = createAdminClient();
  const { data: existing, error: lookupError } = await supabase
    .from('bid_documents')
    .select('r2_key')
    .eq('id', document.documentId)
    .single();

  if (lookupError) {
    return {
      ok: false,
      error: `Failed to look up ${label}: ${lookupError.message}`,
    };
  }

  if (existing?.r2_key) {
    console.log(`${LOG_PREFIX} Skipping ${label} — already stored at ${existing.r2_key}`);
    return { ok: false, error: 'already uploaded', skipped: true };
  }

  if (!download.ok) {
    await markDocumentDownloadFailed(document.documentId, download.error);
    return {
      ok: false,
      error: `Download failed for ${label}: ${download.error}`,
    };
  }

  const fileName = `${sanitizeFilename(document.name)}.pdf`;
  // TODO(phase-b): join bids.source_name in loadPendingUploadDocuments and pass it here
  // instead of hardcoding 'caltrans'. Safe for now — only one active source.
  const r2Key = buildDocumentStorageKey(
    'caltrans',
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
    return { ok: false, error: updateError };
  }

  console.log(
    `${LOG_PREFIX} Uploaded ${label} -> ${r2Key} (${download.sizeBytes} bytes)`,
  );

  return { ok: true, r2Key, sizeBytes: download.sizeBytes };
}

async function downloadCaleprocureBatch(
  context: BrowserContext,
  bidId: string,
  eventPageUrl: string,
  documents: SavedDocRef[],
): Promise<Map<string, DownloadDocumentResult>> {
  if (!/caleprocure\.ca\.gov\/event\//i.test(eventPageUrl)) {
    const error = failureForAll(
      documents,
      `bid ${bidId} event URL is not a CaleProcure event page: ${eventPageUrl}`,
    );
    return error;
  }

  return downloadCaleprocureDocumentsForBid(
    context,
    eventPageUrl,
    documents.map((document) => ({
      documentId: document.documentId,
      name: document.name,
      sourceUrl: document.sourceUrl,
    })),
  );
}

function failureForAll(
  documents: SavedDocRef[],
  error: string,
): Map<string, DownloadDocumentResult> {
  const results = new Map<string, DownloadDocumentResult>();
  for (const document of documents) {
    results.set(document.documentId, { ok: false, error });
  }
  return results;
}

export async function uploadDocuments(
  documents: SavedDocRef[],
): Promise<UploadDocumentsResult> {
  const errors: string[] = [];
  const uploadedDocs: UploadDocumentsResult['uploadedDocs'] = [];
  let documents_uploaded = 0;
  let documents_skipped = 0;
  let documents_failed = 0;

  console.log(`${LOG_PREFIX} Processing ${documents.length} document(s)...`);

  const regularDocuments = documents.filter(
    (document) => !isSessionBoundDocumentUrl(document.sourceUrl),
  );
  const caleprocureDocuments = documents.filter((document) =>
    isSessionBoundDocumentUrl(document.sourceUrl),
  );

  const playwrightResources: {
    browser: Awaited<ReturnType<typeof chromium.launch>> | null;
    context: BrowserContext | null;
  } = { browser: null, context: null };

  const ensurePlaywrightContext = async (): Promise<BrowserContext> => {
    if (!playwrightResources.context) {
      console.log(`${LOG_PREFIX} Launching Playwright for CaleProcure PDF downloads...`);
      playwrightResources.browser = await chromium.launch({
        headless: true,
        args: ['--disable-blink-features=AutomationControlled'],
      });
      playwrightResources.context = await playwrightResources.browser.newContext({
        userAgent: CALEPROCURE_PLAYWRIGHT_USER_AGENT,
        locale: 'en-US',
        viewport: { width: 1280, height: 720 },
        acceptDownloads: true,
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    }

    return playwrightResources.context;
  };

  try {
    for (const document of regularDocuments) {
      try {
        const download = await downloadDocument(document.sourceUrl);
        const result = await uploadDownloadedDocument(document, download);

        if (result.ok) {
          documents_uploaded += 1;
          uploadedDocs.push({
            documentId: document.documentId,
            bidId: document.bidId,
            r2Key: result.r2Key,
            sizeBytes: result.sizeBytes,
          });
          continue;
        }

        if (result.skipped) {
          documents_skipped += 1;
          continue;
        }

        documents_failed += 1;
        console.log(`${LOG_PREFIX} ${result.error}`);
        errors.push(sanitizeErrorMessage(result.error));
      } catch (err) {
        documents_failed += 1;
        const message = `Unexpected error for document ${document.documentId}: ${
          err instanceof Error ? err.message : String(err)
        }`;
        console.log(`${LOG_PREFIX} ${message}`);
        errors.push(sanitizeErrorMessage(message));
      }
    }

    if (caleprocureDocuments.length > 0) {
      const bidEventUrls = await loadBidEventUrls([
        ...new Set(caleprocureDocuments.map((document) => document.bidId)),
      ]);
      const grouped = groupDocumentsByBid(caleprocureDocuments);
      const context = await ensurePlaywrightContext();

      for (const [bidId, bidDocuments] of grouped) {
        const eventPageUrl = bidEventUrls.get(bidId);
        if (!eventPageUrl) {
          for (const document of bidDocuments) {
            documents_failed += 1;
            const message = `Missing bid event URL for bid ${bidId} (document ${document.documentId})`;
            console.log(`${LOG_PREFIX} ${message}`);
            errors.push(sanitizeErrorMessage(message));
            await markDocumentDownloadFailed(document.documentId, message);
          }
          continue;
        }

        let downloads: Map<string, DownloadDocumentResult>;
        try {
          downloads = await downloadCaleprocureBatch(
            context,
            bidId,
            eventPageUrl,
            bidDocuments,
          );
        } catch (err) {
          const message = `CaleProcure download batch failed for bid ${bidId}: ${
            err instanceof Error ? err.message : String(err)
          }`;
          console.log(`${LOG_PREFIX} ${message}`);
          downloads = failureForAll(bidDocuments, message);
        }

        for (const document of bidDocuments) {
          try {
            const download =
              downloads.get(document.documentId) ??
              ({ ok: false, error: 'no download result returned' } as const);
            const result = await uploadDownloadedDocument(document, download);

            if (result.ok) {
              documents_uploaded += 1;
              uploadedDocs.push({
                documentId: document.documentId,
                bidId: document.bidId,
                r2Key: result.r2Key,
                sizeBytes: result.sizeBytes,
              });
              continue;
            }

            if (result.skipped) {
              documents_skipped += 1;
              continue;
            }

            documents_failed += 1;
            console.log(`${LOG_PREFIX} ${result.error}`);
            errors.push(sanitizeErrorMessage(result.error));
          } catch (err) {
            documents_failed += 1;
            const message = `Unexpected error for document ${document.documentId}: ${
              err instanceof Error ? err.message : String(err)
            }`;
            console.log(`${LOG_PREFIX} ${message}`);
            errors.push(sanitizeErrorMessage(message));
          }
        }
      }
    }
  } finally {
    if (playwrightResources.context) {
      await playwrightResources.context.close();
    }
    if (playwrightResources.browser) {
      await playwrightResources.browser.close();
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

export async function uploadPendingDocuments(
  options: UploadPendingDocumentsOptions = {},
): Promise<UploadDocumentsResult> {
  getR2Config();

  const limit = options.limit ?? 3;
  const documents = await loadPendingUploadDocuments(limit);

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
