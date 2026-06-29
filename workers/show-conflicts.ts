import { loadEnvLocal } from './scraper/env';
import { createAdminClient } from '@/lib/supabase/admin';

loadEnvLocal();

const BID_ID = '49c514b2-3806-4b21-bda5-d60ea8711fa3';

async function main() {
  const s = createAdminClient();
  const { data } = await s
    .from('ai_extraction_comparisons')
    .select('comparison_result')
    .eq('bid_id', BID_ID)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const fc = (data?.comparison_result as Record<string, unknown> & { field_comparisons?: unknown[] })?.field_comparisons ?? [];

  type FC = { field_name: string; agreement: string; claude_value: unknown; openai_value: unknown; proposed_value: unknown };

  const noteworthy = (fc as FC[]).filter(
    (f) => f.agreement !== 'both_null' && f.agreement !== 'not_comparable'
  );

  console.log('\n=== ALL COMPARABLE FIELDS ===');
  noteworthy.forEach((f) => {
    console.log(`[${f.agreement}] ${f.field_name}`);
    console.log(`  claude:   ${JSON.stringify(f.claude_value)}`);
    console.log(`  openai:   ${JSON.stringify(f.openai_value)}`);
    console.log(`  proposed: ${JSON.stringify(f.proposed_value)}`);
  });
}

main().catch(console.error);
