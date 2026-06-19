export type DownloadDocumentSuccess = {
  ok: true;
  buffer: Buffer;
  contentType: string;
  sizeBytes: number;
};

export type DownloadDocumentFailure = {
  ok: false;
  error: string;
};

export type DownloadDocumentResult = DownloadDocumentSuccess | DownloadDocumentFailure;

const DOWNLOAD_TIMEOUT_MS = 30_000;
const PDF_MAGIC = '%PDF';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FETCH_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'application/pdf,application/octet-stream,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === PDF_MAGIC;
}

function detectBlockedHtmlResponse(
  buffer: Buffer,
  contentType: string,
): string | null {
  const contentTypeLower = contentType.toLowerCase();
  const snippet = buffer.subarray(0, 12_000).toString('utf8').toLowerCase();

  const looksLikeHtml =
    contentTypeLower.includes('text/html') ||
    snippet.includes('<html') ||
    snippet.includes('<!doctype html');

  if (!looksLikeHtml) {
    return null;
  }

  if (/captcha|recaptcha|hcaptcha/.test(snippet)) {
    return 'captcha wall detected in download response';
  }

  if (/403 forbidden|access denied|permission denied/.test(snippet)) {
    return 'access denied in download response';
  }

  if (/login required|authentication required|sign\s*in|log\s*in/.test(snippet)) {
    return 'login/auth wall detected in download response';
  }

  return 'HTML response instead of PDF';
}

function validateDownloadedPdf(
  buffer: Buffer,
  contentType: string,
): string | null {
  if (buffer.length === 0) {
    return 'empty download response';
  }

  const blockedHtml = detectBlockedHtmlResponse(buffer, contentType);
  if (blockedHtml) {
    return blockedHtml;
  }

  if (!isPdfBuffer(buffer)) {
    return 'downloaded bytes do not start with %PDF';
  }

  return null;
}

export async function downloadDocument(sourceUrl: string): Promise<DownloadDocumentResult> {
  try {
    const response = await fetch(sourceUrl, {
      headers: FETCH_HEADERS,
      redirect: 'follow',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const validationError = validateDownloadedPdf(buffer, contentType);

    if (validationError) {
      return { ok: false, error: validationError };
    }

    return {
      ok: true,
      buffer,
      contentType: contentType.includes('application/pdf')
        ? 'application/pdf'
        : 'application/pdf',
      sizeBytes: buffer.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `download failed: ${message}` };
  }
}
