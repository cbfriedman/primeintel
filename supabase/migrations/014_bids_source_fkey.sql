-- Migration 014: Seed Caltrans source and add bids → sources foreign key.
-- Must run after 013_sources_table.sql.

-- Seed the Caltrans source so existing bids.source_name = 'caltrans' rows
-- satisfy the FK constraint before it is applied.
insert into public.sources (
  slug,
  agency_name,
  short_name,
  entity_type,
  region,
  official_website,
  procurement_page_url,
  bid_portal_url,
  portal_provider,
  access_method,
  public_works_relevant,
  estimated_annual_projects,
  priority_tier,
  scraper_type,
  scraper_module,
  connector_config,
  expected_update_hours,
  rate_limit_delay_ms,
  scraper_status,
  coverage_status,
  legal_status,
  notes
) values (
  'caltrans',
  'California Department of Transportation',
  'Caltrans',
  'transportation_agency',
  'Statewide',
  'https://dot.ca.gov',
  'https://ccop.dot.ca.gov/allProjects',
  'https://caleprocure.ca.gov',
  'caleprocure',
  'playwright',
  true,
  200,
  1,
  'caleprocure',
  'workers/sources/families/caleprocure/adapter.ts',
  '{"listingUrl": "https://ccop.dot.ca.gov/allProjects", "baseUrl": "https://ccop.dot.ca.gov"}',
  4,
  2000,
  'active',
  'active',
  'approved',
  'State DOT. Operated by Caltrans. Uses CCOP for bid listings and CaleProcure for document packages.'
) on conflict (slug) do update set
  agency_name              = excluded.agency_name,
  short_name               = excluded.short_name,
  entity_type              = excluded.entity_type,
  region                   = excluded.region,
  official_website         = excluded.official_website,
  procurement_page_url     = excluded.procurement_page_url,
  bid_portal_url           = excluded.bid_portal_url,
  portal_provider          = excluded.portal_provider,
  access_method            = excluded.access_method,
  scraper_type             = excluded.scraper_type,
  scraper_module           = excluded.scraper_module,
  connector_config         = excluded.connector_config,
  expected_update_hours    = excluded.expected_update_hours,
  priority_tier            = excluded.priority_tier,
  scraper_status           = excluded.scraper_status,
  coverage_status          = excluded.coverage_status,
  legal_status             = excluded.legal_status,
  updated_at               = now();

-- Add FK from bids.source_name → sources.slug.
-- ON UPDATE CASCADE so renaming a slug propagates.
-- ON DELETE RESTRICT prevents accidental source deletion while bids exist.
alter table public.bids
  add constraint bids_source_name_fkey
  foreign key (source_name)
  references public.sources(slug)
  on update cascade
  on delete restrict;
