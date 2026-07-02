alter table bids
  add column if not exists alert_matched_at timestamptz;

alter table user_preferences
  add column if not exists last_digest_sent_at timestamptz;

create index if not exists idx_bids_alert_matched_at on public.bids(alert_matched_at);
