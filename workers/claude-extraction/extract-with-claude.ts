import { z } from 'zod';

import {
  claudeExtractedFieldsSchema,
  type ClaudeExtractedFields,
  type ClaudeExtractionRunOutput,
} from './schema';
import { getExtractionConfig } from './extraction-config';
import { buildUserPrompt } from './prompt';
import { callClaudeExtraction } from './claude-client';
import { validatePageEvidence } from './validate-page-evidence';

// ── Input ─────────────────────────────────────────────────────────

export type ClaudeExtractionInput = {
  documentId: string;
  bidId: string;
  bidTitle: string;
  bidAgency: string | null;
  bidSourceUrl: string;
  priorityText: string;
  pagesIncluded: number[];
  wasTruncated: boolean;
  maxPageCount: number | null;
};

// ── Result returned to the orchestration layer ────────────────────

export type ExtractWithClaudeResult = {
  output: ClaudeExtractionRunOutput;
  rawResponse: Record<string, unknown>;
  usage: { input_tokens: number; output_tokens: number };
};

// ── Errors ────────────────────────────────────────────────────────

export class ExtractionValidationError extends Error {
  constructor(
    public readonly validationErrors: z.ZodError,
    public readonly rawInput: unknown,
  ) {
    super(
      `Extraction response failed Zod validation: ${validationErrors.issues[0]?.message ?? 'unknown'}`,
    );
    this.name = 'ExtractionValidationError';
  }
}

// ── Confidence scoring ────────────────────────────────────────────

const CRITICAL_FIELD_NAMES = new Set<string>([
  'engineers_estimate_cents',
  'liquidated_damages',
  'working_days',
  'calendar_days',
  'bid_bond',
  'dbe_goal_percent',
  'license_requirements',
  'bid_date',
]);

type FieldKey = keyof Omit<ClaudeExtractedFields, 'risk_flags'>;

const EVIDENCE_FIELDS: FieldKey[] = [
  'title', 'agency', 'county', 'city', 'contract_number', 'project_number',
  'federal_project_number', 'source_bid_number',
  'bid_date', 'bid_time', 'pre_bid_meeting_date', 'pre_bid_meeting_time',
  'question_deadline', 'anticipated_start_date', 'completion_date',
  'engineers_estimate_cents', 'estimated_cost_min_cents', 'estimated_cost_max_cents',
  'bid_bond', 'performance_bond', 'payment_bond', 'retention', 'liquidated_damages',
  'working_days', 'calendar_days', 'contract_duration', 'night_work_required',
  'license_requirements', 'license_classifications', 'prevailing_wage_required',
  'insurance_requirements', 'subcontracting_limitations', 'subcontractor_listing_requirements',
  'dbe_goal_percent', 'dbe_requirements', 'dvbe_percentage',
  'small_business_requirements', 'disadvantaged_business_requirements',
  'hazardous_materials', 'environmental_requirements', 'traffic_control_requirements',
  'utility_conflicts', 'permits_required', 'special_equipment',
  'contact_name', 'contact_title', 'contact_email', 'contact_phone', 'contact_department',
  'addenda_mentioned', 'addenda_count', 'mandatory_forms', 'required_certifications',
  'summary', 'scope_of_work', 'key_requirements', 'key_deadlines',
];

function computeOverallConfidence(fields: ClaudeExtractedFields): number {
  let weightedSum = 0;
  let totalWeight = 0;

  for (const key of EVIDENCE_FIELDS) {
    const field = fields[key];
    if (field === null) continue;

    const weight = CRITICAL_FIELD_NAMES.has(key) ? 2 : 1;
    weightedSum += field.confidence * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;

  return Math.round((weightedSum / totalWeight) * 10000) / 100;
}

// ── Main extraction function ──────────────────────────────────────

export async function extractWithClaude(
  input: ClaudeExtractionInput,
): Promise<ExtractWithClaudeResult> {
  const config = getExtractionConfig();

  const userPrompt = buildUserPrompt({
    bidTitle: input.bidTitle,
    bidAgency: input.bidAgency,
    bidSourceUrl: input.bidSourceUrl,
    pagesIncluded: input.pagesIncluded,
    wasTruncated: input.wasTruncated,
    priorityText: input.priorityText,
  });

  const { toolInput, usage } = await callClaudeExtraction(userPrompt);

  // Zod structural validation
  const parseResult = claudeExtractedFieldsSchema.safeParse(toolInput);
  if (!parseResult.success) {
    throw new ExtractionValidationError(parseResult.error, toolInput);
  }

  // Page-number range validation (lenient: nulls bad references, adds warnings)
  const { fields, warnings: evidenceWarnings } = validatePageEvidence(
    parseResult.data,
    input.maxPageCount,
  );

  const overallConfidence = computeOverallConfidence(fields);

  const warnings: string[] = [...evidenceWarnings];
  if (input.wasTruncated) {
    warnings.push('Document was truncated; some pages may not have been included.');
  }
  if (overallConfidence < 30) {
    warnings.push(
      `Low overall confidence (${overallConfidence.toFixed(1)}); manual review recommended.`,
    );
  }

  const output: ClaudeExtractionRunOutput = {
    schema_version: config.schemaVersion,
    prompt_version: config.promptVersion,
    fields,
    overall_confidence: overallConfidence,
    warnings,
    pages_included: input.pagesIncluded,
    was_truncated: input.wasTruncated,
    processed_at: new Date().toISOString(),
  };

  return { output, rawResponse: toolInput, usage };
}
