import type {
  ManualReview,
  ManualReviewPriority,
  ManualReviewStatus,
} from '@/types/extraction';
import type { FieldComparison } from '@/workers/comparison/comparison-schema';

import { createAdminClient } from './admin';

export type ReviewListItem = {
  id: string;
  bid_id: string;
  bid_title: string;
  bid_source_url: string;
  comparison_id: string | null;
  status: ManualReviewStatus;
  priority: ManualReviewPriority;
  reason: string | null;
  conflict_count: number | null;
  high_risk_conflict_count: number | null;
  overall_comparison_confidence: number | null;
  created_at: string;
  updated_at: string;
};

export type ReviewDetail = {
  id: string;
  bid_id: string;
  bid_title: string;
  bid_source_url: string;
  comparison_id: string | null;
  status: ManualReviewStatus;
  priority: ManualReviewPriority;
  reason: string | null;
  reviewer_notes: string | null;
  corrected_fields: Record<string, unknown> | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  claude_extraction_run_id: string | null;
  claude_model: string | null;
  claude_completed_at: string | null;
  claude_confidence: number | null;
  openai_extraction_run_id: string | null;
  openai_model: string | null;
  openai_completed_at: string | null;
  openai_confidence: number | null;
  overall_comparison_confidence: number | null;
  review_status: string | null;
  conflict_count: number;
  high_risk_conflict_count: number;
  field_comparisons: FieldComparison[] | null;
  review_reasons: string[] | null;
  warnings: string[] | null;
};

export type ReviewFilters = {
  status?: ManualReviewStatus;
  priority?: ManualReviewPriority;
  limit?: number;
  offset?: number;
};

export type ReviewPatchInput = {
  status?: ManualReviewStatus;
  corrected_fields?: Record<string, unknown>;
  reviewer_notes?: string;
};

const PRIORITY_WEIGHT: Record<ManualReviewPriority, number> = {
  high: 3,
  normal: 2,
  low: 1,
};

const RESOLVED_STATUSES = new Set<ManualReviewStatus>([
  'approved',
  'corrected',
  'failed',
]);

const VALID_TRANSITIONS: Record<ManualReviewStatus, ManualReviewStatus[]> = {
  open: ['in_progress', 'failed'],
  in_progress: ['approved', 'corrected', 'failed'],
  approved: [],
  corrected: [],
  failed: [],
};

type BidJoin = {
  title: string;
  source_url: string;
};

type ComparisonJoin = {
  conflict_count: number | null;
  high_risk_conflict_count: number | null;
  overall_comparison_confidence: number | null;
  review_status: string | null;
  comparison_result: Record<string, unknown> | null;
  review_reasons: string[] | null;
  warnings: string[] | null;
};

type ExtractionRunJoin = {
  model: string | null;
  completed_at: string | null;
  confidence: number | null;
};

type ReviewListRow = {
  id: string;
  bid_id: string;
  comparison_id: string | null;
  status: ManualReviewStatus;
  priority: ManualReviewPriority;
  reason: string | null;
  created_at: string;
  updated_at: string;
  bids: BidJoin | BidJoin[] | null;
  ai_extraction_comparisons: ComparisonJoin | ComparisonJoin[] | null;
};

type ReviewDetailRow = {
  id: string;
  bid_id: string;
  comparison_id: string | null;
  status: ManualReviewStatus;
  priority: ManualReviewPriority;
  reason: string | null;
  reviewer_notes: string | null;
  corrected_fields: Record<string, unknown> | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  claude_extraction_run_id: string | null;
  openai_extraction_run_id: string | null;
  bids: BidJoin | BidJoin[] | null;
  ai_extraction_comparisons: ComparisonJoin | ComparisonJoin[] | null;
  claude_run: ExtractionRunJoin | ExtractionRunJoin[] | null;
  openai_run: ExtractionRunJoin | ExtractionRunJoin[] | null;
};

function resolveJoin<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function sortReviews(rows: ReviewListRow[]): ReviewListRow[] {
  return [...rows].sort((left, right) => {
    const priorityDiff =
      PRIORITY_WEIGHT[right.priority] - PRIORITY_WEIGHT[left.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return (
      new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
    );
  });
}

function mapListItem(row: ReviewListRow): ReviewListItem {
  const bid = resolveJoin(row.bids);
  const comparison = resolveJoin(row.ai_extraction_comparisons);

  return {
    id: row.id,
    bid_id: row.bid_id,
    bid_title: bid?.title ?? '',
    bid_source_url: bid?.source_url ?? '',
    comparison_id: row.comparison_id,
    status: row.status,
    priority: row.priority,
    reason: row.reason,
    conflict_count: comparison?.conflict_count ?? null,
    high_risk_conflict_count: comparison?.high_risk_conflict_count ?? null,
    overall_comparison_confidence:
      comparison?.overall_comparison_confidence ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function extractFieldComparisons(
  comparison: ComparisonJoin | null,
): FieldComparison[] | null {
  if (!comparison?.comparison_result) return null;

  const fieldComparisons = comparison.comparison_result.field_comparisons;
  if (!Array.isArray(fieldComparisons)) return null;

  return fieldComparisons as FieldComparison[];
}

function mapReviewDetail(row: ReviewDetailRow): ReviewDetail {
  const bid = resolveJoin(row.bids);
  const comparison = resolveJoin(row.ai_extraction_comparisons);
  const claudeRun = resolveJoin(row.claude_run);
  const openaiRun = resolveJoin(row.openai_run);
  const comparisonResult = comparison?.comparison_result ?? null;

  return {
    id: row.id,
    bid_id: row.bid_id,
    bid_title: bid?.title ?? '',
    bid_source_url: bid?.source_url ?? '',
    comparison_id: row.comparison_id,
    status: row.status,
    priority: row.priority,
    reason: row.reason,
    reviewer_notes: row.reviewer_notes,
    corrected_fields: row.corrected_fields,
    resolved_at: row.resolved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claude_extraction_run_id: row.claude_extraction_run_id,
    claude_model: claudeRun?.model ?? null,
    claude_completed_at: claudeRun?.completed_at ?? null,
    claude_confidence: claudeRun?.confidence ?? null,
    openai_extraction_run_id: row.openai_extraction_run_id,
    openai_model: openaiRun?.model ?? null,
    openai_completed_at: openaiRun?.completed_at ?? null,
    openai_confidence: openaiRun?.confidence ?? null,
    overall_comparison_confidence:
      comparison?.overall_comparison_confidence ?? null,
    review_status: comparison?.review_status ?? null,
    conflict_count: comparison?.conflict_count ?? 0,
    high_risk_conflict_count: comparison?.high_risk_conflict_count ?? 0,
    field_comparisons: extractFieldComparisons(comparison),
    review_reasons:
      comparison?.review_reasons ??
      (Array.isArray(comparisonResult?.review_reasons)
        ? (comparisonResult.review_reasons as string[])
        : null),
    warnings:
      comparison?.warnings ??
      (Array.isArray(comparisonResult?.warnings)
        ? (comparisonResult.warnings as string[])
        : null),
  };
}

export async function getReviews(
  filters: ReviewFilters = {},
): Promise<{ reviews: ReviewListItem[]; total: number }> {
  const supabase = createAdminClient();
  const limit = Math.min(filters.limit ?? 20, 100);
  const offset = filters.offset ?? 0;

  let query = supabase
    .from('manual_reviews')
    .select(
      `
      id,
      bid_id,
      comparison_id,
      status,
      priority,
      reason,
      created_at,
      updated_at,
      bids!inner ( title, source_url ),
      ai_extraction_comparisons (
        conflict_count,
        high_risk_conflict_count,
        overall_comparison_confidence
      )
    `,
      { count: 'exact' },
    );

  if (filters.status) query = query.eq('status', filters.status);
  if (filters.priority) query = query.eq('priority', filters.priority);

  const { data, error, count } = await query;

  if (error) {
    throw new Error(`Failed to fetch reviews: ${error.message}`);
  }

  const sorted = sortReviews((data ?? []) as ReviewListRow[]);
  const reviews = sorted.slice(offset, offset + limit).map(mapListItem);

  return {
    reviews,
    total: count ?? sorted.length,
  };
}

export async function getReviewById(id: string): Promise<ReviewDetail | null> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('manual_reviews')
    .select(
      `
      id,
      bid_id,
      comparison_id,
      status,
      priority,
      reason,
      reviewer_notes,
      corrected_fields,
      resolved_at,
      created_at,
      updated_at,
      claude_extraction_run_id,
      openai_extraction_run_id,
      bids!inner ( title, source_url ),
      ai_extraction_comparisons (
        conflict_count,
        high_risk_conflict_count,
        overall_comparison_confidence,
        review_status,
        comparison_result,
        review_reasons,
        warnings
      ),
      claude_run:ai_extraction_runs!claude_extraction_run_id (
        model,
        completed_at,
        confidence
      ),
      openai_run:ai_extraction_runs!openai_extraction_run_id (
        model,
        completed_at,
        confidence
      )
    `,
    )
    .eq('id', id)
    .single();

  if (error) {
    if (error.code === 'PGRST116') return null;
    throw new Error(`Failed to fetch review: ${error.message}`);
  }

  return mapReviewDetail(data as ReviewDetailRow);
}

export async function patchReview(
  id: string,
  input: ReviewPatchInput,
): Promise<ManualReview> {
  const supabase = createAdminClient();

  const { data: current, error: fetchError } = await supabase
    .from('manual_reviews')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError) {
    if (fetchError.code === 'PGRST116') {
      throw new Error('Review not found');
    }
    throw new Error(`Failed to fetch review: ${fetchError.message}`);
  }

  const review = current as ManualReview;

  if (input.status !== undefined) {
    const allowed = VALID_TRANSITIONS[review.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new Error('Invalid status transition');
    }
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (input.status !== undefined) {
    patch.status = input.status;
    if (RESOLVED_STATUSES.has(input.status)) {
      patch.resolved_at = new Date().toISOString();
    }
  }

  if (input.corrected_fields !== undefined) {
    patch.corrected_fields = input.corrected_fields;
  }

  if (input.reviewer_notes !== undefined) {
    patch.reviewer_notes = input.reviewer_notes;
  }

  const { data, error } = await supabase
    .from('manual_reviews')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) {
    throw new Error(`Failed to update review: ${error.message}`);
  }

  return data as ManualReview;
}
