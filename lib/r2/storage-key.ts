const MAX_FILENAME_LENGTH = 120;

export function sanitizeFilename(name: string): string {
  const withoutExtension = name.replace(/\.pdf$/i, '').trim();
  const sanitized = withoutExtension
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const base = sanitized || 'document';
  return base.slice(0, MAX_FILENAME_LENGTH);
}

export function buildDocumentStorageKey(
  sourceSlug: string,
  bidId: string,
  documentId: string,
  filename: string,
): string {
  const sanitized = sanitizeFilename(filename);
  return `raw/${sourceSlug}/${bidId}/${documentId}-${sanitized}.pdf`;
}

/** @deprecated Use buildDocumentStorageKey(sourceSlug, bidId, documentId, filename) */
export function buildCaltransStorageKey(
  bidId: string,
  documentId: string,
  filename: string,
): string {
  return buildDocumentStorageKey('caltrans', bidId, documentId, filename);
}
