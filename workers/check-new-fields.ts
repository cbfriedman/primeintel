import { loadEnvLocal } from './scraper/env';
import { createAdminClient } from '@/lib/supabase/admin';

async function main() {
  loadEnvLocal();
  const s = createAdminClient();
  const { data } = await s
    .from('bids')
    .select('id, title, bid_cap_cents, bid_security_text, perf_payment_bond_text, prevailing_wage_required')
    .eq('id', '49c514b2-3806-4b21-bda5-d60ea8711fa3')
    .single();
  console.log(JSON.stringify(data, null, 2));
}
main().catch(console.error);
