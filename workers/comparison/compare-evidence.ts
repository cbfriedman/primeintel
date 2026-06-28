export type EvidenceField = {
  value: unknown;
  pageNumbers: number[];
  sourceExcerpt: string | null;
} | null;

export type EvidenceAssessment = {
  claude_valid: boolean;
  openai_valid: boolean;
  page_overlap: number[];
  evidence_score: number;
  warnings: string[];
};

const NUMERIC_EXCERPT_FIELDS = new Set([
  'engineers_estimate_cents',
  'working_days',
  'calendar_days',
  'dbe_goal_percent',
]);

function hasValidCitation(
  field: EvidenceField,
  pageCount: number | null,
): boolean {
  if (field === null) return false;
  if (!field.pageNumbers.length) return false;
  if (field.pageNumbers.some((page) => page < 1)) return false;
  if (pageCount !== null && field.pageNumbers.some((page) => page > pageCount)) {
    return false;
  }
  return true;
}

function valuesConflict(claude: EvidenceField, openai: EvidenceField): boolean {
  if (claude === null || openai === null) return false;
  return JSON.stringify(claude.value) !== JSON.stringify(openai.value);
}

function numericValueInExcerpt(
  fieldName: string,
  field: EvidenceField,
): boolean {
  if (field === null || field.sourceExcerpt === null) return true;
  if (!NUMERIC_EXCERPT_FIELDS.has(fieldName)) return true;

  const numeric = field.value;
  if (typeof numeric !== 'number') return true;

  const excerpt = field.sourceExcerpt;
  const asString = String(numeric);
  if (excerpt.includes(asString)) return true;

  if (fieldName === 'engineers_estimate_cents') {
    const dollars = (numeric / 100).toLocaleString('en-US');
    if (excerpt.includes(dollars.replace(/,/g, ''))) return true;
    if (excerpt.includes(`$${dollars}`)) return true;
  }

  return false;
}

export function assessEvidence(
  fieldName: string,
  claudeField: EvidenceField,
  openaiField: EvidenceField,
  pageCount: number | null,
): EvidenceAssessment {
  const warnings: string[] = [];
  const claudeValid = hasValidCitation(claudeField, pageCount);
  const openaiValid = hasValidCitation(openaiField, pageCount);

  if (claudeField && !numericValueInExcerpt(fieldName, claudeField)) {
    warnings.push(
      `${fieldName}: Claude sourceExcerpt does not contain the numeric value.`,
    );
  }
  if (openaiField && !numericValueInExcerpt(fieldName, openaiField)) {
    warnings.push(
      `${fieldName}: OpenAI sourceExcerpt does not contain the numeric value.`,
    );
  }

  if (claudeField === null && openaiField === null) {
    return {
      claude_valid: false,
      openai_valid: false,
      page_overlap: [],
      evidence_score: 0,
      warnings,
    };
  }

  if (claudeField !== null && openaiField !== null) {
    const overlap = claudeField.pageNumbers.filter((page) =>
      openaiField.pageNumbers.includes(page),
    );

    if (valuesConflict(claudeField, openaiField)) {
      return {
        claude_valid: claudeValid,
        openai_valid: openaiValid,
        page_overlap: overlap,
        evidence_score: 0.1,
        warnings,
      };
    }

    if (overlap.length > 0) {
      return {
        claude_valid: claudeValid,
        openai_valid: openaiValid,
        page_overlap: overlap,
        evidence_score: 1.0,
        warnings,
      };
    }

    if (claudeValid && openaiValid) {
      return {
        claude_valid: claudeValid,
        openai_valid: openaiValid,
        page_overlap: overlap,
        evidence_score: 0.85,
        warnings,
      };
    }

    return {
      claude_valid: claudeValid,
      openai_valid: openaiValid,
      page_overlap: overlap,
      evidence_score: 0.6,
      warnings,
    };
  }

  if (
    (claudeField !== null && claudeValid) ||
    (openaiField !== null && openaiValid)
  ) {
    return {
      claude_valid: claudeValid,
      openai_valid: openaiValid,
      page_overlap: [],
      evidence_score: 0.5,
      warnings,
    };
  }

  return {
    claude_valid: claudeValid,
    openai_valid: openaiValid,
    page_overlap: [],
    evidence_score: 0.2,
    warnings,
  };
}
