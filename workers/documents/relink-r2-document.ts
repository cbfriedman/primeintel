import { createAdminClient } from '@/lib/supabase/admin';
import { getR2BucketName } from '@/lib/r2/client';

const LOG_PREFIX = '[relink-r2-document]';

/** Default object from an earlier R2 upload (site-wide footer PDF — fine for pipeline testing). */
export const DEFAULT_TEST_R2_KEY =
  'raw/caltrans/09434cf7-6a26-4419-96ea-394a843223bb/9ff68102-cac4-4a65-92a3-82159735a855-HERE.pdf';

const DEFAULT_TEST_SIZE_BYTES = 647_237;

export type ParsedCaltransR2Key = {
  bidId: string;
  documentId: string;
  fileLabel: string;
  r2Key: string;
};

export type RelinkR2DocumentInput = {
  r2Key: string;
  sizeBytes?: number;
  title?: string;
};

export type RelinkR2DocumentResult = {
  documentId: string;
  bidId: string;
  r2Key: string;
  r2Bucket: string;
  action: 'inserted' | 'updated';
};

export function parseCaltransR2Key(r2Key: string): ParsedCaltransR2Key | null {
  const match = r2Key.match(
    /^raw\/caltrans\/([0-9a-f-]{36})\/([0-9a-f-]{36})-(.+)\.pdf$/i,
  );

  if (!match) {
    return null;
  }

  return {
    bidId: match[1],
    documentId: match[2],
    fileLabel: match[3],
    r2Key,
  };
}

function syntheticSourceUrl(r2Key: string): string {
  return `https://primeintel.local/r2/${encodeURIComponent(r2Key)}`;
}

export async function relinkR2Document(
  input: RelinkR2DocumentInput,
): Promise<RelinkR2DocumentResult> {
  const parsed = parseCaltransR2Key(input.r2Key);
  if (!parsed) {
    throw new Error(
      `Could not parse r2_key "${input.r2Key}". Expected format: raw/caltrans/{bidId}/{documentId}-{name}.pdf`,
    );
  }

  const supabase = createAdminClient();
  const r2Bucket = getR2BucketName();

  const { data: bid, error: bidError } = await supabase
    .from('bids')
    .select('id')
    .eq('id', parsed.bidId)
    .maybeSingle();

  if (bidError) {
    throw new Error(`Failed to look up bid ${parsed.bidId}: ${bidError.message}`);
  }

  if (!bid) {
    throw new Error(
      `Bid ${parsed.bidId} not found in Supabase. Pick an r2_key whose bid folder still exists in bids.`,
    );
  }

  const sourceUrl = syntheticSourceUrl(input.r2Key);
  const row = {
    id: parsed.documentId,
    bid_id: parsed.bidId,
    document_type: 'other',
    title: input.title ?? `R2 relink test (${parsed.fileLabel})`,
    source_url: sourceUrl,
    r2_bucket: r2Bucket,
    r2_key: input.r2Key,
    file_name: `${parsed.fileLabel}.pdf`,
    content_type: 'application/pdf',
    size_bytes: input.sizeBytes ?? DEFAULT_TEST_SIZE_BYTES,
    downloaded_at: new Date().toISOString(),
    text_extraction_status: 'pending',
    extracted_text: null,
    extraction_error: null,
    page_count: null,
    text_quality: null,
    requires_ocr: false,
  };

  const { data: existing, error: existingError } = await supabase
    .from('bid_documents')
    .select('id')
    .eq('id', parsed.documentId)
    .maybeSingle();

  if (existingError) {
    throw new Error(
      `Failed to look up document ${parsed.documentId}: ${existingError.message}`,
    );
  }

  if (existing) {
    const { error: updateError } = await supabase
      .from('bid_documents')
      .update({
        bid_id: row.bid_id,
        document_type: row.document_type,
        title: row.title,
        source_url: row.source_url,
        r2_bucket: row.r2_bucket,
        r2_key: row.r2_key,
        file_name: row.file_name,
        content_type: row.content_type,
        size_bytes: row.size_bytes,
        downloaded_at: row.downloaded_at,
        text_extraction_status: 'pending',
        extracted_text: null,
        extraction_error: null,
        page_count: null,
        text_quality: null,
        requires_ocr: false,
      })
      .eq('id', parsed.documentId);

    if (updateError) {
      throw new Error(
        `Failed to update document ${parsed.documentId}: ${updateError.message}`,
      );
    }

    console.log(
      `${LOG_PREFIX} Updated bid_documents row ${parsed.documentId} -> ${input.r2Key}`,
    );

    return {
      documentId: parsed.documentId,
      bidId: parsed.bidId,
      r2Key: input.r2Key,
      r2Bucket,
      action: 'updated',
    };
  }

  const { error: insertError } = await supabase.from('bid_documents').insert(row);

  if (insertError) {
    throw new Error(
      `Failed to insert document ${parsed.documentId}: ${insertError.message}`,
    );
  }

  console.log(
    `${LOG_PREFIX} Inserted bid_documents row ${parsed.documentId} -> ${input.r2Key}`,
  );

  return {
    documentId: parsed.documentId,
    bidId: parsed.bidId,
    r2Key: input.r2Key,
    r2Bucket,
    action: 'inserted',
  };
}
