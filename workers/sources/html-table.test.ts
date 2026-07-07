import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { HtmlTableConnector } from './families/html-table/adapter';
import type { SourceConfig } from './types';

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const fixtureHtml = readFileSync(
  resolve(__dirname, 'fixtures/la-county-dpw-listing.html'),
  'utf-8',
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LA_COUNTY_CONFIG: SourceConfig = {
  slug: 'la-county-dpw',
  agencyName: 'Los Angeles County Department of Public Works',
  shortName: 'LA County DPW',
  entityType: 'county',
  county: 'Los Angeles',
  city: null,
  region: 'Southern California',
  priorityTier: 2,
  portalFamily: 'html_table',
  connector: {
    listingUrl:        'https://dpw.lacounty.gov/contracts/Opportunities.aspx',
    baseUrl:           'https://dpw.lacounty.gov',
    titleColIndex:     1,
    openDateColIndex:  2,
    closeDateColIndex: 3,
    tableSelector:     'table',
    skipHeaderRows:    1,
    dateFormat:        'M/D/YYYY',
  },
  rateLimitDelayMs: 3000,
};

// ---------------------------------------------------------------------------
// discoverProjects — tested against the static fixture via fetch mock
// ---------------------------------------------------------------------------

describe('HtmlTableConnector — discoverProjects (fixture)', () => {
  it('parses 5 rows from the fixture (4 linked + 1 no-link)', async () => {
    // We test the parsing logic by invoking discoverProjects with a mocked
    // global fetch so no real HTTP call is made.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(fixtureHtml, { status: 200 }),
    );

    const connector = new HtmlTableConnector(LA_COUNTY_CONFIG);
    const { projects } = await connector.discoverProjects();

    expect(projects).toHaveLength(5);
    fetchSpy.mockRestore();
  });

  it('extracts project_id from cons URL', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(fixtureHtml, { status: 200 }),
    );

    const connector = new HtmlTableConnector(LA_COUNTY_CONFIG);
    const { projects } = await connector.discoverProjects();

    const first = projects[0];
    expect(first.sourceId).toBe('RDC0015913');
    expect(first.sourceUrl).toContain('ProjectDetailAdv.aspx?project_id=RDC0015913');
    fetchSpy.mockRestore();
  });

  it('parses close date in ISO format', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(fixtureHtml, { status: 200 }),
    );

    const connector = new HtmlTableConnector(LA_COUNTY_CONFIG);
    const { projects } = await connector.discoverProjects();

    expect(projects[0].bidDate).toBe('2026-06-15');
    expect(projects[0].advertiseDate).toBe('2026-05-01');
    fetchSpy.mockRestore();
  });

  it('handles row with no link — falls back to listingUrl', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(fixtureHtml, { status: 200 }),
    );

    const connector = new HtmlTableConnector(LA_COUNTY_CONFIG);
    const { projects } = await connector.discoverProjects();

    const noLinkRow = projects[4];
    expect(noLinkRow.title).toBe('Pavement Striping Contract (Pending Publication)');
    expect(noLinkRow.sourceId).toBeNull();
    expect(noLinkRow.sourceUrl).toBe(LA_COUNTY_CONFIG.connector.listingUrl);
    expect(noLinkRow.bidDate).toBeNull();
    fetchSpy.mockRestore();
  });

  it('sets agency from config on all rows', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(fixtureHtml, { status: 200 }),
    );

    const connector = new HtmlTableConnector(LA_COUNTY_CONFIG);
    const { projects } = await connector.discoverProjects();

    for (const p of projects) {
      expect(p.agency).toBe('Los Angeles County Department of Public Works');
      expect(p.county).toBe('Los Angeles');
      expect(p.sourceSlug).toBe('la-county-dpw');
    }
    fetchSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// discoverDocuments — always empty for this source
// ---------------------------------------------------------------------------

describe('HtmlTableConnector — discoverDocuments', () => {
  it('returns empty array (documents gated)', async () => {
    const connector = new HtmlTableConnector(LA_COUNTY_CONFIG);
    const docs = await connector.discoverDocuments({
      sourceSlug: 'la-county-dpw',
      sourceId: 'RDC0015913',
      sourceUrl: 'https://dpw.lacounty.gov/contracts/cons/ProjectDetailAdv.aspx?project_id=RDC0015913',
      title: 'Road Rehabilitation',
      agency: null,
      county: null,
      city: null,
      bidDate: null,
      advertiseDate: null,
      license: null,
      status: null,
      rawData: {},
    });
    expect(docs).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// downloadDocument — throws
// ---------------------------------------------------------------------------

describe('HtmlTableConnector — downloadDocument', () => {
  it('throws for gated source', async () => {
    const connector = new HtmlTableConnector(LA_COUNTY_CONFIG);
    await expect(
      connector.downloadDocument({
        sourceUrl: 'https://dpw.lacounty.gov/docs/test.pdf',
        filename: 'test.pdf',
        docType: 'bid_package',
        isSessionBound: true,
        sizeHint: null,
      }),
    ).rejects.toThrow(/gated/);
  });
});

// ---------------------------------------------------------------------------
// Constructor validation
// ---------------------------------------------------------------------------

describe('HtmlTableConnector — constructor', () => {
  it('throws if listingUrl is missing', () => {
    expect(
      () =>
        new HtmlTableConnector({
          ...LA_COUNTY_CONFIG,
          connector: { baseUrl: 'https://example.com' },
        }),
    ).toThrow(/listingUrl is required/);
  });

  it('throws if baseUrl is missing', () => {
    expect(
      () =>
        new HtmlTableConnector({
          ...LA_COUNTY_CONFIG,
          connector: { listingUrl: 'https://example.com/bids' },
        }),
    ).toThrow(/baseUrl is required/);
  });
});

// ---------------------------------------------------------------------------
// Date parsing (tested indirectly via fixture — also directly below)
// ---------------------------------------------------------------------------

// We re-test a few edge-case dates by constructing minimal HTML.
const makeMinimalHtml = (rows: string) => `
<table>
  <tr><th>Name</th><th>Open</th><th>Close</th></tr>
  ${rows}
</table>`;

describe('HtmlTableConnector — date parsing edge cases', () => {
  async function getFirstProject(html: string, dateFormat = 'M/D/YYYY') {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce(
      new Response(html, { status: 200 }),
    );
    const connector = new HtmlTableConnector({
      ...LA_COUNTY_CONFIG,
      connector: {
        ...LA_COUNTY_CONFIG.connector,
        titleColIndex: 0,
        openDateColIndex: 1,
        closeDateColIndex: 2,
        dateFormat,
      },
    });
    const { projects } = await connector.discoverProjects();
    fetchSpy.mockRestore();
    return projects[0];
  }

  it('parses single-digit month/day', async () => {
    const html = makeMinimalHtml(
      '<tr><td><a href="/x?project_id=X1">Test</a></td><td>1/5/2026</td><td>2/7/2026</td></tr>',
    );
    const p = await getFirstProject(html);
    expect(p.advertiseDate).toBe('2026-01-05');
    expect(p.bidDate).toBe('2026-02-07');
  });

  it('treats N/A as null', async () => {
    const html = makeMinimalHtml(
      '<tr><td><a href="/x?project_id=X2">Test</a></td><td>N/A</td><td>N/A</td></tr>',
    );
    const p = await getFirstProject(html);
    expect(p.advertiseDate).toBeNull();
    expect(p.bidDate).toBeNull();
  });

  it('returns null for unparseable date', async () => {
    const html = makeMinimalHtml(
      '<tr><td><a href="/x?project_id=X3">Test</a></td><td>not-a-date</td><td>???</td></tr>',
    );
    const p = await getFirstProject(html);
    expect(p.advertiseDate).toBeNull();
    expect(p.bidDate).toBeNull();
  });
});

