import { createAdminClient } from '@/lib/supabase/admin';
import { getActiveAlertRecipients, type AlertRecipient } from '@/lib/supabase/preferences';

const LOG = (msg: string) => console.log(`[match-alerts] ${msg}`);

export type MatchableBid = {
  id: string;
  county: string | null;
  trade: string | null;
  engineers_estimate_cents: number | null;
};

export function matchBidAgainstPreferences(
  bid: MatchableBid,
  prefs: AlertRecipient,
): { matched: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (prefs.preferredCounties.length > 0) {
    if (!bid.county) return { matched: false, reasons: [] };
    const countyMatch = prefs.preferredCounties.some(
      (c) => c.trim().toLowerCase() === bid.county!.trim().toLowerCase(),
    );
    if (!countyMatch) return { matched: false, reasons: [] };
    reasons.push('county');
  }

  if (prefs.preferredTrades.length > 0) {
    if (!bid.trade) return { matched: false, reasons: [] };
    const tradeMatch = prefs.preferredTrades.some(
      (t) => t.trim().toLowerCase() === bid.trade!.trim().toLowerCase(),
    );
    if (!tradeMatch) return { matched: false, reasons: [] };
    reasons.push('trade');
  }

  if (prefs.minEngineersEstimateCents !== null) {
    if (bid.engineers_estimate_cents === null) return { matched: false, reasons: [] };
    if (bid.engineers_estimate_cents < prefs.minEngineersEstimateCents) {
      return { matched: false, reasons: [] };
    }
    reasons.push('min_estimate');
  }

  if (prefs.maxEngineersEstimateCents !== null) {
    if (bid.engineers_estimate_cents === null) return { matched: false, reasons: [] };
    if (bid.engineers_estimate_cents > prefs.maxEngineersEstimateCents) {
      return { matched: false, reasons: [] };
    }
    reasons.push('max_estimate');
  }

  return { matched: true, reasons };
}

export async function matchAlertsForNewBids(options: {
  limit: number;
}): Promise<{ bids_processed: number; alerts_created: number; bids_failed: number }> {
  const { limit } = options;
  const supabase = createAdminClient();

  const recipients = await getActiveAlertRecipients();

  const { data: bids, error: bidsError } = await supabase
    .from('bids')
    .select('id, county, trade, engineers_estimate_cents')
    .eq('extraction_status', 'completed')
    .is('alert_matched_at', null)
    .limit(limit);

  if (bidsError) {
    throw new Error(`Failed to load bids for alert matching: ${bidsError.message}`);
  }

  let alertsCreated = 0;
  let bidsFailed = 0;

  for (const bid of bids ?? []) {
    try {
      const rows = recipients
        .map((recipient) => {
          const { matched, reasons } = matchBidAgainstPreferences(bid, recipient);
          if (!matched) return null;
          return {
            user_id: recipient.userId,
            bid_id: bid.id,
            alert_type: 'new_bid_match',
            channel: 'email' as const,
            status: 'pending' as const,
            title: 'New bid matches your preferences',
            metadata: { reasons },
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length > 0) {
        const { error: insertError } = await supabase.from('alerts').insert(rows);
        if (insertError) {
          throw new Error(`Failed to insert alerts for bid ${bid.id}: ${insertError.message}`);
        }
        alertsCreated += rows.length;
      }

      const { error: updateError } = await supabase
        .from('bids')
        .update({ alert_matched_at: new Date().toISOString() })
        .eq('id', bid.id);

      if (updateError) {
        throw new Error(`Failed to mark bid ${bid.id} as alert-matched: ${updateError.message}`);
      }
    } catch (err) {
      LOG(`Failed for bid ${bid.id}: ${err instanceof Error ? err.message : String(err)}`);
      bidsFailed++;
    }
  }

  return {
    bids_processed: (bids ?? []).length,
    alerts_created: alertsCreated,
    bids_failed: bidsFailed,
  };
}
