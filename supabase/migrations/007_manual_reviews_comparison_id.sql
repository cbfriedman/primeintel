-- Link manual_reviews to ai_extraction_comparisons.
-- on delete set null: deleting a comparison does not delete the review.
alter table public.manual_reviews
  add column if not exists comparison_id uuid
    references public.ai_extraction_comparisons(id) on delete set null;

create index if not exists idx_manual_reviews_comparison_id
  on public.manual_reviews(comparison_id);
