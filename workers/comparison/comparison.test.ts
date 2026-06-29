import { describe, expect, it, vi } from 'vitest';

import type { ClaudeExtractedFields } from '../claude-extraction/schema';
import { compareFields } from './compare-fields';
import {
  COMPARISON_VERSION,
  NORMALIZATION_VERSION,
} from './comparison-schema';
import {
  detectCentsMismatch,
  normalizeDate,
  normalizeList,
  normalizePhone,
  normalizeText,
} from './normalizers';
import { scoreComparison } from './score-comparison';

function evidence<T>(
  value: T,
  pageNumbers: number[] = [1],
  excerpt = 'supporting excerpt',
) {
  return {
    value,
    confidence: 0.95,
    pageNumbers,
    sourceExcerpt: excerpt,
  };
}

function emptyFields(): ClaudeExtractedFields {
  return {
    title: null,
    agency: null,
    county: null,
    city: null,
    contract_number: null,
    project_number: null,
    federal_project_number: null,
    source_bid_number: null,
    bid_date: null,
    bid_time: null,
    pre_bid_meeting_date: null,
    pre_bid_meeting_time: null,
    question_deadline: null,
    anticipated_start_date: null,
    completion_date: null,
    engineers_estimate_cents: null,
    estimated_cost_min_cents: null,
    estimated_cost_max_cents: null,
    bid_bond: null,
    performance_bond: null,
    payment_bond: null,
    retention: null,
    liquidated_damages: null,
    working_days: null,
    calendar_days: null,
    contract_duration: null,
    night_work_required: null,
    license_requirements: null,
    license_classifications: null,
    prevailing_wage_required: null,
    insurance_requirements: null,
    subcontracting_limitations: null,
    subcontractor_listing_requirements: null,
    dbe_goal_percent: null,
    dbe_requirements: null,
    dvbe_percentage: null,
    small_business_requirements: null,
    disadvantaged_business_requirements: null,
    hazardous_materials: null,
    environmental_requirements: null,
    traffic_control_requirements: null,
    utility_conflicts: null,
    permits_required: null,
    special_equipment: null,
    contact_name: null,
    contact_title: null,
    contact_email: null,
    contact_phone: null,
    contact_department: null,
    addenda_mentioned: null,
    addenda_count: null,
    mandatory_forms: null,
    required_certifications: null,
    summary: null,
    scope_of_work: null,
    key_requirements: null,
    key_deadlines: null,
    risk_flags: [],
  };
}

function compareSingleField(
  fieldName: keyof Omit<ClaudeExtractedFields, 'risk_flags'>,
  claude: ClaudeExtractedFields,
  openai: ClaudeExtractedFields,
) {
  const comparisons = compareFields(claude, openai, null);
  return comparisons.find((entry) => entry.field_name === fieldName)!;
}

function fillMatchingFields(
  claude: ClaudeExtractedFields,
  openai: ClaudeExtractedFields,
  overrides?: Partial<Record<keyof ClaudeExtractedFields, unknown>>,
) {
  const entries: Array<[keyof ClaudeExtractedFields, unknown]> = [
    ['title', 'Bridge Project'],
    ['agency', 'City of Sacramento'],
    ['county', 'Sacramento'],
    ['city', 'Sacramento'],
    ['contract_number', 'CN-123'],
    ['project_number', 'PN-456'],
    ['federal_project_number', 'FP-789'],
    ['source_bid_number', 'SB-001'],
    ['bid_date', '2025-08-15'],
    ['bid_time', '2:00 PM'],
    ['pre_bid_meeting_date', '2025-08-01'],
    ['pre_bid_meeting_time', '10:00 AM'],
    ['question_deadline', '2025-08-10'],
    ['anticipated_start_date', '2025-09-01'],
    ['completion_date', '2026-03-01'],
    ['engineers_estimate_cents', 48400000],
    ['estimated_cost_min_cents', 40000000],
    ['estimated_cost_max_cents', 50000000],
    ['bid_bond', '10% of bid amount'],
    ['performance_bond', '100% of contract'],
    ['payment_bond', '100% of contract'],
    ['retention', '5%'],
    ['liquidated_damages', '$5000 per day'],
    ['working_days', 120],
    ['calendar_days', 180],
    ['contract_duration', '120 working days'],
    ['night_work_required', false],
    ['license_requirements', 'Class A required'],
    ['license_classifications', ['A', 'C-10']],
    ['prevailing_wage_required', true],
    ['contact_name', 'Jane Doe'],
    ['contact_title', 'Project Manager'],
    ['contact_email', 'jane@example.com'],
    ['contact_phone', '(916) 555-1234'],
    ['contact_department', 'Public Works'],
    ['addenda_mentioned', ['Addendum 1']],
    ['addenda_count', 1],
    ['mandatory_forms', ['Form A']],
    ['required_certifications', ['DIR Registration']],
    ['dbe_goal_percent', 10],
    ['dvbe_percentage', 3],
  ];

  for (const [field, value] of entries) {
    const finalValue = overrides?.[field] ?? value;
    if (field === 'risk_flags') continue;
    (claude as Record<string, unknown>)[field] = evidence(finalValue);
    (openai as Record<string, unknown>)[field] = evidence(finalValue);
  }
}

function fillLowCoverageMatchingFields(
  claude: ClaudeExtractedFields,
  openai: ClaudeExtractedFields,
) {
  const sparseFields: Array<[keyof ClaudeExtractedFields, unknown]> = [
    ['title', 'Bridge Project'],
    ['agency', 'City of Sacramento'],
    ['county', 'Sacramento'],
    ['contract_number', 'CN-123'],
    ['bid_date', '2025-08-15'],
    ['working_days', 120],
    ['engineers_estimate_cents', 48400000],
    ['license_requirements', 'Class A required'],
    ['prevailing_wage_required', true],
    ['dbe_goal_percent', 10],
  ];

  for (const [field, value] of sparseFields) {
    (claude as Record<string, unknown>)[field] = evidence(value);
    (openai as Record<string, unknown>)[field] = evidence(value);
  }
}

describe('normalizers', () => {
  it('normalizeText trims, collapses whitespace, and lowercases', () => {
    expect(normalizeText(' Hello World ')).toBe('hello world');
  });

  it('normalizeDate parses ISO and long-form dates', () => {
    expect(normalizeDate('2025-08-15')).toBe('2025-08-15');
    expect(normalizeDate('August 15, 2025')).toBe('2025-08-15');
    expect(normalizeDate('not a date')).toBeNull();
  });

  it('normalizePhone strips non-digits', () => {
    expect(normalizePhone('(916) 555-1234')).toBe('9165551234');
  });

  it('normalizeList deduplicates and sorts', () => {
    expect(normalizeList(['B', 'A', 'A', 'C'])).toEqual(['a', 'b', 'c']);
  });

  it('detectCentsMismatch detects 100x differences', () => {
    expect(detectCentsMismatch(48400000, 484000)).toBe(true);
    expect(detectCentsMismatch(48400000, 48400000)).toBe(false);
  });
});

describe('compareFields', () => {
  it('marks both-null fields as both_null without review', () => {
    const result = compareSingleField('title', emptyFields(), emptyFields());
    expect(result.agreement).toBe('both_null');
    expect(result.review_required).toBe(false);
  });

  it('marks identical strings as exact_match', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.title = evidence('Bridge Project');
    openai.title = evidence('Bridge Project');

    const result = compareSingleField('title', claude, openai);
    expect(result.agreement).toBe('exact_match');
  });

  it('marks case-only differences as normalized_match', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.agency = evidence('City of Sacramento');
    openai.agency = evidence('city of sacramento');

    const result = compareSingleField('agency', claude, openai);
    expect(result.agreement).toBe('normalized_match');
  });

  it('marks equal working_days as exact_match', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.working_days = evidence(120);
    openai.working_days = evidence(120);

    const result = compareSingleField('working_days', claude, openai);
    expect(result.agreement).toBe('exact_match');
  });

  it('marks different working_days as conflict with review required', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.working_days = evidence(120);
    openai.working_days = evidence(90);

    const result = compareSingleField('working_days', claude, openai);
    expect(result.agreement).toBe('conflict');
    expect(result.review_required).toBe(true);
  });

  it('marks prevailing_wage_required claude-only correctly', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.prevailing_wage_required = evidence(true);

    const result = compareSingleField('prevailing_wage_required', claude, openai);
    expect(result.agreement).toBe('claude_only');
    expect(result.review_required).toBe(true);
  });

  it('marks both prevailing_wage_required false as exact_match', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.prevailing_wage_required = evidence(false);
    openai.prevailing_wage_required = evidence(false);

    const result = compareSingleField('prevailing_wage_required', claude, openai);
    expect(result.agreement).toBe('exact_match');
  });

  it('marks reordered lists as exact_match after normalization', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.license_classifications = evidence(['C-10', 'A']);
    openai.license_classifications = evidence(['a', 'c-10']);

    const result = compareSingleField('license_classifications', claude, openai);
    expect(result.agreement).toBe('exact_match');
  });

  it('marks partially overlapping lists as partial_match', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.mandatory_forms = evidence(['Form A', 'Form B']);
    openai.mandatory_forms = evidence(['Form B', 'Form C']);

    const result = compareSingleField('mandatory_forms', claude, openai);
    expect(result.agreement).toBe('partial_match');
  });

  it('flags engineers_estimate_cents unit mismatch warnings', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.engineers_estimate_cents = evidence(48400000, [1], '48400000');
    openai.engineers_estimate_cents = evidence(484000, [1], '484000');

    const result = compareSingleField('engineers_estimate_cents', claude, openai);
    expect(result.agreement).toBe('conflict');
    expect(result.review_reason?.toLowerCase()).toContain('unit mismatch');
  });

  it('marks narrative summary fields as not_comparable', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.summary = evidence('Project summary text');
    openai.summary = evidence('Different summary text');

    const result = compareSingleField('summary', claude, openai);
    expect(result.agreement).toBe('not_comparable');
    expect(result.review_required).toBe(false);
  });

  it('normalizes matching bid_date formats', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.bid_date = evidence('2025-08-15');
    openai.bid_date = evidence('August 15, 2025');

    const result = compareSingleField('bid_date', claude, openai);
    expect(result.agreement).toBe('normalized_match');
  });

  it('marks ambiguous bid_date as partial_match', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.bid_date = evidence('2025-08-15');
    openai.bid_date = evidence('not a date');

    const result = compareSingleField('bid_date', claude, openai);
    expect(result.agreement).toBe('partial_match');
    expect(result.review_reason).toContain('ambiguous');
  });

  it('requires review for bid_date claude_only', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.bid_date = evidence('2025-08-15');

    const result = compareSingleField('bid_date', claude, openai);
    expect(result.agreement).toBe('claude_only');
    expect(result.review_required).toBe(true);
  });
});

function scoreMeta(overrides: Partial<Parameters<typeof scoreComparison>[1]> = {}) {
  return {
    documentId: '11111111-1111-4111-8111-111111111111',
    bidId: '22222222-2222-4222-8222-222222222222',
    claudeRunId: '33333333-3333-4333-8333-333333333333',
    openaiRunId: '44444444-4444-4444-8444-444444444444',
    comparisonVersion: COMPARISON_VERSION,
    normalizationVersion: NORMALIZATION_VERSION,
    claudeWasTruncated: false,
    openaiWasTruncated: false,
    claudeWarnings: [],
    openaiWarnings: [],
    ...overrides,
  };
}

describe('scoreComparison', () => {
  it('auto-accepts when all populated fields match exactly', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    fillMatchingFields(claude, openai);

    const scored = scoreComparison(compareFields(claude, openai, null), scoreMeta());
    expect(scored.review_status).toBe('auto_accepted');
    expect(scored.manual_review_required).toBe(false);
  });

  it('requires manual review for high-risk conflicts even at high confidence', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    claude.bid_date = evidence('2025-08-15');
    openai.bid_date = evidence('2025-09-01');
    claude.title = evidence('Bridge Project');
    openai.title = evidence('Bridge Project');
    claude.agency = evidence('City of Sacramento');
    openai.agency = evidence('City of Sacramento');
    claude.county = evidence('Sacramento');
    openai.county = evidence('Sacramento');
    claude.contract_number = evidence('CN-123');
    openai.contract_number = evidence('CN-123');
    claude.working_days = evidence(120);
    openai.working_days = evidence(120);

    const scored = scoreComparison(compareFields(claude, openai, null), scoreMeta());
    expect(scored.high_risk_conflict_count).toBeGreaterThan(0);
    expect(scored.manual_review_required).toBe(true);
    expect(scored.review_status).toBe('manual_review_required');
  });

  it('flags insufficient evidence when coverage is very low', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    fillLowCoverageMatchingFields(claude, openai);

    const scored = scoreComparison(compareFields(claude, openai, null), scoreMeta());
    expect(scored.coverage_score).toBeLessThan(20);
    expect(scored.overall_comparison_confidence).toBeGreaterThanOrEqual(60);
    expect(scored.review_status).toBe('insufficient_evidence');
  });

  it('accepts with warning for non-high-risk conflicts when confidence is high enough', () => {
    const claude = emptyFields();
    const openai = emptyFields();
    fillMatchingFields(claude, openai);
    openai.title = evidence('Different Title');

    const scored = scoreComparison(compareFields(claude, openai, null), scoreMeta());
    expect(scored.conflict_count).toBeGreaterThan(0);
    expect(scored.high_risk_conflict_count).toBe(0);
    expect(scored.overall_comparison_confidence).toBeGreaterThanOrEqual(60);
    expect(scored.review_status).toBe('accepted_with_warning');
  });
});

function lifecyclePairPayload(
  documentId: string,
  bidId: string,
  claudeRunId: string,
  openaiRunId: string,
) {
  const claude = emptyFields();
  const openai = emptyFields();
  fillMatchingFields(claude, openai);

  return {
    documentId,
    bidId,
    claudeRunId,
    openaiRunId,
    claudeParsedOutput: { fields: claude, warnings: [], was_truncated: false },
    openaiParsedOutput: { fields: openai, warnings: [], was_truncated: false },
    claudeWarnings: [],
    openaiWarnings: [],
    claudeWasTruncated: false,
    openaiWasTruncated: false,
    pageCount: 10,
  };
}

function mockSupabaseClient(options: {
  completeError?: { code: string; message: string } | null;
}) {
  return {
    from: () => ({
      update: () => ({
        eq: (column: string) => {
          if (column === 'status') {
            return {
              lt: async () => ({ error: null }),
            };
          }
          return Promise.resolve({ error: options.completeError ?? null });
        },
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({ data: { id: 'comparison-row-id' }, error: null }),
        }),
      }),
    }),
  };
}

describe('runComparison lifecycle', () => {
  it('counts unique constraint violations as skipped', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () =>
        mockSupabaseClient({
          completeError: { code: '23505', message: 'duplicate key value' },
        }),
    }));

    vi.doMock('./load-extraction-pairs', () => ({
      loadEligiblePairs: vi.fn().mockResolvedValue([
        lifecyclePairPayload(
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
          '44444444-4444-4444-8444-444444444444',
        ),
      ]),
    }));

    vi.resetModules();
    const { runComparison } = await import('./save-comparison');
    const result = await runComparison({ limit: 1 });

    expect(result.pairs_skipped).toBe(1);
    expect(result.comparisons_failed).toBe(0);
    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('./load-extraction-pairs');
  });

  it('continues processing after one pair throws during compareFields', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => mockSupabaseClient({ completeError: null }),
    }));

    vi.doMock('./load-extraction-pairs', () => ({
      loadEligiblePairs: vi.fn().mockResolvedValue([
        lifecyclePairPayload(
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
          '33333333-3333-4333-8333-333333333333',
          '44444444-4444-4444-8444-444444444444',
        ),
        lifecyclePairPayload(
          '55555555-5555-4555-8555-555555555555',
          '66666666-6666-4666-8666-666666666666',
          '77777777-7777-4777-8777-777777777777',
          '88888888-8888-4888-8888-888888888888',
        ),
      ]),
    }));

    vi.doMock('./compare-fields', async (importOriginal) => {
      const original = await importOriginal<typeof import('./compare-fields')>();
      let callCount = 0;
      return {
        compareFields: (...args: Parameters<typeof original.compareFields>) => {
          callCount += 1;
          if (callCount === 1) {
            throw new Error('compare failed');
          }
          return original.compareFields(...args);
        },
      };
    });

    vi.resetModules();
    const { runComparison } = await import('./save-comparison');
    const result = await runComparison({ limit: 2 });

    expect(result.comparisons_failed).toBe(1);
    expect(result.comparisons_completed).toBe(1);
    expect(result.pairs_checked).toBe(2);

    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('./load-extraction-pairs');
    vi.doUnmock('./compare-fields');
  });

  it('does not log parsed_output content or API keys', async () => {
    process.env.OPENAI_API_KEY = 'super-secret-key-value';
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => mockSupabaseClient({ completeError: null }),
    }));

    vi.doMock('./load-extraction-pairs', () => ({
      loadEligiblePairs: vi.fn().mockResolvedValue([]),
    }));

    vi.resetModules();
    const { runComparison } = await import('./save-comparison');
    await runComparison({ limit: 1 });

    for (const call of logSpy.mock.calls) {
      const text = call.join(' ');
      expect(text).not.toContain('super-secret-key-value');
      expect(text.toLowerCase()).not.toContain('parsed_output');
    }

    logSpy.mockRestore();
    delete process.env.OPENAI_API_KEY;
    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('./load-extraction-pairs');
  });
});
