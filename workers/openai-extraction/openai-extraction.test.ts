import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { extractedFieldsSchema } from '../claude-extraction/schema';

const {
  mockCallOpenAIExtraction,
  mockResponsesCreate,
  mockExtractWithOpenAI,
  mockCreateAdminClient,
} = vi.hoisted(() => ({
  mockCallOpenAIExtraction: vi.fn(),
  mockResponsesCreate: vi.fn(),
  mockExtractWithOpenAI: vi.fn(),
  mockCreateAdminClient: vi.fn(),
}));

vi.mock('openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('openai')>();

  class MockOpenAI {
    responses = { create: mockResponsesCreate };

    constructor() {}
  }

  return {
    ...actual,
    default: MockOpenAI,
  };
});

vi.mock('./openai-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./openai-client')>();
  return {
    ...actual,
    callOpenAIExtraction: mockCallOpenAIExtraction,
  };
});

vi.mock('./extract-with-openai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./extract-with-openai')>();
  return {
    ...actual,
    extractWithOpenAI: mockExtractWithOpenAI,
  };
});

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mockCreateAdminClient,
}));

import { APIError } from 'openai';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  extractWithOpenAI,
  ExtractionValidationError,
  type OpenAIExtractionInput,
} from './extract-with-openai';
import {
  ExtractionParseError,
  ExtractionRefusalError,
  callOpenAIExtraction,
} from './openai-client';
import { loadEligibleDocuments, runOpenAIExtraction } from './save-openai-extraction';

const BASE_INPUT: OpenAIExtractionInput = {
  documentId: 'doc-1',
  bidId: 'bid-1',
  bidTitle: 'Test Bridge Project',
  bidAgency: 'Caltrans',
  bidSourceUrl: 'https://example.com/bid',
  priorityText: '=== Page 1 ===\nTest Bridge Project',
  pagesIncluded: [1],
  wasTruncated: false,
  maxPageCount: 10,
};

function evidence<T>(value: T, pageNumbers: number[] = [1]) {
  return {
    value,
    confidence: 0.9,
    pageNumbers,
    sourceExcerpt: 'excerpt',
  };
}

function buildValidRawOutput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = {
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

  return { ...base, ...overrides };
}

function createChainableQuery<T>(result: T) {
  const chain: Record<string, unknown> = {};
  const handler = () => chain;
  for (const method of ['select', 'eq', 'not', 'in', 'order', 'limit', 'filter', 'lt']) {
    chain[method] = vi.fn(handler);
  }
  chain.update = vi.fn(handler);
  chain.insert = vi.fn(handler);
  chain.single = vi.fn(async () => result);
  chain.then = (resolve: (value: T) => void) => Promise.resolve(result).then(resolve);
  return chain;
}

function createSupabaseUpdateMock(
  onUpdate?: (payload: Record<string, unknown>) => void,
) {
  return vi.fn((payload: Record<string, unknown>) => {
    onUpdate?.(payload);

    const resolveTerminal = async () => {
      if (
        typeof payload.error_message === 'string' &&
        payload.error_message.includes('Stale running row')
      ) {
        return { data: null, error: null };
      }
      if (payload.status === 'completed') {
        return {
          data: null,
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint',
          },
        };
      }
      return { data: null, error: null };
    };

    const eqFn = vi.fn((column?: string) => {
      if (column === 'id') {
        return resolveTerminal();
      }
      return { eq: eqFn, lt: vi.fn(resolveTerminal) };
    });

    return { eq: eqFn };
  });
}

function validOpenAIResponse(rawOutput: Record<string, unknown>) {
  return {
    output_text: JSON.stringify(rawOutput),
    output: [],
    usage: { input_tokens: 100, output_tokens: 50 },
    error: null,
    status: 'completed',
  };
}

function makeApiError(status: number, message: string) {
  return APIError.generate(status, undefined, message, new Headers());
}

async function useRealCallOpenAIExtraction() {
  const actual = await vi.importActual<typeof import('./openai-client')>('./openai-client');
  mockCallOpenAIExtraction.mockImplementation(actual.callOpenAIExtraction);
}

async function useRealExtractWithOpenAI() {
  const actual = await vi.importActual<typeof import('./extract-with-openai')>(
    './extract-with-openai',
  );
  mockExtractWithOpenAI.mockImplementation(actual.extractWithOpenAI);
}

describe('extractWithOpenAI', () => {
  beforeEach(async () => {
    mockCallOpenAIExtraction.mockReset();
    mockExtractWithOpenAI.mockReset();
    await useRealExtractWithOpenAI();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  afterEach(() => {
    delete process.env.OPENAI_EXTRACTION_MAX_RETRIES;
  });

  it('Test 1 — successful extraction resolves with confidence > 0', async () => {
    mockCallOpenAIExtraction.mockResolvedValue({
      rawOutput: buildValidRawOutput({
        title: {
          value: 'Test Bridge Project',
          confidence: 0.95,
          pageNumbers: [1],
          sourceExcerpt: 'Test Bridge Project',
        },
        bid_date: {
          value: '2025-08-15',
          confidence: 0.99,
          pageNumbers: [2],
          sourceExcerpt: '2025-08-15',
        },
      }),
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const result = await extractWithOpenAI(BASE_INPUT);

    expect(result.output.overall_confidence).toBeGreaterThan(0);
    expect(result.output.fields.title).not.toBeNull();
    expect(result.output.fields.title?.value).toBe('Test Bridge Project');
    expect(extractedFieldsSchema.safeParse(result.output.fields).success).toBe(true);
  });

  it('Test 2 — all missing fields returned as null', async () => {
    mockCallOpenAIExtraction.mockResolvedValue({
      rawOutput: buildValidRawOutput(),
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await extractWithOpenAI(BASE_INPUT);

    expect(result.output.overall_confidence).toBe(0);
    expect(result.output.fields.title).toBeNull();
    expect(result.output.fields.engineers_estimate_cents).toBeNull();
    expect(
      result.output.warnings.some((warning) => warning.toLowerCase().includes('title')),
    ).toBe(false);
  });

  it('Test 3 — Zod validation failure on malformed response', async () => {
    mockCallOpenAIExtraction.mockResolvedValue({
      rawOutput: { title: 42, risk_flags: [] },
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    let caught: unknown;
    try {
      await extractWithOpenAI(BASE_INPUT);
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ExtractionValidationError);
    expect((caught as ExtractionValidationError).validationErrors.issues.length).toBeGreaterThan(
      0,
    );
  });

  it('Test 4 — out-of-range page number is nulled with a warning', async () => {
    mockCallOpenAIExtraction.mockResolvedValue({
      rawOutput: buildValidRawOutput({
        title: {
          value: 'Test Bridge Project',
          confidence: 0.95,
          pageNumbers: [9999],
          sourceExcerpt: 'Test Bridge Project',
        },
      }),
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    const result = await extractWithOpenAI({ ...BASE_INPUT, maxPageCount: 5 });

    expect(result.output.fields.title).toBeNull();
    expect(result.output.warnings.some((warning) => warning.includes('title'))).toBe(true);
  });

  it('Test 5 — refusal throws ExtractionRefusalError', async () => {
    mockCallOpenAIExtraction.mockRejectedValue(
      new ExtractionRefusalError('content policy violation'),
    );

    await expect(extractWithOpenAI(BASE_INPUT)).rejects.toBeInstanceOf(ExtractionRefusalError);
    await expect(extractWithOpenAI(BASE_INPUT)).rejects.not.toBeInstanceOf(
      ExtractionValidationError,
    );
  });

  it('Test 6 — empty output throws ExtractionParseError', async () => {
    mockCallOpenAIExtraction.mockRejectedValue(
      new ExtractionParseError('OpenAI returned no output text'),
    );

    await expect(extractWithOpenAI(BASE_INPUT)).rejects.toBeInstanceOf(ExtractionParseError);
  });

  it('Test 7 — timeout propagates as a non-validation error', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'TimeoutError';
    mockCallOpenAIExtraction.mockRejectedValue(timeoutError);

    await expect(extractWithOpenAI(BASE_INPUT)).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    await expect(extractWithOpenAI(BASE_INPUT)).rejects.not.toBeInstanceOf(
      ExtractionValidationError,
    );
  });

  it('Test 15 — no Claude result in the OpenAI prompt', async () => {
    mockCallOpenAIExtraction.mockResolvedValue({
      rawOutput: buildValidRawOutput({
        title: evidence('Test Bridge Project'),
      }),
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await extractWithOpenAI(BASE_INPUT);

    const capturedPrompt = mockCallOpenAIExtraction.mock.calls[0]?.[0] as string;
    expect(capturedPrompt).toContain('=== Page');
    expect(capturedPrompt).toContain('Test Bridge Project');
    expect(capturedPrompt).not.toContain('parsed_output');
    expect(capturedPrompt).not.toContain('raw_response');
    expect(capturedPrompt).not.toContain('overall_confidence');
    expect(capturedPrompt).not.toContain('claude-extraction');
    expect(capturedPrompt).not.toContain('claude-sonnet');
    expect(capturedPrompt).not.toContain('provider');
  });

  it('Test 17 — API key never appears in console output', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-supersecret-key-abc123';
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockCallOpenAIExtraction.mockResolvedValue({
      rawOutput: buildValidRawOutput({ title: evidence('Test Bridge Project') }),
      usage: { input_tokens: 1, output_tokens: 1 },
    });

    await extractWithOpenAI(BASE_INPUT);

    for (const call of consoleSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('sk-test-supersecret-key-abc123');
    }

    consoleSpy.mockRestore();
  });
});

describe('callOpenAIExtraction retries', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    mockResponsesCreate.mockReset();
    mockCallOpenAIExtraction.mockReset();
    await useRealCallOpenAIExtraction();
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.OPENAI_EXTRACTION_MAX_RETRIES = '3';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.OPENAI_EXTRACTION_MAX_RETRIES;
  });

  it('Test 8 — 429 triggers retry and succeeds on second attempt', async () => {
    const payload = buildValidRawOutput({ title: evidence('Retry success') });

    mockResponsesCreate
      .mockRejectedValueOnce(makeApiError(429, 'rate limited'))
      .mockResolvedValueOnce(validOpenAIResponse(payload));

    const promise = callOpenAIExtraction('user prompt');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.rawOutput.title).toEqual(payload.title);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(2);
  });

  it('Test 9 — transient 500 triggers retry and succeeds', async () => {
    const payload = buildValidRawOutput({ title: evidence('Server recovered') });

    mockResponsesCreate
      .mockRejectedValueOnce(makeApiError(500, 'server error'))
      .mockResolvedValueOnce(validOpenAIResponse(payload));

    const promise = callOpenAIExtraction('user prompt');
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.rawOutput.title).toEqual(payload.title);
    expect(mockResponsesCreate).toHaveBeenCalledTimes(2);
  });

  it('Test 10 — retry exhaustion after 3 failures', async () => {
    mockResponsesCreate.mockRejectedValue(makeApiError(500, 'server error'));

    const promise = callOpenAIExtraction('user prompt');
    const expectation = expect(promise).rejects.toBeDefined();
    await vi.runAllTimersAsync();
    await expectation;
    expect(mockResponsesCreate).toHaveBeenCalledTimes(3);
  });

  it('Test 11 — 401 is non-retryable (single attempt)', async () => {
    mockResponsesCreate.mockRejectedValueOnce(makeApiError(401, 'unauthorized'));

    await expect(callOpenAIExtraction('user prompt')).rejects.toBeDefined();
    expect(mockResponsesCreate).toHaveBeenCalledTimes(1);
  });
});

describe('loadEligibleDocuments', () => {
  beforeEach(() => {
    mockCreateAdminClient.mockReset();
    vi.mocked(createAdminClient).mockImplementation(mockCreateAdminClient);
  });

  it('Test 12 — already-completed document is excluded from eligibility', async () => {
    const runsQuery = createChainableQuery({
      data: [{ document_id: 'doc-abc-123' }],
      error: null,
    });

    const docsQuery = createChainableQuery({
      data: [],
      error: null,
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'ai_extraction_runs') return runsQuery;
        if (table === 'bid_documents') return docsQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    const docs = await loadEligibleDocuments(
      1,
      'gpt-4o',
      'openai-extraction-v1',
      'extraction-schema-v2',
    );

    expect(docs).toEqual([]);
    expect(docs.some((doc) => doc.documentId === 'doc-abc-123')).toBe(false);
    expect(docsQuery.filter).toHaveBeenCalledWith('id', 'not.in', '(doc-abc-123)');
  });

  it('Test 13 — new prompt version makes completed document eligible again', async () => {
    const runsQueryV2 = createChainableQuery({
      data: [],
      error: null,
    });

    const docsQuery = createChainableQuery({
      data: [
        {
          id: 'doc-abc-123',
          bid_id: 'bid-abc',
          extracted_text: '=== Page 1 ===\nEligible again',
          page_count: 1,
          text_quality: 'good',
          bids: {
            id: 'bid-abc',
            title: 'Eligible Bid',
            agency: 'Caltrans',
            source_url: 'https://example.com/eligible',
          },
        },
      ],
      error: null,
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'ai_extraction_runs') return runsQueryV2;
        if (table === 'bid_documents') return docsQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    const docs = await loadEligibleDocuments(
      1,
      'gpt-4o',
      'openai-extraction-v2',
      'extraction-schema-v2',
    );

    expect(docs).toHaveLength(1);
    expect(docs[0]?.documentId).toBe('doc-abc-123');
  });
});

describe('runOpenAIExtraction orchestration', () => {
  beforeEach(async () => {
    mockCreateAdminClient.mockReset();
    mockExtractWithOpenAI.mockReset();
    vi.mocked(createAdminClient).mockImplementation(mockCreateAdminClient);
    process.env.OPENAI_API_KEY = 'test-key';
    await useRealExtractWithOpenAI();
  });

  it('Test 14 — concurrent worker superseded is counted as skipped, not failed', async () => {
    const runsQuery = createChainableQuery({ data: [], error: null });

    const docsQuery = createChainableQuery({
      data: [
        {
          id: 'doc-pending',
          bid_id: 'bid-1',
          extracted_text: '=== Page 1 ===\nHello world',
          page_count: 1,
          text_quality: 'good',
          bids: {
            id: 'bid-1',
            title: 'Pending Bid',
            agency: 'Caltrans',
            source_url: 'https://example.com/pending',
          },
        },
      ],
      error: null,
    });

    const insertQuery = createChainableQuery({
      data: { id: 'run-superseded' },
      error: null,
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'ai_extraction_runs') {
          return {
            ...runsQuery,
            insert: vi.fn(() => insertQuery),
            update: createSupabaseUpdateMock(),
          };
        }
        if (table === 'bid_documents') return docsQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    mockExtractWithOpenAI.mockResolvedValue({
      output: {
        schema_version: 'extraction-schema-v2',
        prompt_version: 'openai-extraction-v1',
        fields: extractedFieldsSchema.parse(
          buildValidRawOutput({ title: evidence('Pending Bid') }),
        ),
        overall_confidence: 90,
        warnings: [],
        pages_included: [1],
        was_truncated: false,
        processed_at: new Date().toISOString(),
      },
      rawResponse: buildValidRawOutput({ title: evidence('Pending Bid') }),
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const result = await runOpenAIExtraction({ limit: 1 });

    expect(result.documents_skipped).toBe(1);
    expect(result.documents_failed).toBe(0);
    expect(result.documents_extracted).toBe(0);
  });

  it('Test 16 — error message truncated to 500 characters', async () => {
    const longMessage = 'x'.repeat(1000);
    const capturedUpdates: Array<Record<string, unknown>> = [];

    const runsQuery = createChainableQuery({ data: [], error: null });
    const docsQuery = createChainableQuery({
      data: [
        {
          id: 'doc-fail',
          bid_id: 'bid-1',
          extracted_text: '=== Page 1 ===\nFail case',
          page_count: 1,
          text_quality: 'good',
          bids: {
            id: 'bid-1',
            title: 'Fail Bid',
            agency: 'Caltrans',
            source_url: 'https://example.com/fail',
          },
        },
      ],
      error: null,
    });

    const insertQuery = createChainableQuery({
      data: { id: 'run-fail' },
      error: null,
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'ai_extraction_runs') {
          return {
            ...runsQuery,
            insert: vi.fn(() => insertQuery),
            update: createSupabaseUpdateMock((payload) => {
              capturedUpdates.push(payload);
            }),
          };
        }
        if (table === 'bid_documents') return docsQuery;
        throw new Error(`Unexpected table: ${table}`);
      }),
    } as never);

    mockExtractWithOpenAI.mockRejectedValue(new Error(longMessage));

    await runOpenAIExtraction({ limit: 1 });

    const failedUpdate = capturedUpdates.find((update) => update.status === 'failed');
    expect(failedUpdate).toBeDefined();
    expect(String(failedUpdate?.error_message).length).toBeLessThanOrEqual(500);
  });
});
