import { z } from 'zod';

// Default versions — overridden at runtime by extraction-config.ts / env vars.
export const PROMPT_VERSION = 'claude-extraction-v2';
export const SCHEMA_VERSION = 'extraction-schema-v2';
export const EXTRACTION_TOOL_NAME = 'extract_bid_fields';

// ── Field evidence ────────────────────────────────────────────────

export type FieldEvidence<T> = {
  value: T;
  confidence: number;       // 0–1
  pageNumbers: number[];    // 1-based page numbers from the document
  sourceExcerpt: string | null; // verbatim quote ≤ 400 chars, or null
} | null;

// ── Zod helpers ───────────────────────────────────────────────────

const fe = <T extends z.ZodTypeAny>(valueSchema: T) =>
  z.object({
    value: valueSchema,
    confidence: z.number().min(0).max(1),
    pageNumbers: z.array(z.number().int().min(1)).min(1),
    sourceExcerpt: z.string().min(1).max(400).nullable(),
  }).nullable();

const riskFlagSchema = z.object({
  risk_type:     z.string().min(1),
  severity:      z.enum(['low', 'medium', 'high']),
  title:         z.string().min(1),
  detail:        z.string().nullable(),
  source_excerpt:z.string().max(400).nullable(),
  page_number:   z.number().int().min(1).nullable(),
});

// ── Full extraction schema ────────────────────────────────────────

export const claudeExtractedFieldsSchema = z.object({
  // Project identity
  title:                              fe(z.string()),
  agency:                             fe(z.string()),
  county:                             fe(z.string()),
  city:                               fe(z.string()),
  contract_number:                    fe(z.string()),
  project_number:                     fe(z.string()),
  federal_project_number:             fe(z.string()),
  source_bid_number:                  fe(z.string()),

  // Dates and deadlines
  bid_date:                           fe(z.string()),
  bid_time:                           fe(z.string()),
  pre_bid_meeting_date:               fe(z.string()),
  pre_bid_meeting_time:               fe(z.string()),
  question_deadline:                  fe(z.string()),
  anticipated_start_date:             fe(z.string()),
  completion_date:                    fe(z.string()),

  // Financial
  engineers_estimate_cents:           fe(z.number().int().nonnegative()),
  estimated_cost_min_cents:           fe(z.number().int().nonnegative()),
  estimated_cost_max_cents:           fe(z.number().int().nonnegative()),
  bid_bond:                           fe(z.string()),
  performance_bond:                   fe(z.string()),
  payment_bond:                       fe(z.string()),
  retention:                          fe(z.string()),
  liquidated_damages:                 fe(z.string()),

  // Schedule
  working_days:                       fe(z.number().int().positive()),
  calendar_days:                      fe(z.number().int().positive()),
  contract_duration:                  fe(z.string()),
  night_work_required:                fe(z.boolean()),

  // Contractor requirements
  license_requirements:               fe(z.string()),
  license_classifications:            fe(z.array(z.string().min(1))),
  prevailing_wage_required:           fe(z.boolean()),
  insurance_requirements:             fe(z.string()),
  subcontracting_limitations:         fe(z.string()),
  subcontractor_listing_requirements: fe(z.string()),

  // Participation requirements
  dbe_goal_percent:                   fe(z.number().min(0).max(100)),
  dbe_requirements:                   fe(z.string()),
  dvbe_percentage:                    fe(z.number().min(0).max(100)),
  small_business_requirements:        fe(z.string()),
  disadvantaged_business_requirements:fe(z.string()),

  // Technical and risk
  hazardous_materials:                fe(z.string()),
  environmental_requirements:         fe(z.string()),
  traffic_control_requirements:       fe(z.string()),
  utility_conflicts:                  fe(z.string()),
  permits_required:                   fe(z.string()),
  special_equipment:                  fe(z.string()),

  // Contact
  contact_name:                       fe(z.string()),
  contact_title:                      fe(z.string()),
  contact_email:                      fe(z.string()),
  contact_phone:                      fe(z.string()),
  contact_department:                 fe(z.string()),

  // Document information
  addenda_mentioned:                  fe(z.array(z.string().min(1))),
  addenda_count:                      fe(z.number().int().nonnegative()),
  mandatory_forms:                    fe(z.array(z.string().min(1))),
  required_certifications:            fe(z.array(z.string().min(1))),

  // Summary
  summary:                            fe(z.string().max(1000)),
  scope_of_work:                      fe(z.string().max(2000)),
  key_requirements:                   fe(z.array(z.string().min(1))),
  key_deadlines:                      fe(z.array(z.string().min(1))),

  // Risk flags (evidence is inline per flag, not wrapped)
  risk_flags:                         z.array(riskFlagSchema),
});

export type ClaudeExtractedFields = z.infer<typeof claudeExtractedFieldsSchema>;
export type ClaudeExtractedRiskFlag = z.infer<typeof riskFlagSchema>;

// ── Run output (stored in ai_extraction_runs.parsed_output) ───────

export type ClaudeExtractionRunOutput = {
  schema_version: string;
  prompt_version: string;
  fields: ClaudeExtractedFields;
  overall_confidence: number; // 0–100 stored as numeric(5,2)
  warnings: string[];
  pages_included: number[];
  was_truncated: boolean;
  processed_at: string;
};

// ── JSON Schema for Claude tool definition ────────────────────────

function feJsonSchema(valueSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    oneOf: [
      { type: 'null' },
      {
        type: 'object',
        properties: {
          value: valueSchema,
          confidence:    { type: 'number', minimum: 0, maximum: 1 },
          pageNumbers:   { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 },
          sourceExcerpt: { oneOf: [{ type: 'null' }, { type: 'string', maxLength: 400 }] },
        },
        required: ['value', 'confidence', 'pageNumbers', 'sourceExcerpt'],
        additionalProperties: false,
      },
    ],
  };
}

function nullableStr(): Record<string, unknown> {
  return { oneOf: [{ type: 'null' }, { type: 'string' }] };
}

function nullableInt(): Record<string, unknown> {
  return { oneOf: [{ type: 'null' }, { type: 'integer', minimum: 1 }] };
}

const ALL_REQUIRED_FIELDS = [
  // Project identity
  'title', 'agency', 'county', 'city', 'contract_number', 'project_number',
  'federal_project_number', 'source_bid_number',
  // Dates
  'bid_date', 'bid_time', 'pre_bid_meeting_date', 'pre_bid_meeting_time',
  'question_deadline', 'anticipated_start_date', 'completion_date',
  // Financial
  'engineers_estimate_cents', 'estimated_cost_min_cents', 'estimated_cost_max_cents',
  'bid_bond', 'performance_bond', 'payment_bond', 'retention', 'liquidated_damages',
  // Schedule
  'working_days', 'calendar_days', 'contract_duration', 'night_work_required',
  // Contractor
  'license_requirements', 'license_classifications', 'prevailing_wage_required',
  'insurance_requirements', 'subcontracting_limitations', 'subcontractor_listing_requirements',
  // Participation
  'dbe_goal_percent', 'dbe_requirements', 'dvbe_percentage',
  'small_business_requirements', 'disadvantaged_business_requirements',
  // Technical
  'hazardous_materials', 'environmental_requirements', 'traffic_control_requirements',
  'utility_conflicts', 'permits_required', 'special_equipment',
  // Contact
  'contact_name', 'contact_title', 'contact_email', 'contact_phone', 'contact_department',
  // Document
  'addenda_mentioned', 'addenda_count', 'mandatory_forms', 'required_certifications',
  // Summary
  'summary', 'scope_of_work', 'key_requirements', 'key_deadlines',
  // Risk
  'risk_flags',
] as const;

export const EXTRACTION_TOOL_INPUT_SCHEMA: {
  type: 'object';
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
} = {
  type: 'object',
  properties: {
    // Project identity
    title:                              feJsonSchema({ type: 'string' }),
    agency:                             feJsonSchema({ type: 'string' }),
    county:                             feJsonSchema({ type: 'string' }),
    city:                               feJsonSchema({ type: 'string' }),
    contract_number:                    feJsonSchema({ type: 'string' }),
    project_number:                     feJsonSchema({ type: 'string' }),
    federal_project_number:             feJsonSchema({ type: 'string' }),
    source_bid_number:                  feJsonSchema({ type: 'string' }),

    // Dates
    bid_date:                           feJsonSchema({ type: 'string', description: 'ISO 8601: YYYY-MM-DD' }),
    bid_time:                           feJsonSchema({ type: 'string', description: 'e.g. "2:00 PM"' }),
    pre_bid_meeting_date:               feJsonSchema({ type: 'string', description: 'ISO 8601: YYYY-MM-DD' }),
    pre_bid_meeting_time:               feJsonSchema({ type: 'string' }),
    question_deadline:                  feJsonSchema({ type: 'string', description: 'ISO 8601: YYYY-MM-DD, or ISO datetime' }),
    anticipated_start_date:             feJsonSchema({ type: 'string', description: 'ISO 8601: YYYY-MM-DD' }),
    completion_date:                    feJsonSchema({ type: 'string', description: 'ISO 8601: YYYY-MM-DD' }),

    // Financial
    engineers_estimate_cents:           feJsonSchema({ type: 'integer', minimum: 0, description: 'Dollar amount in whole cents. $1,500,000 = 150000000' }),
    estimated_cost_min_cents:           feJsonSchema({ type: 'integer', minimum: 0 }),
    estimated_cost_max_cents:           feJsonSchema({ type: 'integer', minimum: 0 }),
    bid_bond:                           feJsonSchema({ type: 'string', description: 'Exact text: e.g. "10% of bid amount" or "$50,000"' }),
    performance_bond:                   feJsonSchema({ type: 'string', description: 'Exact text as stated in document' }),
    payment_bond:                       feJsonSchema({ type: 'string', description: 'Exact text as stated in document' }),
    retention:                          feJsonSchema({ type: 'string', description: 'Exact text: e.g. "5% of contract value"' }),
    liquidated_damages:                 feJsonSchema({ type: 'string', description: 'Full text: e.g. "$5,000 per calendar day"' }),

    // Schedule
    working_days:                       feJsonSchema({ type: 'integer', minimum: 1, description: 'Working days only — do not use when calendar days are specified' }),
    calendar_days:                      feJsonSchema({ type: 'integer', minimum: 1, description: 'Calendar days only — do not use when working days are specified' }),
    contract_duration:                  feJsonSchema({ type: 'string', description: 'Free text when exact day type is ambiguous' }),
    night_work_required:                feJsonSchema({ type: 'boolean', description: 'true only if the document explicitly requires night or off-hours work' }),

    // Contractor requirements
    license_requirements:               feJsonSchema({ type: 'string', description: 'Full license requirement text' }),
    license_classifications:            feJsonSchema({ type: 'array', items: { type: 'string' }, description: 'Individual classifications e.g. ["A", "C-10"]' }),
    prevailing_wage_required:           feJsonSchema({ type: 'boolean', description: 'true only if prevailing wage is explicitly stated as required' }),
    insurance_requirements:             feJsonSchema({ type: 'string' }),
    subcontracting_limitations:         feJsonSchema({ type: 'string' }),
    subcontractor_listing_requirements: feJsonSchema({ type: 'string' }),

    // Participation requirements
    dbe_goal_percent:                   feJsonSchema({ type: 'number', minimum: 0, maximum: 100, description: 'Numeric percent, e.g. 14.5 for 14.5%' }),
    dbe_requirements:                   feJsonSchema({ type: 'string', description: 'Full DBE/SBE requirement text' }),
    dvbe_percentage:                    feJsonSchema({ type: 'number', minimum: 0, maximum: 100 }),
    small_business_requirements:        feJsonSchema({ type: 'string' }),
    disadvantaged_business_requirements:feJsonSchema({ type: 'string' }),

    // Technical
    hazardous_materials:                feJsonSchema({ type: 'string' }),
    environmental_requirements:         feJsonSchema({ type: 'string' }),
    traffic_control_requirements:       feJsonSchema({ type: 'string' }),
    utility_conflicts:                  feJsonSchema({ type: 'string' }),
    permits_required:                   feJsonSchema({ type: 'string' }),
    special_equipment:                  feJsonSchema({ type: 'string' }),

    // Contact
    contact_name:                       feJsonSchema({ type: 'string' }),
    contact_title:                      feJsonSchema({ type: 'string' }),
    contact_email:                      feJsonSchema({ type: 'string' }),
    contact_phone:                      feJsonSchema({ type: 'string' }),
    contact_department:                 feJsonSchema({ type: 'string' }),

    // Document information
    addenda_mentioned:                  feJsonSchema({ type: 'array', items: { type: 'string' } }),
    addenda_count:                      feJsonSchema({ type: 'integer', minimum: 0 }),
    mandatory_forms:                    feJsonSchema({ type: 'array', items: { type: 'string' } }),
    required_certifications:            feJsonSchema({ type: 'array', items: { type: 'string' } }),

    // Summary
    summary:                            feJsonSchema({ type: 'string', maxLength: 1000, description: '2–4 sentence project summary' }),
    scope_of_work:                      feJsonSchema({ type: 'string', maxLength: 2000, description: 'Verbatim or close-paraphrase scope text from the document' }),
    key_requirements:                   feJsonSchema({ type: 'array', items: { type: 'string' }, description: 'Short bullet strings, 5–15 words each' }),
    key_deadlines:                      feJsonSchema({ type: 'array', items: { type: 'string' }, description: 'Short deadline strings, e.g. "Bid date: 2025-08-15 2:00 PM"' }),

    // Risk flags
    risk_flags: {
      type: 'array',
      description: 'Include only explicit risk conditions in the document. Empty array if none.',
      items: {
        type: 'object',
        properties: {
          risk_type:     { type: 'string' },
          severity:      { type: 'string', enum: ['low', 'medium', 'high'] },
          title:         { type: 'string' },
          detail:        nullableStr(),
          source_excerpt:nullableStr(),
          page_number:   nullableInt(),
        },
        required: ['risk_type', 'severity', 'title', 'detail', 'source_excerpt', 'page_number'],
        additionalProperties: false,
      },
    },
  },
  required: [...ALL_REQUIRED_FIELDS],
  additionalProperties: false,
};

// ── Provider-neutral aliases (used by OpenAI scanner) ─────────────

export const extractedFieldsSchema = claudeExtractedFieldsSchema;
export type ExtractedFields = ClaudeExtractedFields;

// ── JSON Schema for OpenAI Responses API (strict mode, anyOf not oneOf) ──

function feJsonSchemaOpenAI(valueSchema: Record<string, unknown>): Record<string, unknown> {
  return {
    anyOf: [
      { type: 'null' },
      {
        type: 'object',
        properties: {
          value: valueSchema,
          confidence:    { type: 'number', minimum: 0, maximum: 1 },
          pageNumbers:   { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 },
          sourceExcerpt: { anyOf: [{ type: 'null' }, { type: 'string', maxLength: 400 }] },
        },
        required: ['value', 'confidence', 'pageNumbers', 'sourceExcerpt'],
        additionalProperties: false,
      },
    ],
  };
}

function nullableStrOpenAI(): Record<string, unknown> {
  return { anyOf: [{ type: 'null' }, { type: 'string' }] };
}

function nullableIntOpenAI(): Record<string, unknown> {
  return { anyOf: [{ type: 'null' }, { type: 'integer', minimum: 1 }] };
}

export const OPENAI_EXTRACTION_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    title:                              feJsonSchemaOpenAI({ type: 'string' }),
    agency:                             feJsonSchemaOpenAI({ type: 'string' }),
    county:                             feJsonSchemaOpenAI({ type: 'string' }),
    city:                               feJsonSchemaOpenAI({ type: 'string' }),
    contract_number:                    feJsonSchemaOpenAI({ type: 'string' }),
    project_number:                     feJsonSchemaOpenAI({ type: 'string' }),
    federal_project_number:             feJsonSchemaOpenAI({ type: 'string' }),
    source_bid_number:                  feJsonSchemaOpenAI({ type: 'string' }),
    bid_date:                           feJsonSchemaOpenAI({ type: 'string' }),
    bid_time:                           feJsonSchemaOpenAI({ type: 'string' }),
    pre_bid_meeting_date:               feJsonSchemaOpenAI({ type: 'string' }),
    pre_bid_meeting_time:               feJsonSchemaOpenAI({ type: 'string' }),
    question_deadline:                  feJsonSchemaOpenAI({ type: 'string' }),
    anticipated_start_date:             feJsonSchemaOpenAI({ type: 'string' }),
    completion_date:                    feJsonSchemaOpenAI({ type: 'string' }),
    engineers_estimate_cents:           feJsonSchemaOpenAI({ type: 'integer', minimum: 0 }),
    estimated_cost_min_cents:           feJsonSchemaOpenAI({ type: 'integer', minimum: 0 }),
    estimated_cost_max_cents:           feJsonSchemaOpenAI({ type: 'integer', minimum: 0 }),
    bid_bond:                           feJsonSchemaOpenAI({ type: 'string' }),
    performance_bond:                   feJsonSchemaOpenAI({ type: 'string' }),
    payment_bond:                       feJsonSchemaOpenAI({ type: 'string' }),
    retention:                          feJsonSchemaOpenAI({ type: 'string' }),
    liquidated_damages:                 feJsonSchemaOpenAI({ type: 'string' }),
    working_days:                       feJsonSchemaOpenAI({ type: 'integer', minimum: 1 }),
    calendar_days:                      feJsonSchemaOpenAI({ type: 'integer', minimum: 1 }),
    contract_duration:                  feJsonSchemaOpenAI({ type: 'string' }),
    night_work_required:                feJsonSchemaOpenAI({ type: 'boolean' }),
    license_requirements:               feJsonSchemaOpenAI({ type: 'string' }),
    license_classifications:            feJsonSchemaOpenAI({ type: 'array', items: { type: 'string' } }),
    prevailing_wage_required:           feJsonSchemaOpenAI({ type: 'boolean' }),
    insurance_requirements:             feJsonSchemaOpenAI({ type: 'string' }),
    subcontracting_limitations:         feJsonSchemaOpenAI({ type: 'string' }),
    subcontractor_listing_requirements: feJsonSchemaOpenAI({ type: 'string' }),
    dbe_goal_percent:                   feJsonSchemaOpenAI({ type: 'number', minimum: 0, maximum: 100 }),
    dbe_requirements:                   feJsonSchemaOpenAI({ type: 'string' }),
    dvbe_percentage:                    feJsonSchemaOpenAI({ type: 'number', minimum: 0, maximum: 100 }),
    small_business_requirements:        feJsonSchemaOpenAI({ type: 'string' }),
    disadvantaged_business_requirements:feJsonSchemaOpenAI({ type: 'string' }),
    hazardous_materials:                feJsonSchemaOpenAI({ type: 'string' }),
    environmental_requirements:         feJsonSchemaOpenAI({ type: 'string' }),
    traffic_control_requirements:       feJsonSchemaOpenAI({ type: 'string' }),
    utility_conflicts:                  feJsonSchemaOpenAI({ type: 'string' }),
    permits_required:                   feJsonSchemaOpenAI({ type: 'string' }),
    special_equipment:                  feJsonSchemaOpenAI({ type: 'string' }),
    contact_name:                       feJsonSchemaOpenAI({ type: 'string' }),
    contact_title:                      feJsonSchemaOpenAI({ type: 'string' }),
    contact_email:                      feJsonSchemaOpenAI({ type: 'string' }),
    contact_phone:                      feJsonSchemaOpenAI({ type: 'string' }),
    contact_department:                 feJsonSchemaOpenAI({ type: 'string' }),
    addenda_mentioned:                  feJsonSchemaOpenAI({ type: 'array', items: { type: 'string' } }),
    addenda_count:                      feJsonSchemaOpenAI({ type: 'integer', minimum: 0 }),
    mandatory_forms:                    feJsonSchemaOpenAI({ type: 'array', items: { type: 'string' } }),
    required_certifications:            feJsonSchemaOpenAI({ type: 'array', items: { type: 'string' } }),
    summary:                            feJsonSchemaOpenAI({ type: 'string' }),
    scope_of_work:                      feJsonSchemaOpenAI({ type: 'string' }),
    key_requirements:                   feJsonSchemaOpenAI({ type: 'array', items: { type: 'string' } }),
    key_deadlines:                      feJsonSchemaOpenAI({ type: 'array', items: { type: 'string' } }),
    risk_flags: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          risk_type:      { type: 'string' },
          severity:       { type: 'string', enum: ['low', 'medium', 'high'] },
          title:          { type: 'string' },
          detail:         nullableStrOpenAI(),
          source_excerpt: nullableStrOpenAI(),
          page_number:    nullableIntOpenAI(),
        },
        required: ['risk_type', 'severity', 'title', 'detail', 'source_excerpt', 'page_number'],
        additionalProperties: false,
      },
    },
  },
  required: [
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
    'risk_flags',
  ],
  additionalProperties: false,
};
