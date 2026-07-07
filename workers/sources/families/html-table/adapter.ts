/**
 * Generic HTML table scraper for government bid portals that render a simple
 * <table> listing without JavaScript (server-rendered HTML).
 *
 * Configured via connector_config in the sources row:
 *   listingUrl        — full URL of the listing page
 *   baseUrl           — used to resolve relative href links
 *   titleColIndex     — 0-based column index for bid title (default: 0)
 *   openDateColIndex  — 0-based column index for open/advertise date (default: 1)
 *   closeDateColIndex — 0-based column index for close/bid date (default: 2)
 *   tableSelector     — CSS selector for the <table> element (default: 'table')
 *   skipHeaderRows    — number of <tr> rows to skip at the top (default: 1)
 *   dateFormat        — 'M/D/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' (default: 'M/D/YYYY')
 *
 * LA County DPW-specific behaviour:
 *   - Detail URL is parsed from the link href in the title cell.
 *   - project_id is extracted from the URL query string (?project_id=...).
 *   - Documents are gated behind vendor registration; discoverDocuments returns [].
 */

import { parse as parseHtml } from 'node-html-parser';
import type { SourceConfig, SourceConnector, ConnectorHealthResult, RawProject, RawDocument } from '../../types';

type HtmlTableConfig = {
  listingUrl: string;
  baseUrl: string;
  titleColIndex?: number;
  openDateColIndex?: number;
  closeDateColIndex?: number;
  tableSelector?: string;
  skipHeaderRows?: number;
  dateFormat?: 'M/D/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD';
};

type DiscoverProjectsResult = { projects: RawProject[] };

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

function parseDateToIso(raw: string, format: string): string | null {
  const s = raw.trim();
  if (!s || s === 'N/A' || s === '—' || s === '-') return null;

  if (format === 'YYYY-MM-DD') {
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }

  // M/D/YYYY or MM/DD/YYYY
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts.map(Number);
  if (!m || !d || !y || y < 1900 || y > 2100) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// HTML fetching
// ---------------------------------------------------------------------------

const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; PrimeIntelBot/1.0; +https://primeintel.com/bot)';

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} fetching ${url}`);
    }

    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Table parsing
// ---------------------------------------------------------------------------

type ParsedRow = {
  title: string;
  detailUrl: string | null;
  sourceId: string | null;
  openDate: string | null;
  closeDate: string | null;
};

function extractProjectIdFromUrl(href: string): string | null {
  try {
    // Works for both absolute and relative URLs with ?project_id=...
    const searchPart = href.includes('?') ? href.split('?')[1] : '';
    const params = new URLSearchParams(searchPart);
    return params.get('project_id') ?? null;
  } catch {
    return null;
  }
}

function resolveUrl(href: string, baseUrl: string): string {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function parseTable(
  html: string,
  cfg: Required<HtmlTableConfig>,
): ParsedRow[] {
  const root = parseHtml(html);

  const table = root.querySelector(cfg.tableSelector);
  if (!table) return [];

  const allRows = table.querySelectorAll('tr');
  const dataRows = allRows.slice(cfg.skipHeaderRows);
  const results: ParsedRow[] = [];

  for (const row of dataRows) {
    const cells = row.querySelectorAll('td');
    if (cells.length === 0) continue;

    const titleCell = cells[cfg.titleColIndex];
    if (!titleCell) continue;

    const linkEl = titleCell.querySelector('a');
    // Prefer the link's own text — the cell can also contain unrelated
    // description/boilerplate text (e.g. a scope summary or a BidExpress
    // link) that would otherwise leak into the title.
    const title = (linkEl?.text ?? titleCell.text)?.trim() ?? '';
    if (!title) continue;

    const href = linkEl?.getAttribute('href') ?? null;
    const detailUrl = href ? resolveUrl(href, cfg.baseUrl) : null;
    const sourceId = href ? extractProjectIdFromUrl(href) : null;

    const rawOpen = cells[cfg.openDateColIndex]?.text?.trim() ?? null;
    const rawClose = cells[cfg.closeDateColIndex]?.text?.trim() ?? null;

    results.push({
      title,
      detailUrl,
      sourceId,
      openDate: rawOpen ? parseDateToIso(rawOpen, cfg.dateFormat) : null,
      closeDate: rawClose ? parseDateToIso(rawClose, cfg.dateFormat) : null,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class HtmlTableConnector implements SourceConnector {
  readonly config: SourceConfig;
  private readonly htmlCfg: Required<HtmlTableConfig>;

  constructor(config: SourceConfig) {
    this.config = config;

    const raw = config.connector as Partial<HtmlTableConfig>;

    if (!raw.listingUrl) {
      throw new Error(`[html-table] ${config.slug}: connector_config.listingUrl is required`);
    }
    if (!raw.baseUrl) {
      throw new Error(`[html-table] ${config.slug}: connector_config.baseUrl is required`);
    }

    this.htmlCfg = {
      listingUrl:        raw.listingUrl,
      baseUrl:           raw.baseUrl,
      titleColIndex:     raw.titleColIndex     ?? 0,
      openDateColIndex:  raw.openDateColIndex  ?? 1,
      closeDateColIndex: raw.closeDateColIndex ?? 2,
      tableSelector:     raw.tableSelector     ?? 'table',
      skipHeaderRows:    raw.skipHeaderRows     ?? 1,
      dateFormat:        raw.dateFormat        ?? 'M/D/YYYY',
    };
  }

  async checkHealth(): Promise<ConnectorHealthResult> {
    try {
      const html = await fetchHtml(this.htmlCfg.listingUrl);
      const rows = parseTable(html, this.htmlCfg);
      return {
        ok: true,
        projectCount: rows.length,
        pagesScraped: 1,
        errorMessage: null,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, projectCount: 0, pagesScraped: 0, errorMessage: msg };
    }
  }

  async discoverProjects(): Promise<DiscoverProjectsResult> {
    const html = await fetchHtml(this.htmlCfg.listingUrl);
    const rows = parseTable(html, this.htmlCfg);

    const projects: RawProject[] = rows.map((row) => ({
      sourceSlug:    this.config.slug,
      sourceId:      row.sourceId,
      sourceUrl:     row.detailUrl ?? this.htmlCfg.listingUrl,
      title:         row.title,
      agency:        this.config.agencyName,
      county:        this.config.county,
      city:          this.config.city,
      bidDate:       row.closeDate,
      advertiseDate: row.openDate,
      license:       null,
      status:        null,
      rawData:       {
        detailUrl: row.detailUrl,
        sourceId:  row.sourceId,
        openDate:  row.openDate,
        closeDate: row.closeDate,
      },
    }));

    return { projects };
  }

  async discoverDocuments(_project: RawProject): Promise<RawDocument[]> {
    // LA County DPW (and most html_table sources) gate documents behind
    // vendor registration. Return empty — bid metadata is still saved.
    // When a source does expose public documents, override this per-source
    // by subclassing or by adding a `publicDocumentsSelector` config field.
    return [];
  }

  async downloadDocument(_doc: RawDocument): Promise<Buffer> {
    throw new Error(
      `[html-table] ${this.config.slug}: downloadDocument not supported — documents are gated`,
    );
  }
}
