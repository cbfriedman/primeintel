import type { ClaudeExtractedFields } from './schema';

type AnyFieldEvidence = {
  value: unknown;
  confidence: number;
  pageNumbers: number[];
  sourceExcerpt: string | null;
};

export type PageEvidenceResult = {
  fields: ClaudeExtractedFields;
  warnings: string[];
};

export function validatePageEvidence(
  fields: ClaudeExtractedFields,
  maxPageCount: number | null,
): PageEvidenceResult {
  if (maxPageCount === null || maxPageCount <= 0) {
    return { fields, warnings: [] };
  }

  const warnings: string[] = [];
  const result = { ...fields } as unknown as Record<string, unknown>;

  for (const key of Object.keys(fields)) {
    if (key === 'risk_flags') continue;

    const raw = (fields as unknown as Record<string, unknown>)[key];
    if (raw === null || raw === undefined) continue;

    const evidence = raw as AnyFieldEvidence;
    const badPages = evidence.pageNumbers.filter((p) => p > maxPageCount);

    if (badPages.length > 0) {
      warnings.push(
        `Field "${key}" cleared: page number(s) [${badPages.join(', ')}] exceed document page count (${maxPageCount}).`,
      );
      result[key] = null;
    }
  }

  // Validate page_number inside each risk flag
  const validatedFlags = fields.risk_flags.filter((flag) => {
    if (flag.page_number !== null && flag.page_number > maxPageCount) {
      warnings.push(
        `Risk flag "${flag.title}" page_number (${flag.page_number}) exceeds document page count (${maxPageCount}) — page reference cleared.`,
      );
      return false;
    }
    return true;
  });

  if (validatedFlags.length !== fields.risk_flags.length) {
    result['risk_flags'] = validatedFlags;
  }

  return { fields: result as unknown as ClaudeExtractedFields, warnings };
}
