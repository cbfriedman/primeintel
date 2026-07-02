import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveAlertRecipients } from '@/lib/supabase/preferences';
import { getResendClient, getResendFromAddress } from '@/lib/email/resend-client';
import { buildDigestEmailHtml, type DigestBidSummary } from '@/lib/email/digest-template';

const LOG = (msg: string) => console.log(`[send-digests] ${msg}`);

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

export function isDigestDue(
  frequency: 'instant' | 'daily' | 'weekly',
  lastSentAt: string | null,
  now: Date,
): boolean {
  if (!lastSentAt) return true;

  const elapsed = now.getTime() - new Date(lastSentAt).getTime();

  if (frequency === 'instant') return true;
  if (frequency === 'daily') return elapsed >= DAY_MS;
  return elapsed >= WEEK_MS;
}

type PendingAlertRow = {
  id: string;
  bids: DigestBidSummary | DigestBidSummary[] | null;
};

function resolveJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export async function sendPendingDigests(options: {
  limit: number;
}): Promise<{ digests_sent: number; digests_failed: number }> {
  const { limit } = options;
  const supabase = createAdminClient();
  const now = new Date();

  const recipients = await getActiveAlertRecipients();

  let digestsSent = 0;
  let digestsFailed = 0;
  let processed = 0;

  for (const recipient of recipients) {
    if (processed >= limit) break;
    if (!isDigestDue(recipient.alertFrequency, recipient.lastDigestSentAt, now)) continue;

    processed++;

    try {
      const { data: pending, error: pendingError } = await supabase
        .from('alerts')
        .select(
          `
          id,
          bids (
            id,
            title,
            agency,
            county,
            trade,
            engineers_estimate_cents,
            bid_date
          )
        `,
        )
        .eq('user_id', recipient.userId)
        .eq('channel', 'email')
        .eq('status', 'pending')
        .returns<PendingAlertRow[]>();

      if (pendingError) {
        throw new Error(`Failed to load pending alerts: ${pendingError.message}`);
      }

      const alertRows = pending ?? [];
      if (alertRows.length === 0) continue;

      const bidSummaries = alertRows
        .map((row) => resolveJoin(row.bids))
        .filter((bid): bid is DigestBidSummary => bid !== null);

      if (bidSummaries.length === 0) continue;

      const resend = getResendClient();
      const { error: sendError } = await resend.emails.send({
        from: getResendFromAddress(),
        to: recipient.email,
        subject: `${bidSummaries.length} new bid match${bidSummaries.length === 1 ? '' : 'es'} on PrimeIntel`,
        html: buildDigestEmailHtml(bidSummaries),
      });

      const alertIds = alertRows.map((row) => row.id);

      if (sendError) {
        await supabase
          .from('alerts')
          .update({ status: 'failed', error_message: sendError.message })
          .in('id', alertIds);
        throw new Error(`Resend send failed: ${sendError.message}`);
      }

      await supabase
        .from('alerts')
        .update({ status: 'sent', sent_at: now.toISOString() })
        .in('id', alertIds);

      await supabase
        .from('user_preferences')
        .update({ last_digest_sent_at: now.toISOString() })
        .eq('user_id', recipient.userId);

      digestsSent++;
    } catch (err) {
      LOG(`Failed for recipient ${recipient.userId}: ${err instanceof Error ? err.message : String(err)}`);
      digestsFailed++;
    }
  }

  return { digests_sent: digestsSent, digests_failed: digestsFailed };
}
