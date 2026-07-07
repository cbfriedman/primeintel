-- Migration 013: Source registry table
-- Tracks all public-works bid sources: portals, agencies, connectors, and health.

create table public.sources (
  -- Primary key
  id                          uuid        primary key default gen_random_uuid(),

  -- Unique slug — also used as bids.source_name for all bids from this source
  slug                        text        not null unique,

  -- Agency identity
  agency_name                 text        not null,
  short_name                  text,
  entity_type                 text        not null,
  parent_agency_slug          text,
  county                      text,
  city                        text,
  region                      text,

  -- Web presence
  official_website            text,
  procurement_page_url        text,
  bid_portal_url              text,
  portal_provider             text        not null default 'unknown',
  portal_provider_agency_id   text,

  -- Access
  access_method               text        not null default 'http_fetch',
  requires_auth               boolean     not null default false,
  login_required_for_listings boolean     not null default false,
  login_required_for_docs     boolean     not null default false,
  documents_public            boolean     not null default true,

  -- Relevance
  public_works_relevant       boolean     not null default true,
  estimated_annual_projects   integer,
  priority_tier               integer     not null default 3,

  -- Connector
  scraper_type                text,
  scraper_module              text,
  connector_config            jsonb       not null default '{}',

  -- Scheduling
  expected_update_hours       integer,
  rate_limit_delay_ms         integer     not null default 1000,

  -- Status
  scraper_status              text        not null default 'not_started',
  coverage_status             text        not null default 'unknown',
  legal_status                text        not null default 'unreviewed',
  legal_notes                 text,

  -- Health (updated by worker after each run)
  last_successful_run_at      timestamptz,
  last_failed_run_at          timestamptz,
  last_project_discovered_at  timestamptz,
  consecutive_failure_count   integer     not null default 0,
  last_failure_reason         text,
  total_projects_discovered   integer     not null default 0,
  total_documents_downloaded  integer     not null default 0,

  notes                       text,

  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

-- CHECK constraints

alter table public.sources add constraint sources_entity_type_check
  check (entity_type in (
    'county',
    'city',
    'town',
    'school_district',
    'community_college_district',
    'university',
    'transportation_agency',
    'transit_agency',
    'water_district',
    'utility_district',
    'sanitation_district',
    'airport',
    'port',
    'housing_authority',
    'special_district',
    'parks_recreation',
    'public_hospital',
    'other_public_entity'
  ));

alter table public.sources add constraint sources_portal_provider_check
  check (portal_provider in (
    'unknown',
    'planetbids',
    'opengov',
    'bonfire',
    'bidnet_direct',
    'publicpurchase',
    'caleprocure',
    'ebidboard',
    'html_table',
    'custom_js',
    'rss_feed',
    'pdf_listing',
    'email_notice',
    'api_direct',
    'demandstar',
    'bidlink',
    'onlineplanservice'
  ));

alter table public.sources add constraint sources_access_method_check
  check (access_method in (
    'http_fetch',
    'playwright',
    'api',
    'rss_feed',
    'email_notice',
    'manual'
  ));

alter table public.sources add constraint sources_scraper_status_check
  check (scraper_status in (
    'not_started',
    'in_development',
    'testing',
    'active',
    'degraded',
    'blocked',
    'retired'
  ));

alter table public.sources add constraint sources_coverage_status_check
  check (coverage_status in (
    'unknown',
    'active',
    'partial',
    'inactive',
    'blocked'
  ));

alter table public.sources add constraint sources_legal_status_check
  check (legal_status in (
    'approved',
    'unreviewed',
    'flagged',
    'blocked'
  ));

alter table public.sources add constraint sources_priority_tier_check
  check (priority_tier between 1 and 4);

-- Self-referential FK for parent agency (e.g. SF Rec & Parks → SF City)
alter table public.sources add constraint sources_parent_slug_fkey
  foreign key (parent_agency_slug)
  references public.sources(slug)
  on delete set null;

-- Indexes for common queries

create index sources_county_idx
  on public.sources (county);

create index sources_entity_type_idx
  on public.sources (entity_type);

create index sources_portal_provider_idx
  on public.sources (portal_provider);

create index sources_priority_tier_idx
  on public.sources (priority_tier);

create index sources_scraper_status_idx
  on public.sources (scraper_status);

create index sources_coverage_status_idx
  on public.sources (coverage_status);

create index sources_legal_status_idx
  on public.sources (legal_status);

-- Partial index for health monitoring: only active sources, sorted by last run
create index sources_last_successful_run_idx
  on public.sources (last_successful_run_at)
  where scraper_status = 'active';

-- Partial index for failure monitoring
create index sources_consecutive_failures_idx
  on public.sources (consecutive_failure_count)
  where consecutive_failure_count > 0;

-- Parent-child relationship lookup
create index sources_parent_slug_idx
  on public.sources (parent_agency_slug)
  where parent_agency_slug is not null;
