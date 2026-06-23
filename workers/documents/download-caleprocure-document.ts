/**
 * CaleProcure PDF download via Playwright.
 *
 * Session-bound `viewredirect` URLs from document discovery must be downloaded
 * in the same browser context/session as package discovery. See
 * workers/scraper/document-source-url.ts for URL durability rules.
 */

import type { BrowserContext, Page } from 'playwright';

import type { DownloadDocumentResult } from './download-document';
import {
  getMaxDownloadBytes,
  validateDownloadedPdf,
} from './download-document';

const LOG_PREFIX = '[download-caleprocure]';
const CALEPROCURE_PLAYWRIGHT_TIMEOUT_MS = 60_000;
const CALEPROCURE_HYDRATION_TIMEOUT_MS = 45_000;
const CALEPROCURE_PACKAGE_TIMEOUT_MS = 30_000;
const CALEPROCURE_DOWNLOAD_TIMEOUT_MS = 60_000;
const CALEPROCURE_ATTACHMENT_WAIT_MS = 20_000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export type CaleprocureDownloadRequest = {
  documentId: string;
  name: string;
  sourceUrl: string;
};

function normalizeFilename(name: string): string {
  return name.trim().toLowerCase().replace(/\.pdf$/i, '');
}

function failure(error: string): DownloadDocumentResult {
  return { ok: false, error };
}

async function waitForCaleprocureEventHydration(page: Page): Promise<boolean> {
  try {
    await page.waitForFunction(
      () => {
        const main = document.querySelector('#main');
        const eventName = document.querySelector('[data-if-label="eventName"]');
        return (
          main != null &&
          !main.classList.contains('hidden') &&
          (eventName?.textContent?.trim().length ?? 0) > 0
        );
      },
      { timeout: CALEPROCURE_HYDRATION_TIMEOUT_MS },
    );
    return true;
  } catch {
    return false;
  }
}

async function closeCaleprocureAttachmentModal(page: Page): Promise<void> {
  await page.evaluate(() => {
    const modal = document.querySelector('#attachmentWrapperModal');
    if (modal) {
      modal.classList.remove('in');
      (modal as HTMLElement).style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }

    document.querySelectorAll('.modal-backdrop').forEach((element) => element.remove());
    document.body.classList.remove('modal-open');
  });
}

async function openCaleprocurePackage(page: Page, eventPageUrl: string): Promise<string | null> {
  await page.goto(eventPageUrl, {
    timeout: CALEPROCURE_PLAYWRIGHT_TIMEOUT_MS,
    waitUntil: 'load',
  });
  await page
    .waitForLoadState('networkidle', { timeout: CALEPROCURE_PLAYWRIGHT_TIMEOUT_MS })
    .catch(() => undefined);

  const hydrated = await waitForCaleprocureEventHydration(page);
  if (!hydrated) {
    return 'CaleProcure event page did not hydrate';
  }

  const viewPackageButton = page.locator('button[data-if-label="viewPackage"]');
  if ((await viewPackageButton.count()) === 0) {
    return 'viewPackage button not found';
  }

  if (!(await viewPackageButton.isEnabled())) {
    return 'viewPackage button disabled (no package available)';
  }

  await viewPackageButton.click({ timeout: 10_000 });

  try {
    await page.waitForSelector('[id^="PV_ATTACH_WRK_SCM_DOWNLOAD$"]', {
      timeout: CALEPROCURE_PACKAGE_TIMEOUT_MS,
    });
  } catch {
    return 'viewPackage opened but no attachment download buttons appeared';
  }

  return null;
}

async function findAttachmentButtonId(page: Page, filename: string): Promise<string | null> {
  return page.evaluate((targetFilename) => {
    const normalized = targetFilename.trim().toLowerCase().replace(/\.pdf$/i, '');

    for (const button of document.querySelectorAll('[id^="PV_ATTACH_WRK_SCM_DOWNLOAD$"]')) {
      const row = button.closest('tr');
      const rowText = (row?.textContent ?? '').trim().toLowerCase();
      if (rowText.includes(normalized)) {
        return (button as HTMLElement).id;
      }
    }

    return null;
  }, filename);
}

async function refreshViewredirectUrl(
  page: Page,
  filename: string,
  previousUrl: string,
): Promise<string | null> {
  await closeCaleprocureAttachmentModal(page);

  const buttonId = await findAttachmentButtonId(page, filename);
  if (!buttonId) {
    return null;
  }

  await page.evaluate((id) => {
    document.getElementById(id)?.click();
  }, buttonId);

  try {
    await page.waitForFunction(
      (args) => {
        const link = document.querySelector(
          'a[data-if-label="attachmentLink"]',
        ) as HTMLAnchorElement | null;
        const href = link?.href ?? '';
        return /viewredirect/i.test(href) && /\.pdf/i.test(href) && href !== args.previousUrl;
      },
      { previousUrl },
      { timeout: CALEPROCURE_ATTACHMENT_WAIT_MS },
    );
  } catch {
    return null;
  }

  return page.locator('a[data-if-label="attachmentLink"]').getAttribute('href');
}

async function downloadPdfFromUrl(
  context: BrowserContext,
  sourceUrl: string,
): Promise<DownloadDocumentResult> {
  const maxBytes = getMaxDownloadBytes();

  try {
    const response = await context.request.get(sourceUrl, {
      timeout: CALEPROCURE_DOWNLOAD_TIMEOUT_MS,
    });

    if (!response.ok()) {
      return failure(`HTTP ${response.status()} ${response.statusText()}`.trim());
    }

    const contentType = response.headers()['content-type'] ?? '';
    const buffer = Buffer.from(await response.body());
    const validationError = validateDownloadedPdf(buffer, contentType, maxBytes);

    if (validationError) {
      return failure(validationError);
    }

    return {
      ok: true,
      buffer,
      contentType: 'application/pdf',
      sizeBytes: buffer.length,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure(`download failed: ${message}`);
  }
}

export async function downloadCaleprocureDocumentsForBid(
  context: BrowserContext,
  eventPageUrl: string,
  documents: CaleprocureDownloadRequest[],
): Promise<Map<string, DownloadDocumentResult>> {
  const results = new Map<string, DownloadDocumentResult>();
  const page = await context.newPage();

  try {
    const openError = await openCaleprocurePackage(page, eventPageUrl);
    if (openError) {
      console.log(`${LOG_PREFIX} Bid package open failed (${eventPageUrl}): ${openError}`);
      for (const document of documents) {
        results.set(document.documentId, failure(openError));
      }
      return results;
    }

    console.log(
      `${LOG_PREFIX} Opened CaleProcure package for ${documents.length} download(s) at ${eventPageUrl}`,
    );

    const seenFilenames = new Set<string>();
    let previousUrl = '';

    for (const document of documents) {
      const filenameKey = normalizeFilename(document.name);
      if (seenFilenames.has(filenameKey)) {
        results.set(
          document.documentId,
          failure(`duplicate attachment filename in batch: ${document.name}`),
        );
        continue;
      }

      let download = await downloadPdfFromUrl(context, document.sourceUrl);

      if (!download.ok) {
        const freshUrl = await refreshViewredirectUrl(page, document.name, previousUrl);
        if (!freshUrl) {
          results.set(
            document.documentId,
            failure(
              `failed to refresh download URL for "${document.name}" (${download.error})`,
            ),
          );
          continue;
        }

        previousUrl = freshUrl;
        download = await downloadPdfFromUrl(context, freshUrl);
      }

      if (download.ok) {
        seenFilenames.add(filenameKey);
        console.log(
          `${LOG_PREFIX} Downloaded "${document.name}" (${download.sizeBytes} bytes)`,
        );
      } else {
        console.log(
          `${LOG_PREFIX} Download failed for "${document.name}": ${download.error}`,
        );
      }

      results.set(document.documentId, download);
    }
  } finally {
    await page.close();
  }

  return results;
}

export const CALEPROCURE_PLAYWRIGHT_USER_AGENT = USER_AGENT;
