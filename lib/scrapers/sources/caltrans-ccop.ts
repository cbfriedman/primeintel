import { parse } from 'node-html-parser';
import { chromium } from 'playwright';

import { parseDate, normalizeText } from '../utils';
import type { ScrapedBidListing, ScraperResult } from '../types';

const SOURCE = 'caltrans';
const LISTING_URL = 'https://ccop.dot.ca.gov/allProjects';
const BASE_URL = 'https://ccop.dot.ca.gov';
const LOG_PREFIX = '[caltrans-ccop]';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

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

    const headers = headerCells.map((c) => c.text);
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
): { listings: ScrapedBidListing[]; errors: string[] } {
  const listings: ScrapedBidListing[] = [];
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

      const county =
        colMap.county !== -1
          ? normalizeText(cells[colMap.county]?.text) || null
          : null;

      const license =
        colMap.license !== -1
          ? normalizeText(cells[colMap.license]?.text) || null
          : null;

      const postedAt =
        colMap.advertiseDate !== -1
          ? parseDate(cells[colMap.advertiseDate]?.text)
          : null;

      const bidDate =
        colMap.bidDate !== -1
          ? parseDate(cells[colMap.bidDate]?.text)
          : null;

      const status =
        colMap.status !== -1
          ? normalizeText(cells[colMap.status]?.text) || null
          : null;

      listings.push({
        source: SOURCE,
        sourceId,
        sourceUrl,
        agency: 'Caltrans',
        county,
        title,
        bidDate,
        postedAt,
        rawPdfUrl: null,
        license,
        status,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.log(`${LOG_PREFIX} Row skipped — ${reason}`);
      errors.push(`Row parse error: ${reason}`);
    }
  }

  return { listings, errors };
}

async function getHtmlViaFetch(): Promise<string | null> {
  console.log(`${LOG_PREFIX} Fetching via HTTP...`);

  try {
    const response = await fetch(LISTING_URL, { headers: FETCH_HEADERS });

    if (!response.ok) {
      console.log(
        `${LOG_PREFIX} Fetch failed (HTTP ${response.status}). Falling back to Playwright...`,
      );
      return null;
    }

    return await response.text();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(
      `${LOG_PREFIX} Fetch failed (${message}). Falling back to Playwright...`,
    );
    return null;
  }
}

async function getHtmlViaPlaywright(): Promise<string> {
  console.log(`${LOG_PREFIX} Launching Playwright (Chromium headless)...`);

  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(LISTING_URL, { timeout: 30000 });
    await page.waitForSelector('table', { timeout: 20000 });
    return await page.content();
  } catch (err) {
    throw new Error(
      `Playwright navigation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    await browser.close();
  }
}

export async function scrapeCaltransCcop(): Promise<ScraperResult> {
  let method: 'fetch' | 'playwright' = 'playwright';
  let tableResult: ReturnType<typeof findTableAndRows> = null;

  const fetchHtml = await getHtmlViaFetch();

  if (fetchHtml) {
    tableResult = findTableAndRows(fetchHtml);
    if (tableResult) {
      console.log(`${LOG_PREFIX} Table found in fetch HTML. Parsing...`);
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

    console.log(`${LOG_PREFIX} Table found via Playwright. Parsing...`);
    method = 'playwright';
  }

  const { colMap, rows } = tableResult;
  const { listings, errors } = parseRows(colMap, rows);

  console.log(
    `${LOG_PREFIX} Done. Found: ${listings.length} listings, Errors: ${errors.length} (method: ${method})`,
  );

  return {
    source: SOURCE,
    listingsFound: listings.length,
    listings,
    errors,
  };
}
