export type DigestBidSummary = {
  id: string;
  title: string;
  agency: string | null;
  county: string | null;
  trade: string | null;
  engineersEstimateCents: number | null;
  bidDate: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatEstimate(cents: number | null): string {
  if (cents === null) return 'Not listed';
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function formatBidDate(bidDate: string | null): string {
  if (!bidDate) return 'Not listed';
  const parsed = new Date(bidDate);
  if (Number.isNaN(parsed.getTime())) return 'Not listed';
  return parsed.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function buildDigestEmailHtml(bids: DigestBidSummary[]): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';

  const rows = bids
    .map((bid) => {
      const link = `${appUrl}/bids/${bid.id}`;
      return `
        <tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e4e4e7;">
            <a href="${link}" style="font-size: 15px; font-weight: 600; color: #18181b; text-decoration: none;">
              ${escapeHtml(bid.title)}
            </a>
            <div style="margin-top: 4px; font-size: 13px; color: #71717a;">
              ${escapeHtml(bid.agency ?? 'Agency not listed')}
              ${bid.county ? ` &middot; ${escapeHtml(bid.county)} County` : ''}
              ${bid.trade ? ` &middot; ${escapeHtml(bid.trade)}` : ''}
            </div>
            <div style="margin-top: 4px; font-size: 13px; color: #71717a;">
              Estimate: ${formatEstimate(bid.engineersEstimateCents)} &middot; Bid date: ${formatBidDate(bid.bidDate)}
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  return `
    <div style="font-family: -apple-system, Segoe UI, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h1 style="font-size: 18px; color: #18181b;">New matching bids on PrimeIntel</h1>
      <p style="font-size: 14px; color: #52525b;">
        ${bids.length} bid${bids.length === 1 ? '' : 's'} matched your alert preferences.
      </p>
      <table style="width: 100%; border-collapse: collapse;">
        ${rows}
      </table>
      <p style="margin-top: 24px; font-size: 12px; color: #a1a1aa;">
        Update your alert preferences at ${appUrl}/settings
      </p>
    </div>
  `;
}
