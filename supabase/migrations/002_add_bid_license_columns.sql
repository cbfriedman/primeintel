-- Add scraper-sourced license field; reserve license_required for future AI extraction.
alter table public.bids
  add column if not exists source_license text,
  add column if not exists license_required text;

comment on column public.bids.source_license is
  'License classification from the public bid listing portal (scraper).';

comment on column public.bids.license_required is
  'License requirement extracted from bid PDF/spec by AI. Not populated by scraper.';
