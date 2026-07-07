/**
 * CaleProcure source connector.
 *
 * Wraps the existing Caltrans scraper (workers/scraper/caltrans.ts and
 * caltrans-documents.ts) behind the shared SourceConnector interface.
 * No scraping logic lives here — this is purely a delegation layer so the
 * Phase B orchestrator can treat Caltrans the same as any other source.
 *
 * When Phase B lands (run-sources.ts / registry.ts), this adapter becomes
 * the single entry point for all CaleProcure-based agencies.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { downloadDocument } from '@/workers/documents/download-document';
import { extractCaltransDocuments } from '@/workers/scraper/caltrans-documents';
import { scrapeCaltrans } from '@/workers/scraper/caltrans';

import type {
  ConnectorHealthResult,
  DiscoverProjectsResult,
  DocType,
  RawDocument,
  RawProject,
  SourceConfig,
  SourceConnector,
} from '../../types';

export class CaleprocureConnector implements SourceConnector {
  readonly config: SourceConfig;

  constructor(config: SourceConfig) {
    this.config = config;
  }

  async checkHealth(): Promise<ConnectorHealthResult> {
    try {
      const result = await scrapeCaltrans();
      return {
        ok: result.listingsFound > 0 || result.errors.length === 0,
        projectCount: result.listingsFound,
        pagesScraped: 1,
        errorMessage: result.errors.length > 0 ? result.errors[0] ?? null : null,
      };
    } catch (err) {
      return {
        ok: false,
        projectCount: 0,
        pagesScraped: 0,
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async discoverProjects(_options?: {
    page?: number;
    since?: Date;
  }): Promise<DiscoverProjectsResult> {
    // Caltrans/CaleProcure does not support server-side pagination or date filters.
    // scrapeCaltrans() returns all current listings in one pass.
    const result = await scrapeCaltrans();

    const projects: RawProject[] = result.listings.map((listing) => ({
      sourceSlug: this.config.slug,
      sourceId: listing.sourceId,
      sourceUrl: listing.sourceUrl,
      title: listing.title,
      agency: listing.agency,
      county: listing.county,
      city: null,
      bidDate: listing.bidDate,
      advertiseDate: listing.postedAt,
      license: listing.license,
      status: listing.status,
      rawData: {
        rawPdfUrl: listing.rawPdfUrl,
        scrapeErrors: result.errors,
      },
    }));

    return {
      projects,
      hasNextPage: false,
      nextPage: null,
    };
  }

  async discoverDocuments(project: RawProject): Promise<RawDocument[]> {
    // Look up the bid's DB ID — required by extractCaltransDocuments.
    // The bid must already be saved before documents are discovered.
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from('bids')
      .select('id')
      .eq('source_url', project.sourceUrl)
      .maybeSingle();

    if (error || !data) {
      throw new Error(
        `CaleprocureConnector.discoverDocuments: bid not found for ${project.sourceUrl}`,
      );
    }

    const result = await extractCaltransDocuments([
      { bidId: data.id, sourceUrl: project.sourceUrl },
    ]);

    return result.documents.map((doc): RawDocument => ({
      sourceUrl: doc.sourceUrl,
      filename: doc.name,
      docType: doc.docType as DocType,
      isSessionBound: doc.sourceUrlKind === 'session_bound_caleprocure',
      sizeHint: doc.fileSize,
    }));
  }

  async downloadDocument(doc: RawDocument): Promise<Buffer> {
    const result = await downloadDocument(doc.sourceUrl);

    if (!result.ok) {
      throw new Error(
        `CaleprocureConnector.downloadDocument: ${result.error} (${doc.sourceUrl})`,
      );
    }

    return result.buffer;
  }
}
