create table public.ai_extraction_comparisons (
  id                            uuid        primary key default gen_random_uuid(),
  bid_id                        uuid        not null references public.bids(id) on delete cascade,
  document_id                   uuid        references public.bid_documents(id) on delete set null,
  claude_run_id                 uuid        not null references public.ai_extraction_runs(id) on delete restrict,
  openai_run_id                 uuid        not null references public.ai_extraction_runs(id) on delete restrict,
  comparison_version            text        not null,
  normalization_version         text        not null,
  status                        text        not null default 'pending'
                                  check (status in ('pending', 'running', 'completed', 'failed')),
  comparison_result             jsonb,
  value_agreement_score         numeric(5,2),
  evidence_score                numeric(5,2),
  coverage_score                numeric(5,2),
  risk_penalty                  numeric(5,2),
  overall_comparison_confidence numeric(5,2)
                                  check (overall_comparison_confidence is null
                                         or (overall_comparison_confidence >= 0
                                             and overall_comparison_confidence <= 100)),
  conflict_count                integer     not null default 0,
  high_risk_conflict_count      integer     not null default 0,
  manual_review_required        boolean     not null default false,
  review_status                 text
                                  check (review_status in (
                                    'auto_accepted', 'accepted_with_warning',
                                    'manual_review_required', 'unresolved_conflict',
                                    'insufficient_evidence')),
  review_reasons                jsonb,
  warnings                      jsonb,
  error_message                 text,
  started_at                    timestamptz,
  completed_at                  timestamptz,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create unique index idx_ai_extraction_comparisons_completed_unique
  on public.ai_extraction_comparisons(claude_run_id, openai_run_id, comparison_version, normalization_version)
  where status = 'completed';

create index idx_ai_extraction_comparisons_document
  on public.ai_extraction_comparisons(document_id);

create index idx_ai_extraction_comparisons_bid
  on public.ai_extraction_comparisons(bid_id);

create index idx_ai_extraction_comparisons_status
  on public.ai_extraction_comparisons(status);

create index idx_ai_extraction_comparisons_review
  on public.ai_extraction_comparisons(manual_review_required, review_status)
  where status = 'completed';

create trigger set_ai_extraction_comparisons_updated_at
before update on public.ai_extraction_comparisons
for each row execute function public.set_updated_at();
