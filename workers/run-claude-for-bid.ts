/**
 * Targeted Claude extraction for a specific bid's documents.
 * Usage: npx tsx workers/run-claude-for-bid.ts <bid_id>
 */
import { createHash } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadEnvLocal } from './scraper/env';
import { buildPriorityText } from './text-extraction/build-priority-text';
import { parseStoredTextToPages } from './claude-extraction/parse-stored-pages';
import { getExtractionConfig } from './claude-extraction/extraction-config';
import { extractWithClaude } from './claude-extraction/extract-with-claude';

loadEnvLocal();

const BID_ID = process.argv[2] ?? '49c514b2-3806-4b21-bda5-d60ea8711fa3';
const LOG = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);
const config = getExtractionConfig();

async function main() {
  const supabase = createAdminClient();

  // Load eligible documents for this bid
  const { data: docs, error } = await supabase
    .from('bid_documents')
    .select('id, bid_id, extracted_text, page_count, text_quality, bids!inner(id, title, agency, source_url)')
    .eq('bid_id', BID_ID)
    .eq('text_extraction_status', 'completed')
    .not('extracted_text', 'is', null)
    .eq('requires_ocr', false)
    .in('text_quality', ['good', 'medium']);

  if (error) throw new Error(error.message);
  if (!docs?.length) { LOG('No eligible documents found for this bid'); return; }

  LOG(`Found ${docs.length} eligible document(s)`);

  // Find which doc IDs already have a completed Claude run
  const { data: existingRuns } = await supabase
    .from('ai_extraction_runs')
    .select('document_id')
    .eq('bid_id', BID_ID)
    .eq('provider', 'claude')
    .eq('status', 'completed')
    .eq('model', config.model)
    .eq('schema_version', config.schemaVersion);

  const done = new Set((existingRuns ?? []).map((r: { document_id: string }) => r.document_id));

  for (const doc of docs) {
    if (done.has(doc.id)) { LOG(`Skip ${doc.id}: already extracted`); continue; }

    const bid = Array.isArray(doc.bids) ? doc.bids[0] : doc.bids;
    const pages = parseStoredTextToPages(doc.extracted_text as string);
    if (!pages.length) { LOG(`Skip ${doc.id}: no pages`); continue; }

    const { text: priorityText, pagesIncluded, wasTruncated } = buildPriorityText(pages);
    if (!priorityText.trim()) { LOG(`Skip ${doc.id}: empty priority text`); continue; }

    const sourceTextHash = createHash('sha256').update(priorityText, 'utf8').digest('hex');

    const { data: runRow, error: insertErr } = await supabase
      .from('ai_extraction_runs')
      .insert({
        bid_id: BID_ID,
        document_id: doc.id,
        provider: 'claude',
        model: config.model,
        status: 'running',
        prompt_version: config.promptVersion,
        schema_version: config.schemaVersion,
        source_text_hash: sourceTextHash,
        attempt_count: 1,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertErr) { LOG(`Failed to create run for ${doc.id}: ${insertErr.message}`); continue; }

    try {
      LOG(`Extracting ${doc.id} (${(doc.extracted_text as string).length} chars, ${pagesIncluded.length} pages)...`);
      const { output, rawResponse, usage } = await extractWithClaude({
        documentId: doc.id,
        bidId: BID_ID,
        bidTitle: (bid as { title: string }).title,
        bidAgency: (bid as { agency: string | null }).agency,
        bidSourceUrl: (bid as { source_url: string }).source_url,
        priorityText,
        pagesIncluded,
        wasTruncated,
        maxPageCount: doc.page_count as number | null,
      });

      await supabase.from('ai_extraction_runs').update({
        status: 'completed',
        raw_response: rawResponse,
        parsed_output: output as unknown as Record<string, unknown>,
        warnings: output.warnings,
        confidence: output.overall_confidence,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', runRow.id);

      LOG(`Done: confidence=${output.overall_confidence.toFixed(1)}, tokens=${usage.input_tokens}+${usage.output_tokens}`);
    } catch (err) {
      await supabase.from('ai_extraction_runs').update({
        status: 'failed',
        error_message: (err instanceof Error ? err.message : String(err)).slice(0, 500),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', runRow.id);
      LOG(`Extraction failed for ${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  LOG('All documents processed.');
}

main().catch(console.error);
