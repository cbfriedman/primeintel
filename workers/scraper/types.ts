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

export type SavedBidRef = {
  bidId: string;
  sourceUrl: string;
};

export type BidDocumentType = 'spec' | 'plans' | 'addendum' | 'other';

export type NormalizedBidDocument = {
  bidId: string;
  name: string;
  sourceUrl: string;
  docType: BidDocumentType;
  fileSize: string | null;
};

export type SavedDocRef = {
  documentId: string;
  bidId: string;
  sourceUrl: string;
  name: string;
  docType: BidDocumentType;
};

export type ExtractDocumentsResult = {
  bids_checked: number;
  documents_found: number;
  documents: NormalizedBidDocument[];
  errors: string[];
};

export type SaveDocumentsResult = {
  bids_checked: number;
  documents_found: number;
  documents_saved: number;
  documents_updated: number;
  errors: string[];
  savedDocs: SavedDocRef[];
};
