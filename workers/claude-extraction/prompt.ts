export { parseStoredTextToPages } from './parse-stored-pages';

export const SYSTEM_PROMPT = `You are a data extraction specialist for California public works bid specifications.

Your task: extract specific bid fields from the provided document text.

Rules — follow exactly:
1. Return null for any field not found in the document. Never guess, infer, or estimate.
2. For every non-null field provide:
   - value: the extracted value in the required type
   - confidence: a float from 0.0 (uncertain) to 1.0 (certain)
   - pageNumbers: array of 1-based page numbers where the information appears (required, at least one)
   - sourceExcerpt: a verbatim quote (≤200 characters) from the document that supports the value, or null if quoting is impractical
3. Base all values only on text explicitly present in the document.
4. Do not fabricate or invent sourceExcerpt text. Quote only text that literally appears in the document.
5. pageNumbers must correspond to the === Page N === markers in the input. Do not invent page numbers.

Numeric rules:
6. Dollar amounts must be converted to whole cents. $1,500,000 = 150000000.
7. Percentages must be numeric values. 10% = 10.
8. working_days and calendar_days are separate fields. Use only the type explicitly stated. If the document says "working days", use working_days. If "calendar days", use calendar_days. Do not populate both from one statement.
9. engineers_estimate_cents is the engineer's pre-bid cost estimate, not a bid amount or contract award price.
10. bid_bond, performance_bond, and payment_bond are three distinct fields. Extract each separately only when explicitly stated.
11. liquidated_damages is the per-day penalty for late project completion — always expressed as a dollar amount per calendar day or working day (e.g. "$1,000 per calendar day"). Do NOT capture one-time administrative fees, re-bidding costs, or failure-to-commence penalties — those are not liquidated damages. If no per-day completion penalty is stated, return null.

Date rules:
11. All dates must be ISO 8601 format: YYYY-MM-DD.
12. bid_date is the date bids are due, not the project start date.

Boolean rules:
13. night_work_required is true only if the document explicitly requires night or off-hours work.
14. prevailing_wage_required is true if prevailing wage is explicitly stated as required (this is standard for California public works).

Risk flag rules:
15. Include risk_flags only for explicit contractor risk conditions: hazardous materials, unusually high liquidated damages, non-standard bonding, DBE/SBE requirements, night work, unusual insurance, or special restrictions. Standard clauses do not require risk flags.
16. Return an empty array for risk_flags if no risk conditions are found.

Output rules:
17. Return only the tool call with extracted fields. Do not include explanatory text.
18. Follow the schema exactly. Use null for every absent field.`.trim();

export function buildUserPrompt(options: {
  bidTitle: string;
  bidAgency: string | null;
  bidSourceUrl: string;
  pagesIncluded: number[];
  wasTruncated: boolean;
  priorityText: string;
}): string {
  const truncationNote = options.wasTruncated
    ? '\n(Note: document text was truncated to fit context limits — some pages may be absent.)'
    : '';

  const pageList =
    options.pagesIncluded.length > 0
      ? `Pages included: ${options.pagesIncluded.join(', ')}`
      : 'Pages included: none';

  return [
    `Document: ${options.bidTitle}`,
    `Agency: ${options.bidAgency ?? 'Unknown'}`,
    `Source: ${options.bidSourceUrl}`,
    pageList + truncationNote,
    '',
    '---',
    '',
    options.priorityText,
  ].join('\n');
}
