import { createAdminClient } from '@/lib/supabase/admin';
import { loadEnvLocal } from './scraper/env';

loadEnvLocal();

const BID_ID = '49c514b2-3806-4b21-bda5-d60ea8711fa3';
const supabase = createAdminClient();

async function main() {
  console.log('\n=== BID ===');
  const { data: bid } = await supabase
    .from('bids')
    .select('id, title, extraction_status, extraction_confidence, engineers_estimate_cents, bid_bond_percent, dbe_goal_percent')
    .eq('id', BID_ID)
    .single();
  console.log(bid);

  console.log('\n=== DOCUMENTS ===');
  const { data: docs } = await supabase
    .from('bid_documents')
    .select('id, file_name, document_type, text_extraction_status, text_quality, requires_ocr, extracted_text')
    .eq('bid_id', BID_ID);
  docs?.forEach(d => console.log({
    id: d.id,
    file: d.file_name,
    type: d.document_type,
    text_status: d.text_extraction_status,
    quality: d.text_quality,
    requires_ocr: d.requires_ocr,
    has_text: !!d.extracted_text,
    text_length: d.extracted_text?.length ?? 0,
  }));

  console.log('\n=== AI EXTRACTION RUNS ===');
  const { data: runs } = await supabase
    .from('ai_extraction_runs')
    .select('id, provider, status, model, schema_version, confidence, error_message, completed_at')
    .eq('bid_id', BID_ID)
    .order('created_at', { ascending: true });
  console.log(runs);

  console.log('\n=== COMPARISONS ===');
  const { data: comps } = await supabase
    .from('ai_extraction_comparisons')
    .select('id, status, overall_comparison_confidence, review_status, error_message')
    .eq('bid_id', BID_ID);
  console.log(comps);
}

main().catch(console.error);
