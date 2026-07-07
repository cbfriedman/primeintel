-- Seed file for the sources registry.
-- Run after migrations 013 and 014 are applied.
-- Safe to re-run: uses INSERT ... ON CONFLICT DO UPDATE.

-- Caltrans is already seeded by migration 014_bids_source_fkey.sql.
-- This file adds additional sources.

INSERT INTO public.sources (
  slug,
  agency_name,
  short_name,
  entity_type,
  county,
  city,
  region,
  priority_tier,
  portal_provider,
  scraper_status,
  coverage_status,
  legal_status,
  connector_config,
  rate_limit_delay_ms,
  expected_update_hours,
  notes
) VALUES (
  'la-county-dpw',
  'Los Angeles County Department of Public Works',
  'LA County DPW',
  'county',
  'Los Angeles',
  NULL,
  'Southern California',
  2,
  'html_table',
  'active',
  'partial',
  'approved',
  '{
    "listingUrl":             "https://dpw.lacounty.gov/contracts/Opportunities.aspx",
    "baseUrl":                "https://dpw.lacounty.gov",
    "titleColIndex":          1,
    "openDateColIndex":       2,
    "closeDateColIndex":      3,
    "tableSelector":          "table",
    "skipHeaderRows":         1,
    "dateFormat":             "M/D/YYYY",
    "login_required_for_docs": true
  }',
  3000,
  24,
  'Documents gated behind vendor registration (OpportunitiesNewRegister.aspx). Bid metadata only until portal grants access or public docs are identified.'
)
ON CONFLICT (slug) DO UPDATE SET
  agency_name        = EXCLUDED.agency_name,
  short_name         = EXCLUDED.short_name,
  entity_type        = EXCLUDED.entity_type,
  county             = EXCLUDED.county,
  region             = EXCLUDED.region,
  priority_tier      = EXCLUDED.priority_tier,
  portal_provider    = EXCLUDED.portal_provider,
  connector_config   = EXCLUDED.connector_config,
  rate_limit_delay_ms = EXCLUDED.rate_limit_delay_ms,
  expected_update_hours = EXCLUDED.expected_update_hours,
  notes              = EXCLUDED.notes,
  updated_at         = now();
