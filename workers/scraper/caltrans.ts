import { parse } from 'node-html-parser';
import { chromium } from 'playwright';

import { withRetry } from '@/lib/retry';
import type { CaltransScraperResult, NormalizedBidListing } from './types';

const SOURCE = 'caltrans' as const;
const AGENCY = 'Caltrans' as const;
const LISTING_URL = 'https://ccop.dot.ca.gov/allProjects';
const BASE_URL = 'https://ccop.dot.ca.gov';
const LOG_PREFIX = '[caltrans-scraper]';
const FETCH_TIMEOUT_MS = 15000;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const FETCH_HEADERS = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const UNPARSEABLE_DATE_VALUES = new Set(['tbd', 'n/a', '-', '—', 'pending', '']);

type ColumnMap = {
  projectId: number;
  title: number;
  county: number;
  license: number;
  advertiseDate: number;
  bidDate: number;
  status: number;
};

type TableRows = ReturnType<ReturnType<typeof parse>['querySelectorAll']>;

function normalizeText(raw: string | null | undefined): string {
  if (raw == null) return '';
  return raw.trim().replace(/\s+/g, ' ');
}

function parseDate(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  const trimmed = raw.trim();
  if (UNPARSEABLE_DATE_VALUES.has(trimmed.toLowerCase())) return null;

  const mdyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdyMatch) {
    const [, m, d, y] = mdyMatch;
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    const date = new Date(`${iso}T00:00:00`);
    if (!isNaN(date.getTime())) return iso;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return trimmed;

  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }

  return null;
}

function resolveUrl(href: string): string {
  if (!href) return '';
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  return href.startsWith('/') ? `${BASE_URL}${href}` : `${BASE_URL}/${href}`;
}

function findColumnIndex(headers: string[], ...terms: string[]): number {
  const normalized = headers.map((h) => normalizeText(h).toLowerCase());
  for (const term of terms) {
    const i = normalized.findIndex((h) => h.includes(term));
    if (i !== -1) return i;
  }
  return -1;
}

function buildColumnMap(headers: string[]): ColumnMap | null {
  const map: ColumnMap = {
    projectId: findColumnIndex(headers, 'project id', 'project number'),
    title: findColumnIndex(headers, 'project title', 'title', 'description'),
    county: findColumnIndex(headers, 'county'),
    license: findColumnIndex(headers, 'license'),
    advertiseDate: findColumnIndex(headers, 'advertise date', 'advertised date', 'posted'),
    bidDate: findColumnIndex(headers, 'bid date', 'bid opening', 'opening date'),
    status: findColumnIndex(headers, 'status'),
  };

  if (map.projectId === -1 || map.title === -1) return null;

  return map;
}

function findTableAndRows(html: string): {
  colMap: ColumnMap;
  rows: TableRows;
} | null {
  const root = parse(html);
  const tables = root.querySelectorAll('table');

  if (tables.length === 0) return null;

  for (const table of tables) {
    let headerCells = table.querySelectorAll('thead th, thead td');
    if (headerCells.length === 0) {
      headerCells = table.querySelectorAll('tr:first-child th, tr:first-child td');
    }

    const headers = headerCells.map((cell) => cell.text);
    const colMap = buildColumnMap(headers);
    if (!colMap) continue;

    const tbody = table.querySelector('tbody');
    const rows = tbody
      ? tbody.querySelectorAll('tr')
      : table.querySelectorAll('tr').slice(1);

    return { colMap, rows };
  }

  return null;
}

function parseRows(
  colMap: ColumnMap,
  rows: TableRows,
): { listings: NormalizedBidListing[]; errors: string[] } {
  const listings: NormalizedBidListing[] = [];
  const errors: string[] = [];
  const seenKeys = new Set<string>();

  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue;

    try {
      const idCell = cells[colMap.projectId];
      const link = idCell?.querySelector('a');

      const sourceId = normalizeText(link?.text ?? idCell?.text) || null;
      const rawHref = link?.getAttribute('href') ?? '';
      const sourceUrl = resolveUrl(rawHref);

      if (!sourceUrl) {
        const reason = `no URL found (sourceId: ${sourceId ?? 'unknown'})`;
        console.log(`${LOG_PREFIX} Row skipped — ${reason}`);
        errors.push(`Row skipped — ${reason}`);
        continue;
      }

      const title = normalizeText(cells[colMap.title]?.text);
      if (!title) {
        const reason = `missing title (sourceId: ${sourceId ?? 'unknown'})`;
        console.log(`${LOG_PREFIX} Row skipped — ${reason}`);
        errors.push(`Row skipped — ${reason}`);
        continue;
      }

      const dedupKey = sourceId ?? sourceUrl;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      listings.push({
        source: SOURCE,
        sourceId,
        sourceUrl,
        agency: AGENCY,
        county:
          colMap.county !== -1
            ? normalizeText(cells[colMap.county]?.text) || null
            : null,
        title,
        bidDate:
          colMap.bidDate !== -1
            ? parseDate(cells[colMap.bidDate]?.text)
            : null,
        postedAt:
          colMap.advertiseDate !== -1
            ? parseDate(cells[colMap.advertiseDate]?.text)
            : null,
        rawPdfUrl: null,
        license:
          colMap.license !== -1
            ? normalizeText(cells[colMap.license]?.text) || null
            : null,
        status:
          colMap.status !== -1
            ? normalizeText(cells[colMap.status]?.text) || null
            : null,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`${LOG_PREFIX} Row skipped — ${reason}`);
      errors.push(`Row parse error: ${reason}`);
    }
  }

  return { listings, errors };
}

function countProjectRows(rows: TableRows): number {
  return rows.filter((row) => row.querySelectorAll('td').length >= 2).length;
}

function detectPagination(html: string): boolean {
  const root = parse(html);

  if (
    root.querySelector(
      '.pagination, [class*="pagination"], [class*="pager"], nav[aria-label*="pagination" i]',
    )
  ) {
    return true;
  }

  for (const link of root.querySelectorAll('a, button')) {
    const text = normalizeText(link.text).toLowerCase();
    if (
      text === 'next' ||
      text === 'previous' ||
      text === 'prev' ||
      /^page \d+$/i.test(text)
    ) {
      return true;
    }
  }

  return /page\s+\d+\s+of\s+\d+/i.test(html);
}

function warnIfPaginationDetected(html: string): void {
  if (detectPagination(html)) {
    console.log(
      `${LOG_PREFIX} ALERT: pagination appears to exist but is not handled yet. Only the first page will be scraped.`,
    );
  }
}

async function getHtmlViaFetch(): Promise<string | null> {
  console.log(`${LOG_PREFIX} Fetching via HTTP...`);

  try {
    return await withRetry(
      async () => {
        const response = await fetch(LISTING_URL, {
          headers: FETCH_HEADERS,
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        return await response.text();
      },
      { maxAttempts: 2, label: 'Caltrans listing fetch' },
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'TimeoutError') {
      console.log(
        `${LOG_PREFIX} Fetch failed (timeout after ${FETCH_TIMEOUT_MS / 1000}s). Falling back to Playwright...`,
      );
      return null;
    }

    const message = err instanceof Error ? err.message : String(err);
    console.log(
      `${LOG_PREFIX} Fetch failed (${message}). Falling back to Playwright...`,
    );
    return null;
  }
}

async function getHtmlViaPlaywright(): Promise<string> {
  return withRetry(
    async () => {
      console.log(`${LOG_PREFIX} Launching Playwright (Chromium headless)...`);

      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });
      let context;

      try {
        context = await browser.newContext({ userAgent: USER_AGENT });
        const page = await context.newPage();
        await page.goto(LISTING_URL, { timeout: 30000 });
        await page.waitForSelector('table', { timeout: 20000 });
        return await page.content();
      } catch (err) {
        throw new Error(
          `Playwright navigation failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        await context?.close();
        await browser.close();
      }
    },
    { maxAttempts: 2, label: 'Caltrans Playwright navigation' },
  );
}

export async function scrapeCaltrans(): Promise<CaltransScraperResult> {
  let method: CaltransScraperResult['method'] = 'playwright';
  let tableResult: ReturnType<typeof findTableAndRows> = null;

  const fetchHtml = await getHtmlViaFetch();

  if (fetchHtml) {
    tableResult = findTableAndRows(fetchHtml);
    if (tableResult) {
      const rowCount = countProjectRows(tableResult.rows);
      console.log(
        `${LOG_PREFIX} Table found in fetch HTML. ${rowCount} project rows found. Parsing...`,
      );
      warnIfPaginationDetected(fetchHtml);
      method = 'fetch';
    } else {
      console.log(
        `${LOG_PREFIX} No table in fetch HTML. Falling back to Playwright...`,
      );
    }
  }

  if (!tableResult) {
    const playwrightHtml = await getHtmlViaPlaywright();
    tableResult = findTableAndRows(playwrightHtml);

    if (!tableResult) {
      throw new Error(
        'Table not found even with Playwright — selectors may have changed.',
      );
    }

    const rowCount = countProjectRows(tableResult.rows);
    console.log(
      `${LOG_PREFIX} Table found via Playwright. ${rowCount} project rows found. Parsing...`,
    );
    warnIfPaginationDetected(playwrightHtml);
    method = 'playwright';
  }

  const { colMap, rows } = tableResult;
  const { listings, errors } = parseRows(colMap, rows);

  console.log(
    `${LOG_PREFIX} Done. Found: ${listings.length} listings, Errors: ${errors.length} (method: ${method})`,
  );

  return {
    source: SOURCE,
    method,
    listingsFound: listings.length,
    listings,
    errors,
  };
}
