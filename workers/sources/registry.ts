/**
 * Source connector registry.
 *
 * Loads all active sources from the DB and returns the correct
 * SourceConnector instance for each one, keyed by portal_provider.
 * Sources whose portal_provider has no registered adapter are logged
 * and skipped — they do not cause the pipeline to fail.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { CaleprocureConnector } from './families/caleprocure/adapter';
import { HtmlTableConnector } from './families/html-table/adapter';
import type { SourceConfig, EntityType, PortalFamily, SourceConnector } from './types';

const LOG_PREFIX = '[registry]';

type SourceDbRow = {
  slug: string;
  agency_name: string;
  short_name: string | null;
  entity_type: string;
  county: string | null;
  city: string | null;
  region: string | null;
  priority_tier: number;
  portal_provider: string;
  connector_config: Record<string, unknown>;
  rate_limit_delay_ms: number;
};

function toSourceConfig(row: SourceDbRow): SourceConfig {
  return {
    slug: row.slug,
    agencyName: row.agency_name,
    shortName: row.short_name ?? undefined,
    entityType: row.entity_type as EntityType,
    county: row.county,
    city: row.city,
    region: row.region,
    priorityTier: row.priority_tier as 1 | 2 | 3 | 4,
    portalFamily: row.portal_provider as PortalFamily,
    connector: row.connector_config,
    rateLimitDelayMs: row.rate_limit_delay_ms,
  };
}

function createConnector(row: SourceDbRow): SourceConnector | null {
  const config = toSourceConfig(row);

  switch (row.portal_provider) {
    case 'caleprocure':
      return new CaleprocureConnector(config);
    case 'html_table':
      return new HtmlTableConnector(config);
    // Phase B adapters to add:
    // case 'planetbids':  return new PlanetBidsConnector(config);
    // case 'opengov':     return new OpenGovConnector(config);
    // case 'bonfire':     return new BonfireConnector(config);
    default:
      return null;
  }
}

/**
 * Returns a connector for every active source that has a registered adapter.
 * Sources are ordered by priority_tier ASC, then agency_name ASC.
 * Slugs in the exclude list are silently skipped (used to exclude Caltrans
 * while it still runs via its own legacy path in the orchestrator).
 */
export async function getActiveConnectors(options?: {
  excludeSlugs?: string[];
}): Promise<SourceConnector[]> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('sources')
    .select(
      'slug, agency_name, short_name, entity_type, county, city, region,' +
      'priority_tier, portal_provider, connector_config, rate_limit_delay_ms',
    )
    .eq('scraper_status', 'active')
    .order('priority_tier', { ascending: true })
    .order('agency_name', { ascending: true });

  if (error) {
    throw new Error(`${LOG_PREFIX} Failed to load active sources: ${error.message}`);
  }

  const rows = (data ?? []) as unknown as SourceDbRow[];
  const excluded = new Set(options?.excludeSlugs ?? []);
  const connectors: SourceConnector[] = [];

  for (const row of rows) {
    if (excluded.has(row.slug)) continue;

    const connector = createConnector(row);
    if (connector) {
      connectors.push(connector);
    } else {
      console.log(
        `${LOG_PREFIX} No adapter for portal_provider='${row.portal_provider}' (${row.slug}) — skipped`,
      );
    }
  }

  console.log(`${LOG_PREFIX} Loaded ${connectors.length} active connector(s)`);
  return connectors;
}
