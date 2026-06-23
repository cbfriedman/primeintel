import { createAdminClient } from '@/lib/supabase/admin';
import { getR2BucketName } from '@/lib/r2/client';

import {
  extractPdfText,
  type ExtractedPage,
  type PdfExtractionResult,
} from './extract-pdf-text';

const LOG_PREFIX = '[save-extracted-text]';

export type PendingExtractionDocument = {
  documentId: string;
  bidId: string;
  r2Key: string;
  r2Bucket: string;
};

export type TextExtractionRunResult = {
  documents_checked: number;
  documents_extracted: number;
  documents_failed: number;
  documents_ocr_required: number;
  errors: string[];
  extractedDocs: Array<{
    documentId: string;
    bidId: string;
    pageCount: number;
    textQuality: string;
    requiresOcr: boolean;
  }>;
};

export type RunTextExtractionOptions = {
  limit?: number;
};

type BidDocumentRow = {
  id: string;
  bid_id: string;
  r2_key: string | null;
  r2_bucket: string | null;
};

function formatPagesForStorage(pages: ExtractedPage[]): string {
  return pages
    .map((page) => `=== Page ${page.pageNumber} ===\n${page.text}`)
    .join('\n\n');
}

export async function loadPendingExtractionDocuments(
  limit: number,
): Promise<PendingExtractionDocument[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('bid_documents')
    .select('id, bid_id, r2_key, r2_bucket')
    .not('r2_key', 'is', null)
    .eq('text_extraction_status', 'pending')
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load pending extraction documents: ${error.message}`);
  }

  const defaultBucket = getR2BucketName();

  return (data ?? [])
    .map((row) => {
      const typed = row as BidDocumentRow;
      const r2Key = typed.r2_key?.trim();
      if (!r2Key) {
        return null;
      }

      return {
        documentId: typed.id,
        bidId: typed.bid_id,
        r2Key,
        r2Bucket: typed.r2_bucket?.trim() || defaultBucket,
      };
    })
    .filter((doc): doc is PendingExtractionDocument => doc != null);
}

async function markDocumentProcessing(documentId: string): Promise<string | null> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('bid_documents')
    .update({
      text_extraction_status: 'processing',
      extraction_error: null,
    })
    .eq('id', documentId)
    .eq('text_extraction_status', 'pending');

  if (error) {
    return `Failed to mark document ${documentId} as processing: ${error.message}`;
  }

  return null;
}

async function markDocumentCompleted(
  result: PdfExtractionResult,
): Promise<string | null> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('bid_documents')
    .update({
      text_extraction_status: 'completed',
      extracted_text: formatPagesForStorage(result.pages),
      page_count: result.pageCount,
      text_quality: result.textQuality,
      requires_ocr: result.requiresOcr,
      extraction_error: null,
    })
    .eq('id', result.documentId)
    .eq('text_extraction_status', 'processing');

  if (error) {
    return `Failed to save extracted text for document ${result.documentId}: ${error.message}`;
  }

  return null;
}

async function markDocumentFailed(
  documentId: string,
  errorMessage: string,
): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from('bid_documents')
    .update({
      text_extraction_status: 'failed',
      extraction_error: errorMessage,
    })
    .eq('id', documentId);
}

export async function runTextExtraction(
  options: RunTextExtractionOptions = {},
): Promise<TextExtractionRunResult> {
  const limit = options.limit ?? 3;
  const documents = await loadPendingExtractionDocuments(limit);
  const errors: string[] = [];
  const extractedDocs: TextExtractionRunResult['extractedDocs'] = [];
  let documents_extracted = 0;
  let documents_failed = 0;
  let documents_ocr_required = 0;

  console.log(`${LOG_PREFIX} Processing ${documents.length} document(s)...`);

  if (documents.length === 0) {
    console.log(
      `${LOG_PREFIX} No pending documents with r2_key and text_extraction_status = 'pending'.`,
    );
    return {
      documents_checked: 0,
      documents_extracted: 0,
      documents_failed: 0,
      documents_ocr_required: 0,
      errors,
      extractedDocs,
    };
  }

  for (const document of documents) {
    const label = `document ${document.documentId} (${document.r2Bucket}/${document.r2Key})`;

    try {
      const processingError = await markDocumentProcessing(document.documentId);
      if (processingError) {
        documents_failed += 1;
        console.log(`${LOG_PREFIX} ${processingError}`);
        errors.push(processingError);
        continue;
      }

      const result = await extractPdfText({
        documentId: document.documentId,
        bidId: document.bidId,
        r2Key: document.r2Key,
        r2Bucket: document.r2Bucket,
      });

      const saveError = await markDocumentCompleted(result);
      if (saveError) {
        documents_failed += 1;
        console.log(`${LOG_PREFIX} ${saveError}`);
        errors.push(saveError);
        continue;
      }

      documents_extracted += 1;
      if (result.requiresOcr) {
        documents_ocr_required += 1;
      }

      extractedDocs.push({
        documentId: result.documentId,
        bidId: result.bidId,
        pageCount: result.pageCount,
        textQuality: result.textQuality,
        requiresOcr: result.requiresOcr,
      });

      console.log(
        `${LOG_PREFIX} Extracted ${label} — ${result.pageCount} page(s), quality=${result.textQuality}, requiresOcr=${result.requiresOcr}`,
      );
    } catch (err) {
      documents_failed += 1;
      const message = `Extraction failed for ${label}: ${
        err instanceof Error ? err.message : String(err)
      }`;
      console.log(`${LOG_PREFIX} ${message}`);
      errors.push(message);
      await markDocumentFailed(document.documentId, message);
    }
  }

  console.log(
    `${LOG_PREFIX} Done. Checked: ${documents.length}, Extracted: ${documents_extracted}, Failed: ${documents_failed}, OCR required: ${documents_ocr_required}, Errors: ${errors.length}`,
  );

  return {
    documents_checked: documents.length,
    documents_extracted,
    documents_failed,
    documents_ocr_required,
    errors,
    extractedDocs,
  };
}
