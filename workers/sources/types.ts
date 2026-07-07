/**
 * Shared types for the PrimeIntel source connector system.
 *
 * Each portal family (PlanetBids, CaleProcure, OpenGov, …) implements
 * SourceConnector using a SourceConfig from workers/sources/agencies/*.ts.
 * The orchestrator calls runAllSources() which iterates active connectors
 * and feeds results into the shared pipeline (R2 upload → text extraction
 * → AI extraction → comparison).
 */

// ---------------------------------------------------------------------------
// Source configuration (one per agency, stored in workers/sources/agencies/)
// ---------------------------------------------------------------------------

export type PortalFamily =
  | 'caleprocure'
  | 'planetbids'
  | 'opengov'
  | 'bonfire'
  | 'bidnet_direct'
  | 'publicpurchase'
  | 'ebidboard'
  | 'html_table'
  | 'rss_feed'
  | 'custom_js'
  | 'api_direct';

export type EntityType =
  | 'county'
  | 'city'
  | 'town'
  | 'school_district'
  | 'community_college_district'
  | 'university'
  | 'transportation_agency'
  | 'transit_agency'
  | 'water_district'
  | 'utility_district'
  | 'sanitation_district'
  | 'airport'
  | 'port'
  | 'housing_authority'
  | 'special_district'
  | 'parks_recreation'
  | 'public_hospital'
  | 'other_public_entity';

export type SourceConfig = {
  /** Must match sources.slug in the database. Also becomes bids.source_name. */
  slug: string;

  agencyName: string;
  shortName?: string;
  entityType: EntityType;

  county: string | null;
  city: string | null;
  region: string | null;

  priorityTier: 1 | 2 | 3 | 4;

  /** Which portal family adapter handles this source. */
  portalFamily: PortalFamily;

  /** Family-specific configuration: agencyId, listingUrl, columnMap overrides, etc. */
  connector: Record<string, unknown>;

  /** Milliseconds to wait between requests to this source (default 1000). */
  rateLimitDelayMs?: number;
};

// ---------------------------------------------------------------------------
// Raw data produced by connectors (before normalization and DB persistence)
// ---------------------------------------------------------------------------

export type RawProject = {
  /** Matches the SourceConfig.slug this project came from. */
  sourceSlug: string;

  /** Portal-specific project ID (stable within the source). Null if unavailable. */
  sourceId: string | null;

  /**
   * Canonical URL for this project's detail page.
   * Used as the global dedup key (bids.source_url UNIQUE).
   */
  sourceUrl: string;

  title: string;
  agency: string | null;
  county: string | null;
  city: string | null;

  /** ISO date string YYYY-MM-DD or null. */
  bidDate: string | null;

  /** ISO date string YYYY-MM-DD or null. */
  advertiseDate: string | null;

  /** Raw license or contractor classification text from the listing, if any. */
  license: string | null;

  /** Raw status text from the portal (e.g. 'Active', 'Awarded'). */
  status: string | null;

  /** All raw scraped fields preserved for debugging. Not stored in the DB. */
  rawData: Record<string, unknown>;
};

export type DocType = 'bid_package' | 'plans' | 'spec' | 'addendum' | 'other';

export type RawDocument = {
  /** URL to download the document. May be session-bound (CaleProcure viewredirect). */
  sourceUrl: string;

  filename: string;
  docType: DocType;

  /** True when the URL is ephemeral and requires a Playwright session to download. */
  isSessionBound: boolean;

  /** Human-readable file size hint from the portal listing (e.g. '2.3 MB'). Null if unavailable. */
  sizeHint: string | null;
};

// ---------------------------------------------------------------------------
// Connector health check result
// ---------------------------------------------------------------------------

export type ConnectorHealthResult = {
  ok: boolean;
  projectCount: number;
  pagesScraped: number;
  errorMessage: string | null;
};

// ---------------------------------------------------------------------------
// Connector interface — implemented by each portal family adapter
// ---------------------------------------------------------------------------

export type DiscoverProjectsResult = {
  projects: RawProject[];
  hasNextPage?: boolean;
  nextPage?: number | null;
};

export interface SourceConnector {
  readonly config: SourceConfig;

  /**
   * Confirms the source is reachable and returning results.
   * Should not throw — return ok: false on failure.
   */
  checkHealth(): Promise<ConnectorHealthResult>;

  /**
   * Returns all projects from the listing page.
   * Pass page > 1 for paginated sources (most return everything on page 1).
   */
  discoverProjects(options?: {
    page?: number;
    since?: Date;
  }): Promise<DiscoverProjectsResult>;

  /**
   * Returns all document links for a specific project.
   * May navigate to the project detail page.
   */
  discoverDocuments(project: RawProject): Promise<RawDocument[]>;

  /**
   * Downloads a single document and returns its raw bytes.
   * Throws on failure — callers must handle per-document errors.
   */
  downloadDocument(doc: RawDocument): Promise<Buffer>;
}
