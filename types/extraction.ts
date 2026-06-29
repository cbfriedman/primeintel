/** App-level extraction lifecycle status. */
export type ExtractionStatus = "pending" | "complete" | "failed" | "review";

/** App-level confidence bucket derived from numeric scores. */
export type ExtractionConfidence = "high" | "medium" | "low";

/** Stored on bids.extraction_status in Postgres. */
export type BidDbExtractionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "needs_review"
  | "failed";

export type AIProvider = "claude" | "openai";

export type AIExtractionRunStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed";

export type ManualReviewStatus =
  | "open"
  | "in_progress"
  | "approved"
  | "corrected"
  | "failed";

export type ManualReviewPriority = "low" | "normal" | "high";

export type FieldComparisonStatus =
  | "match"
  | "conflict"
  | "missing_claude"
  | "missing_openai"
  | "both_missing";

/** Fields returned by Claude or OpenAI. Use null when not found in the document. */
export type ExtractedBidFields = {
  title: string | null;
  description: string | null;
  agency: string | null;
  county: string | null;
  city: string | null;
  state: string | null;
  trade: string | null;
  project_location: string | null;
  bid_date: string | null;
  prebid_meeting_at: string | null;
  question_deadline_at: string | null;
  engineers_estimate_cents: number | null;
  license_requirements: string | null;
  dbe_goal_percent: number | null;
  bid_bond_percent: number | null;
  payment_bond_required: boolean | null;
  performance_bond_required: boolean | null;
  liquidated_damages: string | null;
  project_duration: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  risk_flags: ExtractedRiskFlag[];
  subtrades: ExtractedSubtrade[];
};

export type ExtractedRiskFlag = {
  risk_type: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string | null;
  source_excerpt: string | null;
  page_number: number | null;
};

export type ExtractedSubtrade = {
  trade: string;
  subtrade: string | null;
};

export type FieldComparison = {
  field: keyof ExtractedBidFields | string;
  status: FieldComparisonStatus;
  claude_value: unknown;
  openai_value: unknown;
  is_critical: boolean;
};

export type ComparisonResult = {
  overall_confidence: number | null;
  confidence_level: ExtractionConfidence | null;
  requires_manual_review: boolean;
  review_reasons: string[];
  field_comparisons: FieldComparison[];
};

export type ValidationError = {
  path: string;
  message: string;
};

export type AIExtractionRun = {
  id: string;
  bid_id: string;
  document_id: string | null;
  provider: AIProvider;
  model: string | null;
  status: AIExtractionRunStatus;
  prompt_version: string | null;
  source_text_hash: string | null;
  raw_response: Record<string, unknown> | null;
  parsed_output: ExtractedBidFields | null;
  validation_errors: ValidationError[] | null;
  confidence: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ManualReview = {
  id: string;
  bid_id: string;
  comparison_id: string | null;
  assigned_to_user_id: string | null;
  status: ManualReviewStatus;
  priority: ManualReviewPriority;
  reason: string | null;
  claude_extraction_run_id: string | null;
  openai_extraction_run_id: string | null;
  comparison_result: ComparisonResult | null;
  corrected_fields: Partial<ExtractedBidFields> | null;
  reviewer_notes: string | null;
  resolved_by_user_id: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
};

export const CRITICAL_EXTRACTION_FIELDS = [
  "engineers_estimate_cents",
  "liquidated_damages",
  "project_duration",
  "bid_bond_percent",
  "dbe_goal_percent",
  "license_requirements",
  "bid_date",
] as const satisfies readonly (keyof ExtractedBidFields)[];

export type CriticalExtractionField = (typeof CRITICAL_EXTRACTION_FIELDS)[number];

export function toExtractionStatus(
  dbStatus: BidDbExtractionStatus,
): ExtractionStatus {
  switch (dbStatus) {
    case "pending":
    case "processing":
      return "pending";
    case "completed":
      return "complete";
    case "needs_review":
      return "review";
    case "failed":
      return "failed";
  }
}

export function toExtractionConfidence(
  score: number | null,
): ExtractionConfidence | null {
  if (score === null) {
    return null;
  }

  if (score >= 80) {
    return "high";
  }

  if (score >= 50) {
    return "medium";
  }

  return "low";
}
