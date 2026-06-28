import type {
  ComparisonResult,
  FieldComparison,
  ReviewStatus,
} from './comparison-schema';
import {
  COMPARISON_VERSION,
  HIGH_RISK_FIELDS,
  NORMALIZATION_VERSION,
  getFieldWeight,
} from './comparison-schema';

export type ScoreComparisonMeta = {
  documentId: string;
  bidId: string;
  claudeRunId: string;
  openaiRunId: string;
  comparisonVersion: string;
  normalizationVersion: string;
  claudeWasTruncated: boolean;
  openaiWasTruncated: boolean;
  claudeWarnings: string[];
  openaiWarnings: string[];
};

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function isCoverageField(fieldName: string): boolean {
  return fieldName !== 'risk_flags' && !fieldName.startsWith('risk_flags.');
}

function hasNonNullValue(comparison: FieldComparison): boolean {
  return comparison.claude_value !== null || comparison.openai_value !== null;
}

function weightedAverage(
  items: Array<{ score: number; weight: number }>,
): number {
  if (items.length === 0) return 0;
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return 0;
  const weightedSum = items.reduce(
    (sum, item) => sum + item.score * item.weight,
    0,
  );
  return weightedSum / totalWeight;
}

function resolveReviewStatus(options: {
  highRiskConflictCount: number;
  conflictCount: number;
  overallConfidence: number;
  coverageScore: number;
  warnings: string[];
  fieldComparisons: FieldComparison[];
}): ReviewStatus {
  if (options.highRiskConflictCount > 0) {
    return 'manual_review_required';
  }

  if (options.overallConfidence < 60) {
    return 'manual_review_required';
  }

  if (options.coverageScore < 20) {
    return 'insufficient_evidence';
  }

  const unresolvedHighRisk = options.fieldComparisons.some(
    (comparison) =>
      HIGH_RISK_FIELDS.has(comparison.field_name) &&
      comparison.agreement === 'conflict' &&
      comparison.evidence_score > 0.5,
  );
  if (unresolvedHighRisk) {
    return 'unresolved_conflict';
  }

  if (options.conflictCount > 0 && options.overallConfidence >= 60) {
    return 'accepted_with_warning';
  }

  if (
    options.conflictCount === 0 &&
    options.warnings.length > 0
  ) {
    return 'accepted_with_warning';
  }

  if (
    options.conflictCount === 0 &&
    options.warnings.length === 0 &&
    options.overallConfidence >= 85
  ) {
    return 'auto_accepted';
  }

  return 'accepted_with_warning';
}

function collectUpstreamHighRiskWarnings(
  claudeWarnings: string[],
  openaiWarnings: string[],
): string[] {
  const collected: string[] = [];

  for (const warning of [...claudeWarnings, ...openaiWarnings]) {
    const lower = warning.toLowerCase();
    for (const field of HIGH_RISK_FIELDS) {
      if (lower.includes(field.replace(/_/g, ' ')) || lower.includes(field)) {
        collected.push(warning);
        break;
      }
    }
  }

  return collected;
}

export function scoreComparison(
  fieldComparisons: FieldComparison[],
  meta: ScoreComparisonMeta,
): ComparisonResult {
  const counts = {
    both_null: 0,
    exact_match: 0,
    normalized_match: 0,
    partial_match: 0,
    conflict: 0,
    claude_only: 0,
    openai_only: 0,
    invalid_evidence: 0,
  };

  let highRiskConflictCount = 0;

  for (const comparison of fieldComparisons) {
    if (comparison.agreement === 'both_null') {
      counts.both_null += 1;
      continue;
    }

    if (comparison.agreement === 'exact_match') counts.exact_match += 1;
    if (comparison.agreement === 'normalized_match') counts.normalized_match += 1;
    if (comparison.agreement === 'partial_match') counts.partial_match += 1;
    if (comparison.agreement === 'conflict') counts.conflict += 1;
    if (comparison.agreement === 'claude_only') counts.claude_only += 1;
    if (comparison.agreement === 'openai_only') counts.openai_only += 1;
    if (comparison.agreement === 'invalid_evidence') counts.invalid_evidence += 1;

    if (
      comparison.agreement === 'conflict' &&
      HIGH_RISK_FIELDS.has(comparison.field_name)
    ) {
      highRiskConflictCount += 1;
    }
  }

  const agreementItems = fieldComparisons
    .filter((comparison) => comparison.agreement !== 'both_null')
    .map((comparison) => ({
      score: comparison.agreement_score,
      weight: getFieldWeight(comparison.field_name),
    }));

  const evidenceItems = fieldComparisons
    .filter(hasNonNullValue)
    .map((comparison) => ({
      score: comparison.evidence_score,
      weight: getFieldWeight(comparison.field_name),
    }));

  const coverageFields = fieldComparisons.filter((comparison) =>
    isCoverageField(comparison.field_name),
  );
  const coveragePopulated = coverageFields.filter(hasNonNullValue).length;
  const coverageTotal = coverageFields.length;

  const valueAgreementScore = roundScore(
    weightedAverage(agreementItems) * 100,
  );
  const evidenceScore = roundScore(weightedAverage(evidenceItems) * 100);
  const coverageScore =
    coverageTotal === 0
      ? 0
      : roundScore((coveragePopulated / coverageTotal) * 100);

  let riskPenalty = 0;
  for (const comparison of fieldComparisons) {
    if (!HIGH_RISK_FIELDS.has(comparison.field_name)) continue;

    if (comparison.agreement === 'conflict') {
      riskPenalty += 10;
    } else if (
      comparison.agreement === 'claude_only' ||
      comparison.agreement === 'openai_only'
    ) {
      riskPenalty += 5;
    }
  }
  riskPenalty = Math.min(riskPenalty, 100);

  const overallComparisonConfidence = roundScore(
    Math.max(
      0,
      Math.min(
        100,
        valueAgreementScore * 0.5 +
          evidenceScore * 0.3 +
          coverageScore * 0.2 -
          riskPenalty * 0.25,
      ),
    ),
  );

  const reviewReasons = [
    ...new Set(
      fieldComparisons
        .map((comparison) => comparison.review_reason)
        .filter((reason): reason is string => reason !== null),
    ),
  ];

  const warnings: string[] = [];
  if (meta.claudeWasTruncated) {
    warnings.push('Claude scanner: document was truncated');
  }
  if (meta.openaiWasTruncated) {
    warnings.push('OpenAI scanner: document was truncated');
  }
  warnings.push(
    ...collectUpstreamHighRiskWarnings(meta.claudeWarnings, meta.openaiWarnings),
  );

  const reviewStatus = resolveReviewStatus({
    highRiskConflictCount,
    conflictCount: counts.conflict,
    overallConfidence: overallComparisonConfidence,
    coverageScore,
    warnings,
    fieldComparisons,
  });

  const manualReviewRequired = highRiskConflictCount > 0
    ? true
    : reviewStatus === 'manual_review_required' ||
      reviewStatus === 'unresolved_conflict';

  return {
    document_id: meta.documentId,
    bid_id: meta.bidId,
    claude_run_id: meta.claudeRunId,
    openai_run_id: meta.openaiRunId,
    comparison_version: meta.comparisonVersion || COMPARISON_VERSION,
    normalization_version: meta.normalizationVersion || NORMALIZATION_VERSION,
    field_comparisons: fieldComparisons,
    total_fields_compared: fieldComparisons.length,
    both_null_count: counts.both_null,
    exact_match_count: counts.exact_match,
    normalized_match_count: counts.normalized_match,
    partial_match_count: counts.partial_match,
    conflict_count: counts.conflict,
    claude_only_count: counts.claude_only,
    openai_only_count: counts.openai_only,
    invalid_evidence_count: counts.invalid_evidence,
    high_risk_conflict_count: highRiskConflictCount,
    value_agreement_score: valueAgreementScore,
    evidence_score: evidenceScore,
    coverage_score: coverageScore,
    risk_penalty: riskPenalty,
    overall_comparison_confidence: overallComparisonConfidence,
    review_status:
      highRiskConflictCount > 0 ? 'manual_review_required' : reviewStatus,
    manual_review_required: manualReviewRequired,
    review_reasons: reviewReasons,
    warnings,
    processed_at: new Date().toISOString(),
  };
}
