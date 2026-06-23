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

export type DocumentSourceUrlKind = 'stable_direct' | 'session_bound_caleprocure';

export type NormalizedBidDocument = {
  bidId: string;
  name: string;
  sourceUrl: string;
  sourceUrlKind: DocumentSourceUrlKind;
  docType: BidDocumentType;
  fileSize: string | null;
};

export type SavedDocRef = {
  documentId: string;
  bidId: string;
  sourceUrl: string;
  sourceUrlKind: DocumentSourceUrlKind;
  name: string;
  docType: BidDocumentType;
};

export type ExtractDocumentsResult = {
  bids_checked: number;
  documents_found: number;
  documents: NormalizedBidDocument[];
  bids_with_no_documents: number;
  auth_blocked_bids: number;
  errors: string[];
};

export type SaveDocumentsResult = {
  bids_checked: number;
  documents_found: number;
  documents_saved: number;
  documents_updated: number;
  bids_with_no_documents: number;
  auth_blocked_bids: number;
  errors: string[];
  savedDocs: SavedDocRef[];
};
