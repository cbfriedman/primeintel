import { describe, expect, it, vi } from 'vitest';

import { matchBidAgainstPreferences, type MatchableBid } from './match-alerts';
import type { AlertRecipient } from '@/lib/supabase/preferences';

function recipient(overrides: Partial<AlertRecipient> = {}): AlertRecipient {
  return {
    userId: 'user-1',
    email: 'user@example.com',
    preferredCounties: [],
    preferredTrades: [],
    minEngineersEstimateCents: null,
    maxEngineersEstimateCents: null,
    alertFrequency: 'instant',
    lastDigestSentAt: null,
    ...overrides,
  };
}

function bid(overrides: Partial<MatchableBid> = {}): MatchableBid {
  return {
    id: 'bid-1',
    county: 'Los Angeles',
    trade: 'Paving',
    engineers_estimate_cents: 50_000_00,
    ...overrides,
  };
}

describe('matchBidAgainstPreferences', () => {
  it('matches when no criteria are set', () => {
    expect(matchBidAgainstPreferences(bid(), recipient()).matched).toBe(true);
  });

  it('matches on county membership (case-insensitive)', () => {
    const result = matchBidAgainstPreferences(
      bid({ county: 'los angeles' }),
      recipient({ preferredCounties: ['Los Angeles', 'Orange'] }),
    );
    expect(result.matched).toBe(true);
    expect(result.reasons).toContain('county');
  });

  it('rejects when county is not in the preferred list', () => {
    const result = matchBidAgainstPreferences(
      bid({ county: 'San Diego' }),
      recipient({ preferredCounties: ['Los Angeles'] }),
    );
    expect(result.matched).toBe(false);
  });

  it('rejects when bid has no county but counties are required', () => {
    const result = matchBidAgainstPreferences(
      bid({ county: null }),
      recipient({ preferredCounties: ['Los Angeles'] }),
    );
    expect(result.matched).toBe(false);
  });

  it('rejects when bid has no trade but trades are required', () => {
    const result = matchBidAgainstPreferences(
      bid({ trade: null }),
      recipient({ preferredTrades: ['Paving'] }),
    );
    expect(result.matched).toBe(false);
  });

  it('rejects when estimate is below the minimum', () => {
    const result = matchBidAgainstPreferences(
      bid({ engineers_estimate_cents: 10_000_00 }),
      recipient({ minEngineersEstimateCents: 20_000_00 }),
    );
    expect(result.matched).toBe(false);
  });

  it('rejects when estimate is above the maximum', () => {
    const result = matchBidAgainstPreferences(
      bid({ engineers_estimate_cents: 90_000_00 }),
      recipient({ maxEngineersEstimateCents: 50_000_00 }),
    );
    expect(result.matched).toBe(false);
  });

  it('rejects when estimate filter is set but bid has no estimate', () => {
    const result = matchBidAgainstPreferences(
      bid({ engineers_estimate_cents: null }),
      recipient({ minEngineersEstimateCents: 1 }),
    );
    expect(result.matched).toBe(false);
  });

  it('matches when all criteria are satisfied together', () => {
    const result = matchBidAgainstPreferences(
      bid({ county: 'Orange', trade: 'Grading', engineers_estimate_cents: 30_000_00 }),
      recipient({
        preferredCounties: ['Orange'],
        preferredTrades: ['Grading'],
        minEngineersEstimateCents: 10_000_00,
        maxEngineersEstimateCents: 40_000_00,
      }),
    );
    expect(result.matched).toBe(true);
    expect(result.reasons).toEqual(['county', 'trade', 'min_estimate', 'max_estimate']);
  });
});

function mockSupabaseClient(opts: {
  bids: MatchableBid[];
  insertError?: { message: string } | null;
  updateError?: { message: string } | null;
}) {
  return {
    from: (table: string) => {
      if (table === 'bids') {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({
                limit: async () => ({ data: opts.bids, error: null }),
              }),
            }),
          }),
          update: () => ({
            eq: async () => ({ error: opts.updateError ?? null }),
          }),
        };
      }
      if (table === 'alerts') {
        return {
          insert: async () => ({ error: opts.insertError ?? null }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

describe('matchAlertsForNewBids', () => {
  it('creates one alert per matching recipient and stamps the bid as processed', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () =>
        mockSupabaseClient({
          bids: [bid({ id: 'bid-a', county: 'Los Angeles' })],
        }),
    }));
    vi.doMock('@/lib/supabase/preferences', () => ({
      getActiveAlertRecipients: vi.fn().mockResolvedValue([
        recipient({ userId: 'user-a', preferredCounties: ['Los Angeles'] }),
        recipient({ userId: 'user-b', preferredCounties: ['San Diego'] }),
      ]),
    }));

    vi.resetModules();
    const { matchAlertsForNewBids } = await import('./match-alerts');
    const result = await matchAlertsForNewBids({ limit: 10 });

    expect(result.bids_processed).toBe(1);
    expect(result.alerts_created).toBe(1);
    expect(result.bids_failed).toBe(0);

    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/supabase/preferences');
  });

  it('counts a bid as failed and does not crash the batch when insert fails', async () => {
    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () =>
        mockSupabaseClient({
          bids: [bid({ id: 'bid-a' }), bid({ id: 'bid-b' })],
          insertError: { message: 'insert boom' },
        }),
    }));
    vi.doMock('@/lib/supabase/preferences', () => ({
      getActiveAlertRecipients: vi.fn().mockResolvedValue([recipient()]),
    }));

    vi.resetModules();
    const { matchAlertsForNewBids } = await import('./match-alerts');
    const result = await matchAlertsForNewBids({ limit: 10 });

    expect(result.bids_processed).toBe(2);
    expect(result.bids_failed).toBe(2);
    expect(result.alerts_created).toBe(0);

    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/supabase/preferences');
  });
});
