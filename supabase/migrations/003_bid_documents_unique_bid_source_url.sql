alter table public.bid_documents
  add constraint bid_documents_bid_source_url_key unique (bid_id, source_url);
