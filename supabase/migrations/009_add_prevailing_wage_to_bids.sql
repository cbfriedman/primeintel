alter table bids
  add column if not exists prevailing_wage_required boolean;
