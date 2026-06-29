/**
 * Document URL durability for Caltrans/CaleProcure discovery.
 *
 * Some CaleProcure links are PeopleSoft `viewredirect` URLs that embed a
 * short-lived session token. They are not permanent document URLs:
 * - plain fetch without cookies returns 403
 * - the token expires after the browser session ends
 *
 * During R2 upload, CaleProcure discovery and download must reuse the same
 * Playwright browser context/session (see download-caleprocure-document.ts).
 * Stable direct PDF URLs may continue through the normal savedDocs pipeline.
 */
import type { SavedDocRef } from './types';

export type DocumentSourceUrlKind = 'stable_direct' | 'session_bound_caleprocure';

export const SESSION_BOUND_URL_WARNING =
  'WARNING: CaleProcure document URLs may be temporary or session-bound. They must be refreshed or downloaded within the active Playwright session and must not be treated as permanent URLs.';

const SESSION_BOUND_VIEWREDIRECT_PATTERN =
  /https?:\/\/caleprocure\.ca\.gov[^\s"'<>\\]*viewredirect[^\s"'<>\\]*/gi;

export function classifyDocumentSourceUrl(sourceUrl: string): DocumentSourceUrlKind {
  if (/caleprocure\.ca\.gov.*viewredirect/i.test(sourceUrl)) {
    return 'session_bound_caleprocure';
  }

  return 'stable_direct';
}

export function isSessionBoundDocumentUrl(sourceUrl: string): boolean {
  return classifyDocumentSourceUrl(sourceUrl) === 'session_bound_caleprocure';
}

function filenameFromUrlPath(sourceUrl: string): string | null {
  try {
    const segment = new URL(sourceUrl).pathname.split('/').pop() ?? '';
    if (!segment) {
      return null;
    }

    return decodeURIComponent(segment.replace(/\+/g, ' '));
  } catch {
    const segment = sourceUrl.split('/').pop() ?? '';
    return segment ? decodeURIComponent(segment.replace(/\+/g, ' ')) : null;
  }
}

export function sanitizeDocumentUrlForLog(sourceUrl: string): string {
  if (isSessionBoundDocumentUrl(sourceUrl)) {
    const filename = filenameFromUrlPath(sourceUrl);
    if (filename) {
      return `CaleProcure session-bound document (caleprocure.ca.gov/.../${filename})`;
    }

    return 'CaleProcure session-bound document';
  }

  try {
    const url = new URL(sourceUrl);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return sourceUrl.split('?')[0]?.split('#')[0] ?? 'document URL';
  }
}

export function formatDocumentLogLabel(input: {
  documentId?: string;
  bidId: string;
  name?: string;
  sourceUrl?: string;
}): string {
  const idPart = input.documentId ? `document ${input.documentId}` : 'document';
  const namePart = input.name ? ` "${input.name}"` : '';
  const urlPart = input.sourceUrl ? ` — ${sanitizeDocumentUrlForLog(input.sourceUrl)}` : '';

  return `${idPart}${namePart} (bid ${input.bidId})${urlPart}`;
}

export function sanitizeSavedDocForDisplay(doc: SavedDocRef): SavedDocRef {
  return {
    ...doc,
    sourceUrl: sanitizeDocumentUrlForLog(doc.sourceUrl),
  };
}

export function sanitizeErrorMessage(message: string): string {
  return message.replace(
    SESSION_BOUND_VIEWREDIRECT_PATTERN,
    'CaleProcure session-bound document URL (redacted)',
  );
}

export function logSessionBoundDocumentUrl(
  logPrefix: string,
  bidId: string,
  name: string,
): void {
  console.log(
    `${logPrefix} Bid ${bidId}: discovered CaleProcure session-bound document (caleprocure.ca.gov/.../${name})`,
  );
}
