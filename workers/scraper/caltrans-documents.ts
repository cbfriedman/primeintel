import { parse } from 'node-html-parser';
import { chromium, type Browser, type BrowserContext } from 'playwright';

import type {
  BidDocumentType,
  ExtractDocumentsResult,
  NormalizedBidDocument,
  SavedBidRef,
} from './types';

const LOG_PREFIX = '[caltrans-documents]';
const FETCH_TIMEOUT_MS = 15000;
const PLAYWRIGHT_TIMEOUT_MS = 30000;

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

  if (/\.pdf(\?|#|$)/i.test(url)) return true;
  if (/\.docx?(\?|#|$)/i.test(url)) return true;
  if (/\.xlsx?(\?|#|$)/i.test(url)) return true;
  if (/sys_attachment\.do/i.test(url)) return true;

  return false;
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

  if (/spec|specification|bid\s*book|proposal|ifb|rfp|contract\s*document/.test(combined)) {
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

function pageLikelyNeedsPlaywright(fetchHtml: string, pageUrl: string): boolean {
  if (/caleprocure\.ca\.gov\/event\//i.test(pageUrl)) {
    return true;
  }

  return htmlLooksLikeJsShell(fetchHtml);
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

async function waitForCaleprocureEventContent(page: import('playwright').Page): Promise<void> {
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
      { timeout: 30000 },
    );
  } catch {
    // Continue if InFlight event hydration is slow or blocked.
  }
}

async function tryOpenCaleprocureEventPackage(
  page: import('playwright').Page,
): Promise<void> {
  const viewPackageButton = page.locator('button[data-if-label="viewPackage"]');

  if ((await viewPackageButton.count()) === 0) {
    return;
  }

  if (!(await viewPackageButton.isEnabled())) {
    return;
  }

  try {
    await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      page.waitForEvent('popup', { timeout: 15000 }).catch(() => null),
      viewPackageButton.click({ timeout: 5000 }),
    ]);
    await page.waitForLoadState('networkidle', { timeout: 30000 });
  } catch {
    // Package modal/download links may not appear for every event.
  }
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
      timeout: PLAYWRIGHT_TIMEOUT_MS,
      waitUntil: 'load',
    });

    const httpStatus = response?.status() ?? 0;

    if (/caleprocure\.ca\.gov\/event\//i.test(pageUrl)) {
      await page.waitForLoadState('networkidle', { timeout: PLAYWRIGHT_TIMEOUT_MS }).catch(
        () => undefined,
      );
      await waitForCaleprocureEventContent(page);

      const documentsBeforePackage = await collectPlaywrightDocuments(
        page,
        bidId,
        pageUrl,
        [...networkDocUrls],
      );

      await tryOpenCaleprocureEventPackage(page);

      const finalUrl = page.url();
      const html = await page.content();
      const authWall = detectAuthWall(pageUrl, html, finalUrl, httpStatus);

      if (authWall) {
        return { documents: [], authWall };
      }

      const documentsAfterPackage = await collectPlaywrightDocuments(
        page,
        bidId,
        pageUrl,
        networkDocUrls,
      );

      const beforeUrls = new Set(documentsBeforePackage.map((doc) => doc.sourceUrl));
      const packageDocuments = documentsAfterPackage.filter(
        (doc) => !beforeUrls.has(doc.sourceUrl),
      );

      const candidateDocuments =
        packageDocuments.length > 0 ? packageDocuments : documentsAfterPackage;

      const documents = filterSiteWideNoiseDocuments(candidateDocuments);

      if (documents.length === 0) {
        const diagnostics = await page.evaluate(() => {
          const main = document.querySelector('#main');
          return {
            mainVisible: main != null && !main.classList.contains('hidden'),
            eventName:
              document.querySelector('[data-if-label="eventName"]')?.textContent?.trim() ??
              '',
            pdfLinkCount: document.querySelectorAll('a[href*=".pdf"]').length,
            viewPackageEnabled: (() => {
              const button = document.querySelector(
                'button[data-if-label="viewPackage"]',
              ) as HTMLButtonElement | null;
              return button != null && !button.disabled;
            })(),
          };
        });

        console.log(
          `${LOG_PREFIX} Bid ${bidId} (${pageUrl}): no public PDF links found after Playwright — mainVisible=${diagnostics.mainVisible}, eventName="${diagnostics.eventName}", pdfLinks=${diagnostics.pdfLinkCount}, viewPackageEnabled=${diagnostics.viewPackageEnabled}`,
        );
      }

      return {
        documents,
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
        args: ['--disable-blink-features=AutomationControlled'],
      });
      playwrightResources.context = await playwrightResources.browser.newContext({
        userAgent: USER_AGENT,
        locale: 'en-US',
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
            const playwrightResult = await getDocumentsViaPlaywright(
              playwrightContext,
              savedBid.sourceUrl,
              savedBid.bidId,
            );

            if (playwrightResult.authWall) {
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

        console.log(
          `${LOG_PREFIX} Bid ${savedBid.bidId} (${savedBid.sourceUrl}): ${documents.length} document(s) found`,
        );
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
    errors,
  };
}
