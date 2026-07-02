import { describe, expect, it, vi } from 'vitest';

import { isDigestDue } from './send-digests';
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

describe('isDigestDue', () => {
  const now = new Date('2026-06-30T12:00:00Z');

  it('is always due when never sent before', () => {
    expect(isDigestDue('instant', null, now)).toBe(true);
    expect(isDigestDue('daily', null, now)).toBe(true);
    expect(isDigestDue('weekly', null, now)).toBe(true);
  });

  it('instant is always due regardless of last send time', () => {
    expect(isDigestDue('instant', now.toISOString(), now)).toBe(true);
  });

  it('daily is not due before 24 hours have elapsed', () => {
    const lastSent = new Date(now.getTime() - 23 * 60 * 60 * 1000).toISOString();
    expect(isDigestDue('daily', lastSent, now)).toBe(false);
  });

  it('daily is due after 24 hours have elapsed', () => {
    const lastSent = new Date(now.getTime() - 25 * 60 * 60 * 1000).toISOString();
    expect(isDigestDue('daily', lastSent, now)).toBe(true);
  });

  it('weekly is not due before 7 days have elapsed', () => {
    const lastSent = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString();
    expect(isDigestDue('weekly', lastSent, now)).toBe(false);
  });

  it('weekly is due after 7 days have elapsed', () => {
    const lastSent = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString();
    expect(isDigestDue('weekly', lastSent, now)).toBe(true);
  });
});

type PendingAlertRow = {
  id: string;
  bids: {
    id: string;
    title: string;
    agency: string | null;
    county: string | null;
    trade: string | null;
    engineers_estimate_cents: number | null;
    bid_date: string | null;
  } | null;
};

function mockSupabaseClient(opts: {
  pendingAlerts: PendingAlertRow[];
}) {
  const updateCalls: Array<{ table: string; patch: Record<string, unknown> }> = [];

  const client = {
    from: (table: string) => {
      if (table === 'alerts') {
        return {
          select: () => {
            const chain: {
              eq: () => typeof chain;
              returns: () => typeof chain;
              then: (resolve: (v: unknown) => void) => void;
            } = {
              eq: () => chain,
              returns: () => chain,
              then: (resolve: (v: unknown) => void) =>
                resolve({ data: opts.pendingAlerts, error: null }),
            };
            return chain;
          },
          update: (patch: Record<string, unknown>) => ({
            in: async () => {
              updateCalls.push({ table: 'alerts', patch });
              return { error: null };
            },
          }),
        };
      }
      if (table === 'user_preferences') {
        return {
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              updateCalls.push({ table: 'user_preferences', patch });
              return { error: null };
            },
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };

  return { client, updateCalls };
}

describe('sendPendingDigests', () => {
  it('sends a digest, marks alerts sent, and updates last_digest_sent_at', async () => {
    const { client, updateCalls } = mockSupabaseClient({
      pendingAlerts: [
        {
          id: 'alert-1',
          bids: {
            id: 'bid-1',
            title: 'Highway repaving project',
            agency: 'Caltrans',
            county: 'Los Angeles',
            trade: 'Paving',
            engineers_estimate_cents: 100_000_00,
            bid_date: '2026-07-15T00:00:00Z',
          },
        },
      ],
    });

    const sendMock = vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null });

    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => client,
    }));
    vi.doMock('@/lib/supabase/preferences', () => ({
      getActiveAlertRecipients: vi.fn().mockResolvedValue([recipient()]),
    }));
    vi.doMock('@/lib/email/resend-client', () => ({
      getResendClient: () => ({ emails: { send: sendMock } }),
      getResendFromAddress: () => 'PrimeIntel <alerts@example.com>',
    }));

    vi.resetModules();
    const { sendPendingDigests } = await import('./send-digests');
    const result = await sendPendingDigests({ limit: 10 });

    expect(result.digests_sent).toBe(1);
    expect(result.digests_failed).toBe(0);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ table: 'alerts', patch: expect.objectContaining({ status: 'sent' }) }),
    );
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ table: 'user_preferences' }),
    );

    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/supabase/preferences');
    vi.doUnmock('@/lib/email/resend-client');
  });

  it('skips recipients with no pending alerts without sending email', async () => {
    const { client, updateCalls } = mockSupabaseClient({ pendingAlerts: [] });
    const sendMock = vi.fn().mockResolvedValue({ data: { id: 'email-1' }, error: null });

    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => client,
    }));
    vi.doMock('@/lib/supabase/preferences', () => ({
      getActiveAlertRecipients: vi.fn().mockResolvedValue([recipient()]),
    }));
    vi.doMock('@/lib/email/resend-client', () => ({
      getResendClient: () => ({ emails: { send: sendMock } }),
      getResendFromAddress: () => 'PrimeIntel <alerts@example.com>',
    }));

    vi.resetModules();
    const { sendPendingDigests } = await import('./send-digests');
    const result = await sendPendingDigests({ limit: 10 });

    expect(result.digests_sent).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);

    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/supabase/preferences');
    vi.doUnmock('@/lib/email/resend-client');
  });

  it('skips recipients whose digest is not yet due', async () => {
    const { client, updateCalls } = mockSupabaseClient({
      pendingAlerts: [
        {
          id: 'alert-1',
          bids: {
            id: 'bid-1',
            title: 'Bridge repair',
            agency: null,
            county: null,
            trade: null,
            engineers_estimate_cents: null,
            bid_date: null,
          },
        },
      ],
    });
    const sendMock = vi.fn();

    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => client,
    }));
    vi.doMock('@/lib/supabase/preferences', () => ({
      getActiveAlertRecipients: vi.fn().mockResolvedValue([
        recipient({ alertFrequency: 'daily', lastDigestSentAt: new Date().toISOString() }),
      ]),
    }));
    vi.doMock('@/lib/email/resend-client', () => ({
      getResendClient: () => ({ emails: { send: sendMock } }),
      getResendFromAddress: () => 'PrimeIntel <alerts@example.com>',
    }));

    vi.resetModules();
    const { sendPendingDigests } = await import('./send-digests');
    const result = await sendPendingDigests({ limit: 10 });

    expect(result.digests_sent).toBe(0);
    expect(sendMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);

    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/supabase/preferences');
    vi.doUnmock('@/lib/email/resend-client');
  });

  it('marks alerts failed and continues when Resend returns an error', async () => {
    const { client, updateCalls } = mockSupabaseClient({
      pendingAlerts: [
        {
          id: 'alert-1',
          bids: {
            id: 'bid-1',
            title: 'Bridge repair',
            agency: null,
            county: null,
            trade: null,
            engineers_estimate_cents: null,
            bid_date: null,
          },
        },
      ],
    });
    const sendMock = vi.fn().mockResolvedValue({ data: null, error: { message: 'send boom' } });

    vi.doMock('@/lib/supabase/admin', () => ({
      createAdminClient: () => client,
    }));
    vi.doMock('@/lib/supabase/preferences', () => ({
      getActiveAlertRecipients: vi.fn().mockResolvedValue([recipient()]),
    }));
    vi.doMock('@/lib/email/resend-client', () => ({
      getResendClient: () => ({ emails: { send: sendMock } }),
      getResendFromAddress: () => 'PrimeIntel <alerts@example.com>',
    }));

    vi.resetModules();
    const { sendPendingDigests } = await import('./send-digests');
    const result = await sendPendingDigests({ limit: 10 });

    expect(result.digests_sent).toBe(0);
    expect(result.digests_failed).toBe(1);
    expect(updateCalls).toContainEqual(
      expect.objectContaining({ table: 'alerts', patch: expect.objectContaining({ status: 'failed' }) }),
    );

    vi.doUnmock('@/lib/supabase/admin');
    vi.doUnmock('@/lib/supabase/preferences');
    vi.doUnmock('@/lib/email/resend-client');
  });
});
