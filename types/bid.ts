import type {
  BidDbExtractionStatus,
  ComparisonResult,
  ExtractedBidFields,
} from "./extraction";

export type TextExtractionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type TextQuality = "good" | "medium" | "poor";

export type RiskSeverity = "low" | "medium" | "high";

export type RiskFlagSource = "claude" | "openai" | "comparison" | "manual";

export type SubtradeSource = "scraper" | "claude" | "openai" | "manual";

export type Bid = {
  id: string;
  scrape_run_id: string | null;
  source_name: string;
  source_id: string | null;
  source_url: string;
  title: string;
  description: string | null;
  agency: string | null;
  county: string | null;
  city: string | null;
  state: string;
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
  extraction_status: BidDbExtractionStatus;
  extraction_confidence: number | null;
  manual_review_required: boolean;
  comparison_result: ComparisonResult | null;
  final_extracted_fields: ExtractedBidFields | null;
  created_at: string;
  updated_at: string;
};

export type BidDocument = {
  id: string;
  bid_id: string;
  document_type: string;
  title: string | null;
  source_url: string | null;
  r2_bucket: string | null;
  r2_key: string | null;
  r2_url: string | null;
  file_name: string | null;
  content_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  page_count: number | null;
  text_extraction_status: TextExtractionStatus;
  extracted_text: string | null;
  text_quality: TextQuality | null;
  requires_ocr: boolean;
  extraction_error: string | null;
  downloaded_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BidRiskFlag = {
  id: string;
  bid_id: string;
  risk_type: string;
  severity: RiskSeverity;
  title: string;
  detail: string | null;
  source_excerpt: string | null;
  page_number: number | null;
  ai_source: RiskFlagSource | null;
  created_at: string;
};

export type BidSubtrade = {
  id: string;
  bid_id: string;
  trade: string;
  subtrade: string | null;
  source: SubtradeSource;
  created_at: string;
};
