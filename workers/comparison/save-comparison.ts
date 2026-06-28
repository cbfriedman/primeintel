import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractedFieldsSchema,
  type ClaudeExtractionRunOutput,
} from '../claude-extraction/schema';

import { compareFields } from './compare-fields';
import {
  comparisonResultSchema,
  COMPARISON_VERSION,
  NORMALIZATION_VERSION,
  STALE_THRESHOLD_MINUTES,
  type ComparisonResult,
} from './comparison-schema';
import { loadEligiblePairs } from './load-extraction-pairs';
import { scoreComparison } from './score-comparison';

const LOG_PREFIX = '[save-comparison]';

export type ComparisonRunResult = {
  pairs_checked: number;
  comparisons_completed: number;
  comparisons_failed: number;
  pairs_skipped: number;
  exact_match_total: number;
  normalized_match_total: number;
  conflict_total: number;
  high_risk_conflict_total: number;
  manual_review_required_total: number;
  errors: string[];
  completedComparisons: Array<{
    documentId: string;
    claudeRunId: string;
    openaiRunId: string;
    overallConfidence: number;
    conflictCount: number;
    highRiskConflictCount: number;
    reviewStatus: string;
  }>;
};

function sanitizeErrorMessage(message: string): string {
  return message.slice(0, 500);
}

function isRunOutput(value: unknown): value is ClaudeExtractionRunOutput {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.fields !== null && typeof record.fields === 'object';
}

async function resetStaleRunningRows(): Promise<void> {
  const supabase = createAdminClient();
  const threshold = new Date(
    Date.now() - STALE_THRESHOLD_MINUTES * 60 * 1000,
  ).toISOString();

  const { error } = await supabase
    .from('ai_extraction_comparisons')
    .update({
      status: 'failed',
      error_message: `Stale running row reset after ${STALE_THRESHOLD_MINUTES} minutes.`,
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'running')
    .lt('started_at', threshold);

  if (error) {
    console.log(`${LOG_PREFIX} Warning: stale row reset failed: ${error.message}`);
  }
}

async function createComparisonRow(options: {
  bidId: string;
  documentId: string;
  claudeRunId: string;
  openaiRunId: string;
}): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('ai_extraction_comparisons')
    .insert({
      bid_id: options.bidId,
      document_id: options.documentId,
      claude_run_id: options.claudeRunId,
      openai_run_id: options.openaiRunId,
      comparison_version: COMPARISON_VERSION,
      normalization_version: NORMALIZATION_VERSION,
      status: 'running',
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create comparison row: ${error.message}`);
  }

  return data.id as string;
}

async function completeComparisonRow(options: {
  rowId: string;
  result: ReturnType<typeof scoreComparison>;
}): Promise<{ skipped: boolean }> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('ai_extraction_comparisons')
    .update({
      status: 'completed',
      comparison_result: options.result,
      value_agreement_score: options.result.value_agreement_score,
      evidence_score: options.result.evidence_score,
      coverage_score: options.result.coverage_score,
      risk_penalty: options.result.risk_penalty,
      overall_comparison_confidence: options.result.overall_comparison_confidence,
      conflict_count: options.result.conflict_count,
      high_risk_conflict_count: options.result.high_risk_conflict_count,
      manual_review_required: options.result.manual_review_required,
      review_status: options.result.review_status,
      review_reasons: options.result.review_reasons,
      warnings: options.result.warnings,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', options.rowId);

  if (error) {
    if (error.code === '23505') {
      return { skipped: true };
    }
    throw new Error(`Failed to complete comparison row: ${error.message}`);
  }

  return { skipped: false };
}

async function failComparisonRow(options: {
  rowId: string;
  errorMessage: string;
}): Promise<void> {
  const supabase = createAdminClient();

  await supabase
    .from('ai_extraction_comparisons')
    .update({
      status: 'failed',
      error_message: sanitizeErrorMessage(options.errorMessage),
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', options.rowId);
}

async function createManualReviewIfNeeded(options: {
  comparisonId: string;
  bidId: string;
  claudeRunId: string;
  openaiRunId: string;
  result: ComparisonResult;
}): Promise<void> {
  const supabase = createAdminClient();

  const { data: existing } = await supabase
    .from('manual_reviews')
    .select('id')
    .eq('comparison_id', options.comparisonId)
    .maybeSingle();

  if (existing) return;

  const priority =
    options.result.high_risk_conflict_count > 0
      ? 'high'
      : options.result.conflict_count > 0
        ? 'normal'
        : 'low';

  const reason =
    options.result.review_reasons[0] ?? options.result.review_status;

  const { error: insertError } = await supabase.from('manual_reviews').insert({
    bid_id: options.bidId,
    comparison_id: options.comparisonId,
    claude_extraction_run_id: options.claudeRunId,
    openai_extraction_run_id: options.openaiRunId,
    status: 'open',
    priority,
    reason,
    comparison_result: options.result as unknown as Record<string, unknown>,
  });

  if (insertError) {
    console.log(
      `${LOG_PREFIX} Warning: failed to create manual review for bid ${options.bidId}: ${insertError.message}`,
    );
    return;
  }

  await supabase
    .from('bids')
    .update({
      manual_review_required: true,
      extraction_status: 'needs_review',
      updated_at: new Date().toISOString(),
    })
    .eq('id', options.bidId);

  console.log(
    `${LOG_PREFIX} Created manual review for bid ${options.bidId} (priority: ${priority})`,
  );
}

export async function runComparison(
  options: { limit?: number } = {},
): Promise<ComparisonRunResult> {
  const limit = options.limit ?? 1;

  await resetStaleRunningRows();

  const pairs = await loadEligiblePairs(limit);

  const result: ComparisonRunResult = {
    pairs_checked: pairs.length,
    comparisons_completed: 0,
    comparisons_failed: 0,
    pairs_skipped: 0,
    exact_match_total: 0,
    normalized_match_total: 0,
    conflict_total: 0,
    high_risk_conflict_total: 0,
    manual_review_required_total: 0,
    errors: [],
    completedComparisons: [],
  };

  console.log(`${LOG_PREFIX} Processing ${pairs.length} eligible pair(s)...`);

  if (pairs.length === 0) {
    console.log(`${LOG_PREFIX} No eligible extraction pairs found.`);
    return result;
  }

  for (const pair of pairs) {
    const label = `document ${pair.documentId}`;
    let rowId: string | null = null;

    try {
      rowId = await createComparisonRow({
        bidId: pair.bidId,
        documentId: pair.documentId,
        claudeRunId: pair.claudeRunId,
        openaiRunId: pair.openaiRunId,
      });

      if (!isRunOutput(pair.claudeParsedOutput)) {
        await failComparisonRow({
          rowId,
          errorMessage: 'Claude parsed_output is missing fields object',
        });
        result.comparisons_failed += 1;
        result.errors.push(`${label}: invalid Claude parsed_output structure`);
        continue;
      }

      if (!isRunOutput(pair.openaiParsedOutput)) {
        await failComparisonRow({
          rowId,
          errorMessage: 'OpenAI parsed_output is missing fields object',
        });
        result.comparisons_failed += 1;
        result.errors.push(`${label}: invalid OpenAI parsed_output structure`);
        continue;
      }

      const claudeValidated = extractedFieldsSchema.safeParse(
        pair.claudeParsedOutput.fields,
      );
      if (!claudeValidated.success) {
        await failComparisonRow({
          rowId,
          errorMessage: `Claude fields validation failed: ${claudeValidated.error.issues[0]?.message ?? 'unknown'}`,
        });
        result.comparisons_failed += 1;
        result.errors.push(`${label}: Claude fields validation failed`);
        continue;
      }

      const openaiValidated = extractedFieldsSchema.safeParse(
        pair.openaiParsedOutput.fields,
      );
      if (!openaiValidated.success) {
        await failComparisonRow({
          rowId,
          errorMessage: `OpenAI fields validation failed: ${openaiValidated.error.issues[0]?.message ?? 'unknown'}`,
        });
        result.comparisons_failed += 1;
        result.errors.push(`${label}: OpenAI fields validation failed`);
        continue;
      }

      const fieldComparisons = compareFields(
        claudeValidated.data,
        openaiValidated.data,
        pair.pageCount,
      );

      const scored = scoreComparison(fieldComparisons, {
        documentId: pair.documentId,
        bidId: pair.bidId,
        claudeRunId: pair.claudeRunId,
        openaiRunId: pair.openaiRunId,
        comparisonVersion: COMPARISON_VERSION,
        normalizationVersion: NORMALIZATION_VERSION,
        claudeWasTruncated: pair.claudeWasTruncated,
        openaiWasTruncated: pair.openaiWasTruncated,
        claudeWarnings: pair.claudeWarnings,
        openaiWarnings: pair.openaiWarnings,
      });

      const validatedResult = comparisonResultSchema.safeParse(scored);
      if (!validatedResult.success) {
        await failComparisonRow({
          rowId,
          errorMessage: `Comparison result validation failed: ${validatedResult.error.issues[0]?.message ?? 'unknown'}`,
        });
        result.comparisons_failed += 1;
        result.errors.push(`${label}: comparison result validation failed`);
        continue;
      }

      const { skipped } = await completeComparisonRow({
        rowId,
        result: validatedResult.data,
      });

      if (skipped) {
        result.pairs_skipped += 1;
        await failComparisonRow({
          rowId,
          errorMessage: 'Superseded by concurrent worker',
        });
        continue;
      }

      if (validatedResult.data.manual_review_required) {
        await createManualReviewIfNeeded({
          comparisonId: rowId,
          bidId: pair.bidId,
          claudeRunId: pair.claudeRunId,
          openaiRunId: pair.openaiRunId,
          result: validatedResult.data,
        });
      }

      result.comparisons_completed += 1;
      result.exact_match_total += scored.exact_match_count;
      result.normalized_match_total += scored.normalized_match_count;
      result.conflict_total += scored.conflict_count;
      result.high_risk_conflict_total += scored.high_risk_conflict_count;
      if (scored.manual_review_required) {
        result.manual_review_required_total += 1;
      }

      result.completedComparisons.push({
        documentId: pair.documentId,
        claudeRunId: pair.claudeRunId,
        openaiRunId: pair.openaiRunId,
        overallConfidence: scored.overall_comparison_confidence,
        conflictCount: scored.conflict_count,
        highRiskConflictCount: scored.high_risk_conflict_count,
        reviewStatus: scored.review_status,
      });

      console.log(
        `[comparison] Compared doc ${pair.documentId} | claude: ${pair.claudeRunId} openai: ${pair.openaiRunId}`,
      );
      console.log(
        `  confidence: ${scored.overall_comparison_confidence.toFixed(1)} | conflicts: ${scored.conflict_count} | high-risk: ${scored.high_risk_conflict_count} | status: ${scored.review_status}`,
      );
    } catch (err) {
      result.comparisons_failed += 1;
      const errorMessage = sanitizeErrorMessage(
        err instanceof Error ? err.message : String(err),
      );
      result.errors.push(`${label}: ${errorMessage}`);
      console.log(`${LOG_PREFIX} Comparison failed for ${label}: ${errorMessage}`);

      if (rowId !== null) {
        await failComparisonRow({ rowId, errorMessage });
      }
    }
  }

  console.log(
    `${LOG_PREFIX} Done. Checked: ${result.pairs_checked}, ` +
    `Completed: ${result.comparisons_completed}, Skipped: ${result.pairs_skipped}, Failed: ${result.comparisons_failed}`,
  );

  return result;
}
