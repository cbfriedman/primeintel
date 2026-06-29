create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  full_name text,
  company_name text,
  role text not null default 'contractor' check (role in ('contractor', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  preferred_counties text[] not null default '{}',
  preferred_trades text[] not null default '{}',
  min_engineers_estimate_cents bigint,
  max_engineers_estimate_cents bigint,
  email_alerts_enabled boolean not null default true,
  alert_frequency text not null default 'daily' check (alert_frequency in ('instant', 'daily', 'weekly', 'off')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.scrape_runs (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  started_at timestamptz,
  finished_at timestamptz,
  listings_found integer not null default 0,
  bids_created integer not null default 0,
  bids_updated integer not null default 0,
  documents_found integer not null default 0,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  scrape_run_id uuid references public.scrape_runs(id) on delete set null,
  source_name text not null,
  source_id text,
  source_url text not null,
  title text not null,
  description text,
  agency text,
  county text,
  city text,
  state text not null default 'CA',
  trade text,
  project_location text,
  bid_date timestamptz,
  prebid_meeting_at timestamptz,
  question_deadline_at timestamptz,
  engineers_estimate_cents bigint,
  license_requirements text,
  dbe_goal_percent numeric(5,2),
  bid_bond_percent numeric(5,2),
  payment_bond_required boolean,
  performance_bond_required boolean,
  liquidated_damages text,
  project_duration text,
  contact_name text,
  contact_email text,
  contact_phone text,
  extraction_status text not null default 'pending' check (extraction_status in ('pending', 'processing', 'completed', 'needs_review', 'failed')),
  extraction_confidence numeric(5,2) check (extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 100)),
  manual_review_required boolean not null default false,
  comparison_result jsonb,
  final_extracted_fields jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bids_source_url_key unique (source_url)
);

create table public.bid_documents (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids(id) on delete cascade,
  document_type text not null default 'bid_package',
  title text,
  source_url text,
  r2_bucket text,
  r2_key text,
  r2_url text,
  file_name text,
  content_type text,
  size_bytes bigint,
  sha256 text,
  page_count integer,
  text_extraction_status text not null default 'pending' check (text_extraction_status in ('pending', 'processing', 'completed', 'failed')),
  extracted_text text,
  extraction_error text,
  downloaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.bid_risk_flags (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids(id) on delete cascade,
  risk_type text not null,
  severity text not null check (severity in ('low', 'medium', 'high')),
  title text not null,
  detail text,
  source_excerpt text,
  page_number integer,
  ai_source text check (ai_source is null or ai_source in ('claude', 'openai', 'comparison', 'manual')),
  created_at timestamptz not null default now()
);

create table public.bid_subtrades (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids(id) on delete cascade,
  trade text not null,
  subtrade text,
  source text not null default 'manual' check (source in ('scraper', 'claude', 'openai', 'manual')),
  created_at timestamptz not null default now(),
  constraint bid_subtrades_bid_trade_subtrade_key unique (bid_id, trade, subtrade)
);

create table public.ai_extraction_runs (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids(id) on delete cascade,
  document_id uuid references public.bid_documents(id) on delete set null,
  provider text not null check (provider in ('claude', 'openai')),
  model text,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  prompt_version text,
  source_text_hash text,
  raw_response jsonb,
  parsed_output jsonb,
  validation_errors jsonb,
  confidence numeric(5,2) check (confidence is null or (confidence >= 0 and confidence <= 100)),
  input_tokens integer,
  output_tokens integer,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.manual_reviews (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids(id) on delete cascade,
  assigned_to_user_id uuid references public.users(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'approved', 'corrected', 'failed')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  reason text,
  claude_extraction_run_id uuid references public.ai_extraction_runs(id) on delete set null,
  openai_extraction_run_id uuid references public.ai_extraction_runs(id) on delete set null,
  comparison_result jsonb,
  corrected_fields jsonb,
  reviewer_notes text,
  resolved_by_user_id uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_saved_bids (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  bid_id uuid not null references public.bids(id) on delete cascade,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_saved_bids_user_bid_key unique (user_id, bid_id)
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  bid_id uuid references public.bids(id) on delete cascade,
  alert_type text not null,
  channel text not null default 'email' check (channel in ('email', 'dashboard')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'read')),
  title text not null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  read_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_user_preferences_user_id on public.user_preferences(user_id);
create index idx_scrape_runs_source_status on public.scrape_runs(source_name, status);
create index idx_bids_county on public.bids(county);
create index idx_bids_trade on public.bids(trade);
create index idx_bids_bid_date on public.bids(bid_date);
create index idx_bids_engineers_estimate_cents on public.bids(engineers_estimate_cents);
create index idx_bids_extraction_status on public.bids(extraction_status);
create index idx_bid_documents_bid_id on public.bid_documents(bid_id);
create index idx_bid_risk_flags_bid_id on public.bid_risk_flags(bid_id);
create index idx_bid_subtrades_bid_id on public.bid_subtrades(bid_id);
create index idx_bid_subtrades_trade on public.bid_subtrades(trade);
create index idx_ai_extraction_runs_bid_provider on public.ai_extraction_runs(bid_id, provider);
create index idx_ai_extraction_runs_status on public.ai_extraction_runs(status);
create index idx_manual_reviews_bid_id on public.manual_reviews(bid_id);
create index idx_manual_reviews_status on public.manual_reviews(status);
create index idx_user_saved_bids_user_id on public.user_saved_bids(user_id);
create index idx_user_saved_bids_bid_id on public.user_saved_bids(bid_id);
create index idx_alerts_user_id on public.alerts(user_id);
create index idx_alerts_status on public.alerts(status);

create trigger set_users_updated_at
before update on public.users
for each row execute function public.set_updated_at();

create trigger set_user_preferences_updated_at
before update on public.user_preferences
for each row execute function public.set_updated_at();

create trigger set_bids_updated_at
before update on public.bids
for each row execute function public.set_updated_at();

create trigger set_bid_documents_updated_at
before update on public.bid_documents
for each row execute function public.set_updated_at();

create trigger set_ai_extraction_runs_updated_at
before update on public.ai_extraction_runs
for each row execute function public.set_updated_at();

create trigger set_manual_reviews_updated_at
before update on public.manual_reviews
for each row execute function public.set_updated_at();

create trigger set_user_saved_bids_updated_at
before update on public.user_saved_bids
for each row execute function public.set_updated_at();

create trigger set_alerts_updated_at
before update on public.alerts
for each row execute function public.set_updated_at();

alter table public.users enable row level security;
alter table public.user_preferences enable row level security;
alter table public.manual_reviews enable row level security;
alter table public.user_saved_bids enable row level security;
alter table public.alerts enable row level security;
