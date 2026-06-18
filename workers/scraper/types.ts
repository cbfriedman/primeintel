export type NormalizedBidListing = {
  source: 'caltrans';
  sourceId: string | null;
  sourceUrl: string;
  agency: 'Caltrans';
  county: string | null;
  title: string;
  bidDate: string | null;
  postedAt: string | null;
  rawPdfUrl: string | null;
  license: string | null;
  status: string | null;
};

export type ScrapeMethod = 'fetch' | 'playwright';

export type CaltransScraperResult = {
  source: 'caltrans';
  method: ScrapeMethod;
  listingsFound: number;
  listings: NormalizedBidListing[];
  errors: string[];
};
