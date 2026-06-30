import { describe, expect, it, vi } from 'vitest';

import type { ManualReview } from '@/types/extraction';

function mockSupabaseClient(opts: {
  review: ManualReview;
  bidUpdateError?: { message: string } | null;
}) {
  const bidUpdates: Array<Record<string, unknown>> = [];

  return {
    client: {
      from: (table: string) => {
        if (table === 'manual_reviews') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({ data: opts.review, error: null }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { ...opts.review, ...patch },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'bids') {
          return {
            update: (patch: Record<string, unknown>) => ({
              eq: async () => {
                bidUpdates.push(patch);
                return { error: opts.bidUpdateError ?? null };
              },
            }),
          };
        }
        throw new Error(`Unexpected table: ${table}`);
      },
    },
    bidUpdates,
  };
}

function baseReview(overrides: Partial<ManualReview> = {}): ManualReview {
  return {
    id: 'review-1',
    bid_id: 'bid-1',
    comparison_id: 'comparison-1',
    status: 'in_progress',
    priority: 'normal',
    reason: null,
    reviewer_notes: null,
    corrected_fields: null,
    resolved_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    claude_extraction_run_id: null,
    openai_extraction_run_id: null,
    ...overrides,
  } as ManualReview;
}

describe('patchReview bid write-back', () => {
  it('marks the bid completed and clears manual_review_required when approved', async () => {
    const { client, bidUpdates } = mockSupabaseClient({ review: baseReview() });
    vi.doMock('./admin', () => ({ createAdminClient: () => client }));

    vi.resetModules();
    const { patchReview } = await import('./reviews');
    await patchReview('review-1', { status: 'approved' });

    expect(bidUpdates).toHaveLength(1);
    expect(bidUpdates[0]).toMatchObject({
      extraction_status: 'completed',
      manual_review_required: false,
    });

    vi.doUnmock('./admin');
  });

  it('applies corrected_fields onto the bid when marked corrected', async () => {
    const { client, bidUpdates } = mockSupabaseClient({ review: baseReview() });
    vi.doMock('./admin', () => ({ createAdminClient: () => client }));

    vi.resetModules();
    const { patchReview } = await import('./reviews');
    await patchReview('review-1', {
      status: 'corrected',
      corrected_fields: { county: 'Orange', engineers_estimate_cents: 500000 },
    });

    expect(bidUpdates[0]).toMatchObject({
      extraction_status: 'completed',
      manual_review_required: false,
      county: 'Orange',
      engineers_estimate_cents: 500000,
    });

    vi.doUnmock('./admin');
  });

  it('marks the bid failed when the review is marked failed', async () => {
    const { client, bidUpdates } = mockSupabaseClient({ review: baseReview() });
    vi.doMock('./admin', () => ({ createAdminClient: () => client }));

    vi.resetModules();
    const { patchReview } = await import('./reviews');
    await patchReview('review-1', { status: 'failed' });

    expect(bidUpdates[0]).toMatchObject({ extraction_status: 'failed' });

    vi.doUnmock('./admin');
  });

  it('does not touch the bid for non-resolving updates like reviewer_notes', async () => {
    const { client, bidUpdates } = mockSupabaseClient({ review: baseReview() });
    vi.doMock('./admin', () => ({ createAdminClient: () => client }));

    vi.resetModules();
    const { patchReview } = await import('./reviews');
    await patchReview('review-1', { reviewer_notes: 'looking into it' });

    expect(bidUpdates).toHaveLength(0);

    vi.doUnmock('./admin');
  });

  it('throws when the bid write-back fails', async () => {
    const { client } = mockSupabaseClient({
      review: baseReview(),
      bidUpdateError: { message: 'db boom' },
    });
    vi.doMock('./admin', () => ({ createAdminClient: () => client }));

    vi.resetModules();
    const { patchReview } = await import('./reviews');

    await expect(patchReview('review-1', { status: 'approved' })).rejects.toThrow('db boom');

    vi.doUnmock('./admin');
  });
});
