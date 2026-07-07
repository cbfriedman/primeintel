import { parse } from 'node-html-parser';
import { chromium, type Browser, type BrowserContext } from 'playwright';

import { withRetry } from '@/lib/retry';
import type {
  BidDocumentType,
  ExtractDocumentsResult,
  NormalizedBidDocument,
  SavedBidRef,
} from './types';
import {
  classifyDocumentSourceUrl,
  isSessionBoundDocumentUrl,
  logSessionBoundDocumentUrl,
  sanitizeErrorMessage,
} from './document-source-url';

const LOG_PREFIX = '[caltrans-documents]';
const FETCH_TIMEOUT_MS = 15000;
const PLAYWRIGHT_TIMEOUT_MS = 30000;
const CALEPROCURE_PLAYWRIGHT_TIMEOUT_MS = 60000;
const CALEPROCURE_HYDRATION_TIMEOUT_MS = 45000;
const CALEPROCURE_PACKAGE_TIMEOUT_MS = 30000;
const CALEPROCURE_BETWEEN_BIDS_DELAY_MS = 2000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FETCH_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const EMBEDDED_DOCUMENT_URL_PATTERNS = [
  /https?:\/\/[^\s"'<>\\]+?\.pdf(?:\?[^\s"'<>\\]*)?/gi,
  /https?:\/\/fiscal\.cdn\.prismic\.io\/fiscal\/[^\s"'<>\\]+\.pdf/gi,
  /https?:\/\/[^\s"'<>\\]*sys_attachment\.do[^\s"'<>\\]*/gi,
];

type PlaywrightFallbackReason = 'fetch_failed' | 'no_documents_and_js_shell' | 'caleprocure_event_page';

function normalizeText(raw: string | null | undefined): string {
  if (raw == null) return '';
  return raw.trim().replace(/\s+/g, ' ');
}

function resolveDocumentUrl(href: string, baseUrl: string): string {
  if (!href || href.startsWith('javascript:') || href.startsWith('#') || href.startsWith('mailto:')) {
    return '';
  }

  try {
    const resolved = new URL(href, baseUrl).href;
    if (!resolved.startsWith('http://') && !resolved.startsWith('https://')) {
      return '';
    }
    return resolved;
  } catch {
    return '';
  }
}

function isInvalidDocumentUrl(sourceUrl: string): boolean {
  return sourceUrl.endsWith('#') || sourceUrl.endsWith('/#');
}

function isLikelyDocumentUrl(url: string): boolean {
  if (/\/api\//i.test(url) || /access_token=/i.test(url)) {
    return false;
  }

  if (/csm_login|\/login|signin|register/i.test(url)) {
    return false;
  }

  if (/viewredirect\/.*\.pdf/i.test(url)) return true;
  if (/\.pdf(\?|#|$)/i.test(url)) return true;
  if (/\.docx?(\?|#|$)/i.test(url)) return true;
  if (/\.xlsx?(\?|#|$)/i.test(url)) return true;
  if (/sys_attachment\.do/i.test(url)) return true;

  return false;
}

function isCaleprocureEventUrl(pageUrl: string): boolean {
  return /caleprocure\.ca\.gov\/event\//i.test(pageUrl);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function documentNameFromUrl(sourceUrl: string): string {
  try {
    const pathname = new URL(sourceUrl).pathname;
    const segment = pathname.split('/').pop() ?? 'Document';
    return decodeURIComponent(segment.replace(/\+/g, ' '));
  } catch {
    return 'Document';
  }
}

function documentDisplayName(text: string, sourceUrl: string): string {
  const normalized = normalizeText(text);
  if (
    normalized.length > 2 &&
    !/^(here|download|click|link|pdf|attachment|file)$/i.test(normalized)
  ) {
    return normalized;
  }

  return documentNameFromUrl(sourceUrl);
}

function classifyDocType(name: string, url: string): BidDocumentType {
  const combined = `${name} ${url}`.toLowerCase();

  if (/addendum|amendment|bulletin|addenda/.test(combined)) {
    return 'addendum';
  }

  if (/plan|drawing|blueprint|sheet/.test(combined)) {
    return 'plans';
  }

  if (/spec|specification|bid\s*book|proposal|ifb|rfp|contract\s*document|solicitation/.test(combined)) {
    return 'spec';
  }

  return 'other';
}

function extractFileSize(text: string): string | null {
  const match = text.match(/\(?\s*([\d.]+\s*(?:KB|MB|GB|bytes?))\s*\)?/i);
  return match ? normalizeText(match[1]) : null;
}

function isDocumentLink(href: string, text: string): boolean {
  if (!href || href.startsWith('mailto:') || href.startsWith('javascript:') || href.startsWith('#')) {
    return false;
  }

  const combined = `${href} ${text}`.toLowerCase();

  if (/csm_login|\/login|signin|register/i.test(href)) {
    return false;
  }

  if (/\.pdf(\?|#|$)/i.test(href)) return true;
  if (/\.docx?(\?|#|$)/i.test(href)) return true;
  if (/\.xlsx?(\?|#|$)/i.test(href)) return true;
  if (/sys_attachment|attachment\.do|\/download|\/document|\/file\//i.test(href)) {
    return true;
  }

  return /spec|plan|addendum|bid\s*book|proposal|drawing|amendment|attach/.test(
    combined,
  );
}

function mergeDocuments(...groups: NormalizedBidDocument[][]): NormalizedBidDocument[] {
  const merged: NormalizedBidDocument[] = [];
  const seenUrls = new Set<string>();

  for (const group of groups) {
    for (const document of group) {
      if (seenUrls.has(document.sourceUrl)) continue;
      seenUrls.add(document.sourceUrl);
      merged.push(document);
    }
  }

  return merged;
}

function buildDocumentsFromUrls(
  urls: string[],
  bidId: string,
  pageUrl: string,
): NormalizedBidDocument[] {
  const documents: NormalizedBidDocument[] = [];
  const seenUrls = new Set<string>();

  for (const rawUrl of urls) {
    const sourceUrl = rawUrl.startsWith('http')
      ? rawUrl
      : resolveDocumentUrl(rawUrl, pageUrl);

    if (!sourceUrl || !isLikelyDocumentUrl(sourceUrl)) continue;
    if (isInvalidDocumentUrl(sourceUrl) || seenUrls.has(sourceUrl)) continue;

    seenUrls.add(sourceUrl);

    const name = documentDisplayName('', sourceUrl);

    documents.push({
      bidId,
      name,
      sourceUrl,
      sourceUrlKind: classifyDocumentSourceUrl(sourceUrl),
      docType: classifyDocType(name, sourceUrl),
      fileSize: null,
    });
  }

  return documents;
}

function extractEmbeddedDocumentUrls(
  html: string,
  bidId: string,
  pageUrl: string,
): NormalizedBidDocument[] {
  const urls: string[] = [];

  for (const pattern of EMBEDDED_DOCUMENT_URL_PATTERNS) {
    const matches = html.match(pattern) ?? [];
    urls.push(...matches.map((url) => url.replace(/\\u002F/g, '/').replace(/\\\//g, '/')));
  }

  return buildDocumentsFromUrls(urls, bidId, pageUrl);
}

function buildDocumentsFromLinks(
  links: Array<{ href: string; text: string; rowText: string; dataHref?: string }>,
  bidId: string,
  pageUrl: string,
): NormalizedBidDocument[] {
  const documents: NormalizedBidDocument[] = [];
  const seenUrls = new Set<string>();

  for (const link of links) {
    const text = normalizeText(link.text);
    const rowText = normalizeText(link.rowText);
    const candidateHrefs = [link.href, link.dataHref ?? ''].filter(Boolean);

    for (const href of candidateHrefs) {
      if (!isDocumentLink(href, `${text} ${rowText}`) && !isLikelyDocumentUrl(href)) {
        continue;
      }

      const sourceUrl = href.startsWith('http')
        ? href
        : resolveDocumentUrl(href, pageUrl);

      if (!sourceUrl || seenUrls.has(sourceUrl)) continue;
      if (isInvalidDocumentUrl(sourceUrl)) continue;

      seenUrls.add(sourceUrl);

      const name = documentDisplayName(text, sourceUrl);

      documents.push({
        bidId,
        name,
        sourceUrl,
        sourceUrlKind: classifyDocumentSourceUrl(sourceUrl),
        docType: classifyDocType(`${name} ${rowText}`, sourceUrl),
        fileSize: extractFileSize(rowText) ?? extractFileSize(text),
      });
    }
  }

  return documents;
}

function parseDocumentsFromHtml(
  html: string,
  pageUrl: string,
  bidId: string,
): NormalizedBidDocument[] {
  const root = parse(html);

  const links = root.querySelectorAll('a').map((anchor) => ({
    href: anchor.getAttribute('href') ?? '',
    text: anchor.text,
    rowText: anchor.parentNode?.text ?? anchor.text,
    dataHref:
      anchor.getAttribute('data-href') ??
      anchor.getAttribute('data-url') ??
      anchor.getAttribute('data-file') ??
      undefined,
  }));

  return mergeDocuments(
    buildDocumentsFromLinks(links, bidId, pageUrl),
    extractEmbeddedDocumentUrls(html, bidId, pageUrl),
  );
}

function htmlLooksLikeJsShell(html: string): boolean {
  const root = parse(html);
  const anchorCount = root.querySelectorAll('a').length;
  const bodyText = normalizeText(root.querySelector('body')?.text ?? '');

  return anchorCount <= 2 && bodyText.length < 200;
}

function detectAuthWall(
  pageUrl: string,
  html: string,
  finalUrl?: string,
  httpStatus?: number,
): string | null {
  if (httpStatus === 401 || httpStatus === 403) {
    return `HTTP ${httpStatus} forbidden/blocked`;
  }

  const urlCombined = `${pageUrl} ${finalUrl ?? ''}`.toLowerCase();
  const htmlLower = html.toLowerCase();

  if (/captcha|recaptcha|hcaptcha/.test(htmlLower)) {
    return 'captcha wall detected';
  }

  if (/403 forbidden|access denied|permission denied/.test(htmlLower)) {
    return 'forbidden/access denied detected';
  }

  if (/csm_login|\/login\b|\/signin\b|\/auth\b/.test(urlCombined)) {
    return 'login/auth wall detected (URL)';
  }

  if (
    finalUrl &&
    /login|signin|auth/i.test(finalUrl) &&
    !/login|signin|auth/i.test(pageUrl)
  ) {
    return 'redirected to login page';
  }

  const root = parse(html);
  const title = normalizeText(root.querySelector('title')?.text ?? '').toLowerCase();
  const heading = normalizeText(
    root.querySelector('h1')?.text ?? root.querySelector('h2')?.text ?? '',
  ).toLowerCase();

  if (/403|forbidden/.test(title) || /403|forbidden/.test(heading)) {
    return 'forbidden/access denied detected (page title)';
  }

  if (
    /^(log\s*in|sign\s*in)$/.test(title) ||
    /^(log\s*in|sign\s*in)$/.test(heading) ||
    /login required|authentication required/.test(`${title} ${heading}`)
  ) {
    return 'login/auth wall detected (page heading)';
  }

  return null;
}

function getPlaywrightFallbackReason(
  fetchHtml: string | null,
  documents: NormalizedBidDocument[],
  pageUrl: string,
): PlaywrightFallbackReason | null {
  if (!fetchHtml) {
    return 'fetch_failed';
  }

  if (documents.length > 0) {
    return null;
  }

  if (/caleprocure\.ca\.gov\/event\//i.test(pageUrl)) {
    return 'caleprocure_event_page';
  }

  if (htmlLooksLikeJsShell(fetchHtml)) {
    return 'no_documents_and_js_shell';
  }

  return null;
}

function formatFallbackReason(reason: PlaywrightFallbackReason): string {
  switch (reason) {
    case 'fetch_failed':
      return 'HTTP fetch failed';
    case 'caleprocure_event_page':
      return 'CaleProcure event page requires JS rendering (fetch returned no document links)';
    case 'no_documents_and_js_shell':
      return 'fetch returned no document links and the page looks like a JS shell';
  }
}

function filterSiteWideNoiseDocuments(
  documents: NormalizedBidDocument[],
): NormalizedBidDocument[] {
  return documents.filter((doc) => {
    const combined = `${doc.name} ${doc.sourceUrl}`.toLowerCase();
    return !/diversity.*data.*procedures|site_maintenance/.test(combined);
  });
}

async function getHtmlViaFetch(pageUrl: string): Promise<string | null> {
  try {
    const response = await fetch(pageUrl, {
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.log(
        `${LOG_PREFIX} Fetch failed for ${pageUrl} (HTTP ${response.status}).`,
      );
      return null;
    }

    return await response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`${LOG_PREFIX} Fetch failed for ${pageUrl} (${message}).`);
    return null;
  }
}

function extractPdfUrlsFromText(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s"'<>\\]+?\.pdf(?:\?[^\s"'<>\\]*)?/gi) ?? [];
  return matches.filter((url) => isLikelyDocumentUrl(url));
}

function attachNetworkDocumentCollector(page: import('playwright').Page): string[] {
  const networkDocUrls: string[] = [];

  page.on('response', async (response) => {
    const url = response.url();

    if (isLikelyDocumentUrl(url)) {
      networkDocUrls.push(url);
      return;
    }

    try {
      const contentType = response.headers()['content-type'] ?? '';
      if (
        !contentType.includes('json') &&
        !contentType.includes('html') &&
        !contentType.includes('text') &&
        !contentType.includes('javascript')
      ) {
        return;
      }

      const body = await response.text();
      networkDocUrls.push(...extractPdfUrlsFromText(body));
    } catch {
      // Ignore unreadable network responses.
    }
  });

  return networkDocUrls;
}

type CaleprocureHydrationState = {
  hydrated: boolean;
  eventName: string;
  viewPackageEnabled: boolean;
};

async function waitForCaleprocureEventHydration(
  page: import('playwright').Page,
): Promise<CaleprocureHydrationState> {
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
  } catch {
    // Continue if InFlight event hydration is slow or blocked.
  }

  return page.evaluate(() => {
    const eventName =
      document.querySelector('[data-if-label="eventName"]')?.textContent?.trim() ?? '';
    const viewPackageButton = document.querySelector(
      'button[data-if-label="viewPackage"]',
    ) as HTMLButtonElement | null;

    return {
      hydrated: eventName.length > 0,
      eventName,
      viewPackageEnabled: viewPackageButton != null && !viewPackageButton.disabled,
    };
  });
}

async function closeCaleprocureAttachmentModal(
  page: import('playwright').Page,
): Promise<void> {
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

async function extractCaleprocurePackageDocuments(
  page: import('playwright').Page,
  bidId: string,
): Promise<NormalizedBidDocument[]> {
  const viewPackageButton = page.locator('button[data-if-label="viewPackage"]');

  if ((await viewPackageButton.count()) === 0) {
    console.log(`${LOG_PREFIX} Bid ${bidId}: viewPackage button not found`);
    return [];
  }

  if (!(await viewPackageButton.isEnabled())) {
    console.log(`${LOG_PREFIX} Bid ${bidId}: viewPackage button disabled (no package available)`);
    return [];
  }

  await viewPackageButton.click({ timeout: 10000 });

  try {
    await page.waitForSelector('[id^="PV_ATTACH_WRK_SCM_DOWNLOAD$"]', {
      timeout: CALEPROCURE_PACKAGE_TIMEOUT_MS,
    });
  } catch {
    console.log(
      `${LOG_PREFIX} Bid ${bidId}: viewPackage opened but no attachment download buttons appeared`,
    );
    return [];
  }

  const buttonIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[id^="PV_ATTACH_WRK_SCM_DOWNLOAD$"]')).map(
      (element) => (element as HTMLElement).id,
    ),
  );

  console.log(
    `${LOG_PREFIX} Bid ${bidId}: ${buttonIds.length} CaleProcure package attachment(s) in table`,
  );

  const documents: NormalizedBidDocument[] = [];
  const seenUrls = new Set<string>();
  let previousUrl = '';

  for (const buttonId of buttonIds) {
    await closeCaleprocureAttachmentModal(page);

    await page.evaluate((id) => {
      document.getElementById(id)?.click();
    }, buttonId);

    try {
      await page.waitForFunction(
        (prev) => {
          const link = document.querySelector(
            'a[data-if-label="attachmentLink"]',
          ) as HTMLAnchorElement | null;
          const href = link?.href ?? '';
          return /viewredirect/i.test(href) && /\.pdf/i.test(href) && href !== prev;
        },
        previousUrl,
        { timeout: 15000 },
      );
    } catch {
      console.log(
        `${LOG_PREFIX} Bid ${bidId}: timed out waiting for download URL after ${buttonId}`,
      );
      continue;
    }

    const sourceUrl =
      (await page.locator('a[data-if-label="attachmentLink"]').getAttribute('href')) ?? '';

    if (!sourceUrl || !isLikelyDocumentUrl(sourceUrl) || seenUrls.has(sourceUrl)) {
      continue;
    }

    previousUrl = sourceUrl;
    seenUrls.add(sourceUrl);

    const name = documentNameFromUrl(sourceUrl);

    documents.push({
      bidId,
      name,
      sourceUrl,
      sourceUrlKind: classifyDocumentSourceUrl(sourceUrl),
      docType: classifyDocType(name, sourceUrl),
      fileSize: null,
    });

    if (isSessionBoundDocumentUrl(sourceUrl)) {
      logSessionBoundDocumentUrl(LOG_PREFIX, bidId, name);
    }

    console.log(`${LOG_PREFIX} Bid ${bidId}: resolved package PDF "${name}"`);
  }

  return documents;
}

async function collectPlaywrightDocuments(
  page: import('playwright').Page,
  bidId: string,
  pageUrl: string,
  networkDocUrls: string[],
): Promise<NormalizedBidDocument[]> {
  const finalUrl = page.url();
  const html = await page.content();

  const links = await page.evaluate(() =>
    Array.from(document.querySelectorAll('a')).map((anchor) => ({
      href: anchor.href,
      text: (anchor.textContent || '').trim(),
      rowText: (
        anchor.closest('tr')?.textContent ||
        anchor.closest('li')?.textContent ||
        anchor.parentElement?.textContent ||
        ''
      ).trim(),
      dataHref:
        anchor.getAttribute('data-href') ||
        anchor.getAttribute('data-url') ||
        anchor.getAttribute('data-file') ||
        undefined,
    })),
  );

  return mergeDocuments(
    buildDocumentsFromLinks(links, bidId, finalUrl || pageUrl),
    extractEmbeddedDocumentUrls(html, bidId, finalUrl || pageUrl),
    buildDocumentsFromUrls(networkDocUrls, bidId, finalUrl || pageUrl),
  );
}

async function getDocumentsViaPlaywright(
  context: BrowserContext,
  pageUrl: string,
  bidId: string,
): Promise<{
  documents: NormalizedBidDocument[];
  authWall: string | null;
}> {
  const page = await context.newPage();
  const networkDocUrls = attachNetworkDocumentCollector(page);

  try {
    const response = await page.goto(pageUrl, {
      timeout: isCaleprocureEventUrl(pageUrl)
        ? CALEPROCURE_PLAYWRIGHT_TIMEOUT_MS
        : PLAYWRIGHT_TIMEOUT_MS,
      waitUntil: 'load',
    });

    const httpStatus = response?.status() ?? 0;

    if (isCaleprocureEventUrl(pageUrl)) {
      await page
        .waitForLoadState('networkidle', { timeout: CALEPROCURE_PLAYWRIGHT_TIMEOUT_MS })
        .catch(() => undefined);

      const hydration = await waitForCaleprocureEventHydration(page);

      if (!hydration.hydrated) {
        console.log(
          `${LOG_PREFIX} ALERT: Bid ${bidId} (${pageUrl}): CaleProcure event page did not hydrate — eventName empty after ${CALEPROCURE_HYDRATION_TIMEOUT_MS}ms`,
        );
      }

      const finalUrl = page.url();
      const html = await page.content();
      const authWall = detectAuthWall(pageUrl, html, finalUrl, httpStatus);

      if (authWall) {
        return { documents: [], authWall };
      }

      const packageDocuments = filterSiteWideNoiseDocuments(
        await extractCaleprocurePackageDocuments(page, bidId),
      );

      if (packageDocuments.length === 0) {
        console.log(
          `${LOG_PREFIX} Bid ${bidId} (${pageUrl}): no CaleProcure package PDFs resolved — hydrated=${hydration.hydrated}, eventName="${hydration.eventName}", viewPackageEnabled=${hydration.viewPackageEnabled}`,
        );
      }

      return {
        documents: packageDocuments,
        authWall: null,
      };
    }

    try {
      await page.waitForSelector(
        'a[href*=".pdf"], a[href*="attachment"], a[href*="download"], [class*="attach"], [class*="document"]',
        { timeout: 15000 },
      );
    } catch {
      // Continue if attachment UI does not appear within the wait window.
    }

    const finalUrl = page.url();
    const html = await page.content();
    const authWall = detectAuthWall(pageUrl, html, finalUrl, httpStatus);

    if (authWall) {
      return { documents: [], authWall };
    }

    const documents = await collectPlaywrightDocuments(
      page,
      bidId,
      pageUrl,
      networkDocUrls,
    );

    return {
      documents,
      authWall: null,
    };
  } finally {
    await page.close();
  }
}

export async function extractCaltransDocuments(
  savedBids: SavedBidRef[],
): Promise<ExtractDocumentsResult> {
  const errors: string[] = [];
  const allDocuments: NormalizedBidDocument[] = [];
  let bids_with_no_documents = 0;
  let auth_blocked_bids = 0;

  console.log(`${LOG_PREFIX} Checking ${savedBids.length} bids for documents...`);

  const playwrightResources: {
    browser: Browser | null;
    context: BrowserContext | null;
  } = { browser: null, context: null };

  const ensureContext = async (): Promise<BrowserContext> => {
    if (!playwrightResources.context) {
      console.log(`${LOG_PREFIX} Launching Playwright for document fallback...`);
      playwrightResources.browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-blink-features=AutomationControlled',
        ],
      });
      playwrightResources.context = await playwrightResources.browser.newContext({
        userAgent: USER_AGENT,
        locale: 'en-US',
        viewport: { width: 1280, height: 720 },
        extraHTTPHeaders: {
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });
    }
    return playwrightResources.context;
  };

  try {
    for (const savedBid of savedBids) {
      try {
        let documents: NormalizedBidDocument[] = [];
        const bidErrors: string[] = [];
        let bidAuthBlocked = false;

        const fetchHtml = await getHtmlViaFetch(savedBid.sourceUrl);

        if (fetchHtml) {
          documents = parseDocumentsFromHtml(
            fetchHtml,
            savedBid.sourceUrl,
            savedBid.bidId,
          );

          const fetchAuthWall = detectAuthWall(savedBid.sourceUrl, fetchHtml);
          if (fetchAuthWall) {
            console.log(
              `${LOG_PREFIX} Bid ${savedBid.bidId} (${savedBid.sourceUrl}): possible ${fetchAuthWall} on fetch HTML — continuing extraction`,
            );
          }
        }

        const fallbackReason = getPlaywrightFallbackReason(
          fetchHtml,
          documents,
          savedBid.sourceUrl,
        );

        if (fallbackReason) {
          console.log(
            `${LOG_PREFIX} Bid ${savedBid.bidId} (${savedBid.sourceUrl}): Playwright fallback triggered — ${formatFallbackReason(fallbackReason)}`,
          );

          const playwrightContext = await ensureContext();
          try {
            const playwrightResult = await withRetry(
              () =>
                getDocumentsViaPlaywright(
                  playwrightContext,
                  savedBid.sourceUrl,
                  savedBid.bidId,
                ),
              {
                maxAttempts: 2,
                label: `Playwright document discovery (bid ${savedBid.bidId})`,
              },
            );

            if (playwrightResult.authWall) {
              bidAuthBlocked = true;
              auth_blocked_bids += 1;
              console.log(
                `${LOG_PREFIX} Bid ${savedBid.bidId} (${savedBid.sourceUrl}): ${playwrightResult.authWall} — no public documents extracted`,
              );
              documents = [];
            } else {
              documents = playwrightResult.documents;
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            bidErrors.push(
              `Playwright failed for bid ${savedBid.bidId} (${savedBid.sourceUrl}): ${message}`,
            );
          }
        }

        errors.push(...bidErrors);
        allDocuments.push(...documents);

        if (documents.length === 0) {
          bids_with_no_documents += 1;
        }

        console.log(
          `${LOG_PREFIX} Bid ${savedBid.bidId} (${savedBid.sourceUrl}): ${documents.length} document(s) found${bidAuthBlocked ? ' (auth blocked)' : ''}`,
        );

        if (isCaleprocureEventUrl(savedBid.sourceUrl) && playwrightResources.context) {
          await sleep(CALEPROCURE_BETWEEN_BIDS_DELAY_MS);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Bid ${savedBid.bidId} (${savedBid.sourceUrl}): ${message}`);
        console.log(
          `${LOG_PREFIX} Bid ${savedBid.bidId} (${savedBid.sourceUrl}): error — ${message}`,
        );
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
    `${LOG_PREFIX} Extraction complete. Bids checked: ${savedBids.length}, Documents found: ${allDocuments.length}, Errors: ${errors.length}`,
  );

  return {
    bids_checked: savedBids.length,
    documents_found: allDocuments.length,
    documents: allDocuments,
    bids_with_no_documents,
    auth_blocked_bids,
    errors: errors.map(sanitizeErrorMessage),
  };
}
