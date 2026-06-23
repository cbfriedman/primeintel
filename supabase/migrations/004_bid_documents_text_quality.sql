alter table public.bid_documents
  add column if not exists text_quality text
    check (text_quality in ('good', 'medium', 'poor')),
  add column if not exists requires_ocr boolean not null default false;

create index if not exists idx_bid_documents_text_extraction_status
  on public.bid_documents(text_extraction_status);
