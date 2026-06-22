import { createAdminClient } from '@/lib/supabase/admin';

const LOG_PREFIX = '[cleanup-invalid-documents]';

export type InvalidDocumentReason =
  | 'hash_placeholder_url'
  | 'api_endpoint'
  | 'caleprocure_event_page'
  | 'site_wide_noise'
  | 'not_likely_document_url';

export type InvalidDocumentRow = {
  id: string;
  bidId: string;
  sourceUrl: string;
  title: string | null;
  r2Key: string | null;
  reason: InvalidDocumentReason;
};

export type CleanupInvalidDocumentsOptions = {
  /** When false, report matches without deleting. Default: true (dry run). */
  apply?: boolean;
  /** When true, also delete invalid rows that already have an r2_key. Default: false. */
  includeUploaded?: boolean;
};

export type CleanupInvalidDocumentsResult = {
  documents_scanned: number;
  documents_invalid: number;
  documents_deleted: number;
  by_reason: Partial<Record<InvalidDocumentReason, number>>;
  invalidDocs: InvalidDocumentRow[];
  errors: string[];
};

type BidDocumentRow = {
  id: string;
  bid_id: string;
  source_url: string | null;
  title: string | null;
  r2_key: string | null;
};

function isLikelyDocumentUrl(url: string): boolean {
  if (/\/api\//i.test(url) || /access_token=/i.test(url)) {
    return false;
  }

  if (/csm_login|\/login|signin|register/i.test(url)) {
    return false;
  }

  if (/\.pdf(\?|#|$)/i.test(url)) return true;
  if (/\.docx?(\?|#|$)/i.test(url)) return true;
  if (/\.xlsx?(\?|#|$)/i.test(url)) return true;
  if (/sys_attachment\.do/i.test(url)) return true;

  return false;
}

export function classifyInvalidDocumentUrl(
  sourceUrl: string,
  title?: string | null,
): InvalidDocumentReason | null {
  const url = sourceUrl.trim();
  if (!url) {
    return 'not_likely_document_url';
  }

  if (url.endsWith('#') || url.endsWith('/#')) {
    return 'hash_placeholder_url';
  }

  if (/\/api\//i.test(url) || /access_token=/i.test(url)) {
    return 'api_endpoint';
  }

  const combined = `${title ?? ''} ${url}`.toLowerCase();
  if (
    /diversity.*data.*procedures|site_maintenance|site_banner/.test(combined)
  ) {
    return 'site_wide_noise';
  }

  if (/caleprocure\.ca\.gov\/event\//i.test(url) && !/\.pdf/i.test(url)) {
    return 'caleprocure_event_page';
  }

  if (!isLikelyDocumentUrl(url)) {
    return 'not_likely_document_url';
  }

  return null;
}

function shouldDeleteRow(
  row: InvalidDocumentRow,
  includeUploaded: boolean,
): boolean {
  if (row.reason === 'site_wide_noise') {
    return true;
  }

  if (row.r2Key) {
    return includeUploaded;
  }

  return true;
}

const DELETE_BATCH_SIZE = 100;

export async function cleanupInvalidDocuments(
  options: CleanupInvalidDocumentsOptions = {},
): Promise<CleanupInvalidDocumentsResult> {
  const apply = options.apply ?? false;
  const includeUploaded = options.includeUploaded ?? false;

  const supabase = createAdminClient();
  const errors: string[] = [];
  const by_reason: Partial<Record<InvalidDocumentReason, number>> = {};
  const invalidDocs: InvalidDocumentRow[] = [];

  const { data, error } = await supabase
    .from('bid_documents')
    .select('id, bid_id, source_url, title, r2_key')
    .not('source_url', 'is', null)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(`Failed to load bid documents: ${error.message}`);
  }

  const rows = (data ?? []) as BidDocumentRow[];

  for (const row of rows) {
    const sourceUrl = row.source_url?.trim();
    if (!sourceUrl) continue;

    const reason = classifyInvalidDocumentUrl(sourceUrl, row.title);
    if (!reason) continue;

    by_reason[reason] = (by_reason[reason] ?? 0) + 1;

    invalidDocs.push({
      id: row.id,
      bidId: row.bid_id,
      sourceUrl,
      title: row.title,
      r2Key: row.r2_key,
      reason,
    });
  }

  const toDelete = invalidDocs.filter((row) =>
    shouldDeleteRow(row, includeUploaded),
  );

  let documents_deleted = 0;

  if (apply && toDelete.length > 0) {
    for (let i = 0; i < toDelete.length; i += DELETE_BATCH_SIZE) {
      const batch = toDelete.slice(i, i + DELETE_BATCH_SIZE);
      const ids = batch.map((row) => row.id);

      const { error: deleteError } = await supabase
        .from('bid_documents')
        .delete()
        .in('id', ids);

      if (deleteError) {
        const message = `Failed to delete document batch starting at index ${i}: ${deleteError.message}`;
        console.log(`${LOG_PREFIX} ${message}`);
        errors.push(message);
        continue;
      }

      documents_deleted += batch.length;
    }
  }

  const mode = apply ? 'apply' : 'dry-run';
  console.log(
    `${LOG_PREFIX} ${mode}. Scanned: ${rows.length}, Invalid: ${invalidDocs.length}, Selected for deletion: ${toDelete.length}, Deleted: ${documents_deleted}`,
  );

  return {
    documents_scanned: rows.length,
    documents_invalid: invalidDocs.length,
    documents_deleted,
    by_reason,
    invalidDocs,
    errors,
  };
}
