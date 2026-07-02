import { createAdminClient } from '@/lib/supabase/admin';
import type { ClaudeExtractedFields, ClaudeExtractedRiskFlag } from '../claude-extraction/schema';

export async function writeRiskFlagsFromComparison(options: {
  bidId: string;
  claudeFields: ClaudeExtractedFields;
}): Promise<void> {
  const { bidId, claudeFields } = options;
  const flags = claudeFields.risk_flags ?? [];

  const supabase = createAdminClient();

  // Replace prior AI-sourced flags for this bid so re-runs stay idempotent.
  const { error: deleteError } = await supabase
    .from('bid_risk_flags')
    .delete()
    .eq('bid_id', bidId)
    .eq('ai_source', 'claude');

  if (deleteError) {
    throw new Error(`Failed to clear existing risk flags for bid ${bidId}: ${deleteError.message}`);
  }

  if (flags.length === 0) return;

  const rows = flags.map((flag: ClaudeExtractedRiskFlag) => ({
    bid_id: bidId,
    risk_type: flag.risk_type,
    severity: flag.severity,
    title: flag.title,
    detail: flag.detail,
    source_excerpt: flag.source_excerpt,
    page_number: flag.page_number,
    ai_source: 'claude' as const,
  }));

  const { error: insertError } = await supabase.from('bid_risk_flags').insert(rows);

  if (insertError) {
    throw new Error(`Failed to insert risk flags for bid ${bidId}: ${insertError.message}`);
  }
}
