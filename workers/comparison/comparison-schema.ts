import { z } from 'zod';

export const COMPARISON_VERSION = 'comparison-v1';
export const NORMALIZATION_VERSION = 'normalization-v1';
export const STALE_THRESHOLD_MINUTES = 10;

export const HIGH_RISK_FIELDS = new Set([
  'bid_date',
  'question_deadline',
  'engineers_estimate_cents',
  'license_requirements',
  'license_classifications',
  'working_days',
  'calendar_days',
  'liquidated_damages',
  'bid_bond',
  'performance_bond',
  'payment_bond',
  'dbe_goal_percent',
  'dvbe_percentage',
  'insurance_requirements',
  'hazardous_materials',
  'prevailing_wage_required',
]);

export const MEDIUM_RISK_FIELDS = new Set([
  'agency',
  'county',
  'title',
  'contract_number',
  'project_number',
  'estimated_cost_min_cents',
  'estimated_cost_max_cents',
  'retention',
  'dbe_requirements',
  'night_work_required',
  'subcontracting_limitations',
  'subcontractor_listing_requirements',
]);

export const NOT_COMPARABLE_FIELDS = new Set([
  'summary',
  'scope_of_work',
  'key_requirements',
  'key_deadlines',
  'insurance_requirements',
  'subcontracting_limitations',
  'subcontractor_listing_requirements',
  'dbe_requirements',
  'small_business_requirements',
  'disadvantaged_business_requirements',
  'environmental_requirements',
  'traffic_control_requirements',
  'utility_conflicts',
  'permits_required',
  'special_equipment',
  'hazardous_materials',
]);

export const agreementClassificationSchema = z.enum([
  'both_null',
  'exact_match',
  'normalized_match',
  'partial_match',
  'conflict',
  'claude_only',
  'openai_only',
  'invalid_evidence',
  'not_comparable',
]);

export const reviewStatusSchema = z.enum([
  'auto_accepted',
  'accepted_with_warning',
  'manual_review_required',
  'unresolved_conflict',
  'insufficient_evidence',
]);

export const fieldComparisonSchema = z.object({
  field_name: z.string(),
  claude_value: z.unknown(),
  claude_confidence: z.number().min(0).max(1).nullable(),
  claude_page_numbers: z.array(z.number().int().min(1)).nullable(),
  claude_source_excerpt: z.string().nullable(),
  openai_value: z.unknown(),
  openai_confidence: z.number().min(0).max(1).nullable(),
  openai_page_numbers: z.array(z.number().int().min(1)).nullable(),
  openai_source_excerpt: z.string().nullable(),
  claude_normalized: z.unknown(),
  openai_normalized: z.unknown(),
  agreement: agreementClassificationSchema,
  agreement_score: z.number().min(0).max(1),
  evidence_score: z.number().min(0).max(1),
  risk_level: z.enum(['low', 'medium', 'high', 'critical']),
  review_required: z.boolean(),
  review_reason: z.string().nullable(),
  proposed_value: z.unknown(),
  proposed_value_source: z.enum(['both', 'claude', 'openai', 'none']).nullable(),
});

export const comparisonResultSchema = z.object({
  document_id: z.string().uuid(),
  bid_id: z.string().uuid(),
  claude_run_id: z.string().uuid(),
  openai_run_id: z.string().uuid(),
  comparison_version: z.string(),
  normalization_version: z.string(),
  field_comparisons: z.array(fieldComparisonSchema),
  total_fields_compared: z.number().int().nonnegative(),
  both_null_count: z.number().int().nonnegative(),
  exact_match_count: z.number().int().nonnegative(),
  normalized_match_count: z.number().int().nonnegative(),
  partial_match_count: z.number().int().nonnegative(),
  conflict_count: z.number().int().nonnegative(),
  claude_only_count: z.number().int().nonnegative(),
  openai_only_count: z.number().int().nonnegative(),
  invalid_evidence_count: z.number().int().nonnegative(),
  high_risk_conflict_count: z.number().int().nonnegative(),
  value_agreement_score: z.number().min(0).max(100),
  evidence_score: z.number().min(0).max(100),
  coverage_score: z.number().min(0).max(100),
  risk_penalty: z.number().min(0).max(100),
  overall_comparison_confidence: z.number().min(0).max(100),
  review_status: reviewStatusSchema,
  manual_review_required: z.boolean(),
  review_reasons: z.array(z.string()),
  warnings: z.array(z.string()),
  processed_at: z.string().datetime(),
});

export type FieldComparison = z.infer<typeof fieldComparisonSchema>;
export type ComparisonResult = z.infer<typeof comparisonResultSchema>;
export type AgreementClassification = z.infer<typeof agreementClassificationSchema>;
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

export function getFieldWeight(fieldName: string): number {
  if (HIGH_RISK_FIELDS.has(fieldName)) return 3;
  if (MEDIUM_RISK_FIELDS.has(fieldName)) return 2;
  return 1;
}

export function getRiskLevel(
  fieldName: string,
  agreement: AgreementClassification,
): 'low' | 'medium' | 'high' | 'critical' {
  if (HIGH_RISK_FIELDS.has(fieldName)) {
    return agreement === 'conflict' ? 'critical' : 'high';
  }
  if (MEDIUM_RISK_FIELDS.has(fieldName)) {
    return agreement === 'conflict' ? 'medium' : 'low';
  }
  return 'low';
}

export function getAgreementScore(agreement: AgreementClassification): number {
  switch (agreement) {
    case 'exact_match':
      return 1.0;
    case 'normalized_match':
      return 0.95;
    case 'partial_match':
      return 0.6;
    case 'conflict':
      return 0.0;
    case 'claude_only':
    case 'openai_only':
      return 0.4;
    case 'not_comparable':
      return 0.5;
    case 'invalid_evidence':
      return 0.2;
    case 'both_null':
      return 0;
  }
}

export function getProposedValue(
  agreement: AgreementClassification,
  claudeValue: unknown,
  openaiValue: unknown,
): { proposed_value: unknown; proposed_value_source: 'both' | 'claude' | 'openai' | 'none' | null } {
  switch (agreement) {
    case 'exact_match':
    case 'normalized_match':
    case 'partial_match':
      return { proposed_value: claudeValue, proposed_value_source: 'both' };
    case 'claude_only':
      return { proposed_value: claudeValue, proposed_value_source: 'claude' };
    case 'openai_only':
      return { proposed_value: openaiValue, proposed_value_source: 'openai' };
    default:
      return { proposed_value: null, proposed_value_source: 'none' };
  }
}
