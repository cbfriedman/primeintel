alter table bids
  add column if not exists bid_cap_cents        bigint,
  add column if not exists bid_security_text    text,
  add column if not exists perf_payment_bond_text text;
