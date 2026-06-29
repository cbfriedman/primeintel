import type {
  ClaudeExtractedFields,
  ClaudeExtractedRiskFlag,
} from '../claude-extraction/schema';

import { assessEvidence, type EvidenceField } from './compare-evidence';
import type {
  AgreementClassification,
  FieldComparison,
} from './comparison-schema';
import {
  getAgreementScore,
  getProposedValue,
  getRiskLevel,
  HIGH_RISK_FIELDS,
  NOT_COMPARABLE_FIELDS,
} from './comparison-schema';
import {
  detectCentsMismatch,
  normalizeCents,
  normalizeDate,
  normalizeEmail,
  normalizeLicenseClassification,
  normalizeList,
  normalizePhone,
  normalizeText,
  normalizeTime,
} from './normalizers';

type FieldKey = keyof Omit<ClaudeExtractedFields, 'risk_flags'>;

const INTEGER_FIELDS = new Set<FieldKey>([
  'engineers_estimate_cents',
  'estimated_cost_min_cents',
  'estimated_cost_max_cents',
  'working_days',
  'calendar_days',
  'addenda_count',
]);

const PERCENT_FIELDS = new Set<FieldKey>(['dbe_goal_percent', 'dvbe_percentage']);

const BOOLEAN_FIELDS = new Set<FieldKey>([
  'night_work_required',
  'prevailing_wage_required',
]);

const DATE_FIELDS = new Set<FieldKey>([
  'bid_date',
  'pre_bid_meeting_date',
  'question_deadline',
  'anticipated_start_date',
  'completion_date',
]);

const TIME_FIELDS = new Set<FieldKey>(['bid_time', 'pre_bid_meeting_time']);

const LIST_FIELDS = new Set<FieldKey>([
  'license_classifications',
  'addenda_mentioned',
  'mandatory_forms',
  'required_certifications',
]);

const EVIDENCE_FIELD_KEYS = Object.keys({
  title: true,
  agency: true,
  county: true,
  city: true,
  contract_number: true,
  project_number: true,
  federal_project_number: true,
  source_bid_number: true,
  bid_date: true,
  bid_time: true,
  pre_bid_meeting_date: true,
  pre_bid_meeting_time: true,
  question_deadline: true,
  anticipated_start_date: true,
  completion_date: true,
  engineers_estimate_cents: true,
  estimated_cost_min_cents: true,
  estimated_cost_max_cents: true,
  bid_bond: true,
  performance_bond: true,
  payment_bond: true,
  retention: true,
  liquidated_damages: true,
  working_days: true,
  calendar_days: true,
  contract_duration: true,
  night_work_required: true,
  license_requirements: true,
  license_classifications: true,
  prevailing_wage_required: true,
  insurance_requirements: true,
  subcontracting_limitations: true,
  subcontractor_listing_requirements: true,
  dbe_goal_percent: true,
  dbe_requirements: true,
  dvbe_percentage: true,
  small_business_requirements: true,
  disadvantaged_business_requirements: true,
  hazardous_materials: true,
  environmental_requirements: true,
  traffic_control_requirements: true,
  utility_conflicts: true,
  permits_required: true,
  special_equipment: true,
  contact_name: true,
  contact_title: true,
  contact_email: true,
  contact_phone: true,
  contact_department: true,
  addenda_mentioned: true,
  addenda_count: true,
  mandatory_forms: true,
  required_certifications: true,
  summary: true,
  scope_of_work: true,
  key_requirements: true,
  key_deadlines: true,
}) as FieldKey[];

function toEvidenceField(
  field: ClaudeExtractedFields[FieldKey] | null,
): EvidenceField {
  if (field === null) return null;
  return {
    value: field.value,
    pageNumbers: field.pageNumbers,
    sourceExcerpt: field.sourceExcerpt,
  };
}

function isReviewRequired(
  fieldName: string,
  agreement: AgreementClassification,
): boolean {
  if (fieldName === 'working_days' || fieldName === 'calendar_days') {
    return agreement === 'conflict';
  }

  if (!HIGH_RISK_FIELDS.has(fieldName)) {
    return false;
  }

  return (
    agreement === 'conflict' ||
    agreement === 'claude_only' ||
    agreement === 'openai_only'
  );
}

function classifyPresence(
  claudePresent: boolean,
  openaiPresent: boolean,
): AgreementClassification | null {
  if (!claudePresent && !openaiPresent) return 'both_null';
  if (!claudePresent) return 'openai_only';
  if (!openaiPresent) return 'claude_only';
  return null;
}

function compareLists(
  fieldName: FieldKey,
  claudeValues: string[],
  openaiValues: string[],
): { agreement: AgreementClassification; review_reason: string | null } {
  const claudeNorm =
    fieldName === 'license_classifications'
      ? normalizeList(claudeValues.map(normalizeLicenseClassification))
      : normalizeList(claudeValues);
  const openaiNorm =
    fieldName === 'license_classifications'
      ? normalizeList(openaiValues.map(normalizeLicenseClassification))
      : normalizeList(openaiValues);

  if (claudeNorm.join('|') === openaiNorm.join('|')) {
    return { agreement: 'exact_match', review_reason: null };
  }

  const claudeSet = new Set(claudeNorm);
  const openaiSet = new Set(openaiNorm);
  const intersection = claudeNorm.filter((value) => openaiSet.has(value));

  if (intersection.length === 0) {
    return { agreement: 'conflict', review_reason: null };
  }

  const claudeSubset = claudeNorm.every((value) => openaiSet.has(value));
  const openaiSubset = openaiNorm.every((value) => claudeSet.has(value));
  if (claudeSubset || openaiSubset) {
    return { agreement: 'partial_match', review_reason: null };
  }

  return { agreement: 'partial_match', review_reason: null };
}

function buildComparison(
  fieldName: string,
  claudeField: ClaudeExtractedFields[FieldKey] | null,
  openaiField: ClaudeExtractedFields[FieldKey] | null,
  pageCount: number | null,
  agreement: AgreementClassification,
  claudeNormalized: unknown,
  openaiNormalized: unknown,
  reviewReason: string | null,
  extraWarnings: string[] = [],
): FieldComparison {
  const claudeEvidence = toEvidenceField(claudeField);
  const openaiEvidence = toEvidenceField(openaiField);
  const evidence = assessEvidence(fieldName, claudeEvidence, openaiEvidence, pageCount);

  const proposed = getProposedValue(
    agreement,
    claudeField?.value ?? null,
    openaiField?.value ?? null,
  );

  if (extraWarnings.length > 0 && !reviewReason) {
    reviewReason = extraWarnings[0] ?? null;
  }

  return {
    field_name: fieldName,
    claude_value: claudeField?.value ?? null,
    claude_confidence: claudeField?.confidence ?? null,
    claude_page_numbers: claudeField?.pageNumbers ?? null,
    claude_source_excerpt: claudeField?.sourceExcerpt ?? null,
    openai_value: openaiField?.value ?? null,
    openai_confidence: openaiField?.confidence ?? null,
    openai_page_numbers: openaiField?.pageNumbers ?? null,
    openai_source_excerpt: openaiField?.sourceExcerpt ?? null,
    claude_normalized: claudeNormalized,
    openai_normalized: openaiNormalized,
    agreement,
    agreement_score: getAgreementScore(agreement),
    evidence_score: evidence.evidence_score,
    risk_level: getRiskLevel(fieldName, agreement),
    review_required: isReviewRequired(fieldName, agreement),
    review_reason: reviewReason,
    proposed_value: proposed.proposed_value,
    proposed_value_source: proposed.proposed_value_source,
  };
}

function compareSingleField(
  fieldName: FieldKey,
  claudeFields: ClaudeExtractedFields,
  openaiFields: ClaudeExtractedFields,
  pageCount: number | null,
): FieldComparison {
  const claudeField = claudeFields[fieldName];
  const openaiField = openaiFields[fieldName];
  const presence = classifyPresence(claudeField !== null, openaiField !== null);

  if (NOT_COMPARABLE_FIELDS.has(fieldName)) {
    if (presence === 'both_null') {
      return buildComparison(fieldName, claudeField, openaiField, pageCount, 'both_null', null, null, null);
    }
    if (presence === 'claude_only') {
      return buildComparison(fieldName, claudeField, openaiField, pageCount, 'claude_only', claudeField?.value ?? null, null, null);
    }
    if (presence === 'openai_only') {
      return buildComparison(fieldName, claudeField, openaiField, pageCount, 'openai_only', null, openaiField?.value ?? null, null);
    }
    return buildComparison(fieldName, claudeField, openaiField, pageCount, 'not_comparable', null, null, null);
  }

  if (presence) {
    return buildComparison(
      fieldName,
      claudeField,
      openaiField,
      pageCount,
      presence,
      claudeField?.value ?? null,
      openaiField?.value ?? null,
      null,
    );
  }

  const claudeValue = claudeField!.value;
  const openaiValue = openaiField!.value;
  let agreement: AgreementClassification = 'conflict';
  let claudeNormalized: unknown = claudeValue;
  let openaiNormalized: unknown = openaiValue;
  let reviewReason: string | null = null;
  const extraWarnings: string[] = [];

  if (INTEGER_FIELDS.has(fieldName)) {
    claudeNormalized = normalizeCents(claudeValue as number);
    openaiNormalized = normalizeCents(openaiValue as number);
    agreement =
      claudeNormalized === openaiNormalized ? 'exact_match' : 'conflict';

    if (
      agreement === 'conflict' &&
      typeof claudeNormalized === 'number' &&
      typeof openaiNormalized === 'number' &&
      detectCentsMismatch(claudeNormalized, openaiNormalized)
    ) {
      extraWarnings.push(`${fieldName}: possible unit mismatch (cents vs dollars)`);
    }
  } else if (PERCENT_FIELDS.has(fieldName)) {
    agreement =
      Math.abs((claudeValue as number) - (openaiValue as number)) < 0.001
        ? 'exact_match'
        : 'conflict';
    claudeNormalized = claudeValue;
    openaiNormalized = openaiValue;
  } else if (BOOLEAN_FIELDS.has(fieldName)) {
    agreement = claudeValue === openaiValue ? 'exact_match' : 'conflict';
  } else if (DATE_FIELDS.has(fieldName)) {
    const claudeDate = normalizeDate(String(claudeValue));
    const openaiDate = normalizeDate(String(openaiValue));
    claudeNormalized = claudeDate;
    openaiNormalized = openaiDate;

    if (claudeDate === null || openaiDate === null) {
      agreement = 'partial_match';
      reviewReason = 'Date format ambiguous';
    } else if (claudeDate === openaiDate) {
      agreement = 'normalized_match';
    } else {
      agreement = 'conflict';
    }
  } else if (TIME_FIELDS.has(fieldName)) {
    claudeNormalized = normalizeTime(String(claudeValue));
    openaiNormalized = normalizeTime(String(openaiValue));
    agreement =
      claudeNormalized === openaiNormalized ? 'normalized_match' : 'conflict';
  } else if (fieldName === 'contact_email') {
    claudeNormalized = normalizeEmail(String(claudeValue));
    openaiNormalized = normalizeEmail(String(openaiValue));
    agreement =
      claudeNormalized === openaiNormalized ? 'normalized_match' : 'conflict';
  } else if (fieldName === 'contact_phone') {
    claudeNormalized = normalizePhone(String(claudeValue));
    openaiNormalized = normalizePhone(String(openaiValue));
    agreement =
      claudeNormalized === openaiNormalized ? 'exact_match' : 'conflict';
  } else if (LIST_FIELDS.has(fieldName)) {
    const listResult = compareLists(
      fieldName,
      claudeValue as string[],
      openaiValue as string[],
    );
    agreement = listResult.agreement;
    reviewReason = listResult.review_reason;
    claudeNormalized =
      fieldName === 'license_classifications'
        ? normalizeList((claudeValue as string[]).map(normalizeLicenseClassification))
        : normalizeList(claudeValue as string[]);
    openaiNormalized =
      fieldName === 'license_classifications'
        ? normalizeList((openaiValue as string[]).map(normalizeLicenseClassification))
        : normalizeList(openaiValue as string[]);
  } else if (typeof claudeValue === 'string' && typeof openaiValue === 'string') {
    if (claudeValue.trim() === openaiValue.trim()) {
      agreement = 'exact_match';
    } else if (normalizeText(claudeValue) === normalizeText(openaiValue)) {
      agreement = 'normalized_match';
    } else {
      agreement = 'conflict';
    }
    claudeNormalized = normalizeText(claudeValue);
    openaiNormalized = normalizeText(openaiValue);
  } else {
    agreement =
      JSON.stringify(claudeValue) === JSON.stringify(openaiValue)
        ? 'exact_match'
        : 'conflict';
  }

  return buildComparison(
    fieldName,
    claudeField,
    openaiField,
    pageCount,
    agreement,
    claudeNormalized,
    openaiNormalized,
    reviewReason,
    extraWarnings,
  );
}

function compareRiskFlagEntries(
  claudeFlags: ClaudeExtractedRiskFlag[],
  openaiFlags: ClaudeExtractedRiskFlag[],
  pageCount: number | null,
): FieldComparison[] {
  const claudeByType = new Map<string, ClaudeExtractedRiskFlag>();
  const openaiByType = new Map<string, ClaudeExtractedRiskFlag>();

  for (const flag of claudeFlags) {
    claudeByType.set(normalizeText(flag.risk_type), flag);
  }
  for (const flag of openaiFlags) {
    openaiByType.set(normalizeText(flag.risk_type), flag);
  }

  const types = new Set([...claudeByType.keys(), ...openaiByType.keys()]);
  const comparisons: FieldComparison[] = [];

  for (const riskType of [...types].sort()) {
    const claudeFlag = claudeByType.get(riskType) ?? null;
    const openaiFlag = openaiByType.get(riskType) ?? null;
    const claudeField =
      claudeFlag === null
        ? null
        : {
            value: claudeFlag.title,
            confidence: 0.9,
            pageNumbers: claudeFlag.page_number ? [claudeFlag.page_number] : [],
            sourceExcerpt: claudeFlag.source_excerpt,
          };
    const openaiField =
      openaiFlag === null
        ? null
        : {
            value: openaiFlag.title,
            confidence: 0.9,
            pageNumbers: openaiFlag.page_number ? [openaiFlag.page_number] : [],
            sourceExcerpt: openaiFlag.source_excerpt,
          };

    const presence = classifyPresence(claudeField !== null, openaiField !== null);
    let agreement: AgreementClassification = 'conflict';
    if (presence) {
      agreement = presence;
    } else if (
      normalizeText(claudeFlag!.title) === normalizeText(openaiFlag!.title)
    ) {
      agreement = 'normalized_match';
    }

    comparisons.push(
      buildComparison(
        `risk_flags.${riskType}`,
        claudeField,
        openaiField,
        pageCount,
        agreement,
        claudeFlag?.title ?? null,
        openaiFlag?.title ?? null,
        null,
      ),
    );
  }

  const matched = comparisons.filter(
    (entry) => entry.agreement === 'normalized_match' || entry.agreement === 'exact_match',
  ).length;
  const summaryAgreement: AgreementClassification =
    matched === comparisons.length && comparisons.length > 0
      ? 'exact_match'
      : comparisons.some((entry) => entry.agreement === 'conflict')
        ? 'conflict'
        : comparisons.length === 0
          ? 'both_null'
          : 'partial_match';

  comparisons.push({
    field_name: 'risk_flags',
    claude_value: claudeFlags,
    claude_confidence: null,
    claude_page_numbers: null,
    claude_source_excerpt: null,
    openai_value: openaiFlags,
    openai_confidence: null,
    openai_page_numbers: null,
    openai_source_excerpt: null,
    claude_normalized: claudeFlags.length,
    openai_normalized: openaiFlags.length,
    agreement: summaryAgreement,
    agreement_score: getAgreementScore(summaryAgreement),
    evidence_score: summaryAgreement === 'both_null' ? 0 : 0.8,
    risk_level: 'medium',
    review_required: summaryAgreement === 'conflict',
    review_reason: null,
    proposed_value: null,
    proposed_value_source: 'none',
  });

  return comparisons;
}

export function compareFields(
  claudeFields: ClaudeExtractedFields,
  openaiFields: ClaudeExtractedFields,
  pageCount: number | null,
): FieldComparison[] {
  const fieldComparisons = EVIDENCE_FIELD_KEYS.map((fieldName) =>
    compareSingleField(fieldName, claudeFields, openaiFields, pageCount),
  );

  return [
    ...fieldComparisons,
    ...compareRiskFlagEntries(
      claudeFields.risk_flags,
      openaiFields.risk_flags,
      pageCount,
    ),
  ];
}
