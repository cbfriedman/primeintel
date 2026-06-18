export type ScrapedBidListing = {
  source: string;
  sourceId: string | null;
  sourceUrl: string;
  agency: string | null;
  county: string | null;
  title: string;
  bidDate: string | null;    // ISO 8601 date string (YYYY-MM-DD)
  postedAt: string | null;   // ISO 8601 date string (YYYY-MM-DD)
  rawPdfUrl: string | null;
  license: string | null;
  status: string | null;
};

export type ScraperResult = {
  source: string;
  listingsFound: number;
  listings: ScrapedBidListing[];
  errors: string[];          // per-row non-fatal errors — scrape continues
};
