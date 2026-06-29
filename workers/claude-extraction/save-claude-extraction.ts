import { createHash } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';
import { buildPriorityText } from '../text-extraction/build-priority-text';
import { parseStoredTextToPages } from './parse-stored-pages';
import { getExtractionConfig } from './extraction-config';
import {
  extractWithClaude,
  ExtractionValidationError,
  type ClaudeExtractionInput,
} from './extract-with-claude';

const LOG_PREFIX = '[save-claude-extraction]';
const STALE_RUNNING_THRESHOLD_MINUTES = 10;

// ── Types ─────────────────────────────────────────────────────────

type EligibleDocument = {
  documentId: string;
  bidId: string;
  extractedText: string;
  pageCount: number | null;
  textQuality: 'good' | 'medium';
  bidTitle: string;
  bidAgency: string | null;
  bidSourceUrl: string;
};

export type ClaudeExtractionRunResult = {
  documents_checked: number;
  documents_extracted: number;
  documents_skipped: number;
  documents_failed: number;
  errors: string[];
  extractedDocs: Array<{
    documentId: string;
    bidId: string;
    runId: string;
    overallConfidence: number;
    inputTokens: number;
    outputTokens: number;
  }>;
};

export type RunClaudeExtractionOptions = {
  limit?: number;
};

// ── Stale row recovery ────────────────────────────────────────────

async function resetStaleRunningRows(): Promise<void> {
  const supabase = createAdminClient();
  const threshold = new Date(
    Date.now() - STALE_RUNNING_THRESHOLD_MINUTES * 60 * 1000,
  ).toISOString();

  const { error } = await supabase
    .from('ai_extraction_runs')
    .update({
      status: 'failed',
      error_message: `Stale running row reset after ${STALE_RUNNING_THRESHOLD_MINUTES} minutes.`,
      updated_at: new Date().toISOString(),
    })
    .eq('provider', 'claude')
    .eq('status', 'running')
    .lt('started_at', threshold);

  if (error) {
    console.log(`${LOG_PREFIX} Warning: stale row reset failed: ${error.message}`);
  }
}

// ── Eligibility query ─────────────────────────────────────────────

async function loadEligibleDocuments(
  limit: number,
  model: string,
  promptVersion: string,
  schemaVersion: string,
): Promise<EligibleDocument[]> {
  const supabase = createAdminClient();

  type BidRef = { id: string; title: string; agency: string | null; source_url: string };
  type DocRow = {
    id: string;
    bid_id: string;
    extracted_text: string;
    page_count: number | null;
    text_quality: string;
    bids: BidRef | BidRef[];
  };

  function resolveBid(bids: BidRef | BidRef[] | null | undefined): BidRef | null {
    if (!bids) return null;
    return Array.isArray(bids) ? (bids[0] ?? null) : bids;
  }

  // Step 1: Get all completed doc IDs for this exact model+version combo (no text — cheap).
  const { data: completedRuns, error: runsError } = await supabase
    .from('ai_extraction_runs')
    .select('document_id')
    .eq('provider', 'claude')
    .eq('status', 'completed')
    .eq('model', model)
    .eq('prompt_version', promptVersion)
    .eq('schema_version', schemaVersion);

  if (runsError) throw new Error(`Failed to check completed runs: ${runsError.message}`);

  const completedDocIds = (completedRuns ?? [])
    .map((r) => r.document_id as string)
    .filter(Boolean);

  // Step 2: Fetch only unprocessed eligible documents, limited to exactly what we need.
  let candidateQuery = supabase
    .from('bid_documents')
    .select(`
      id,
      bid_id,
      extracted_text,
      page_count,
      text_quality,
      bids!inner (id, title, agency, source_url)
    `)
    .eq('text_extraction_status', 'completed')
    .not('extracted_text', 'is', null)
    .eq('requires_ocr', false)
    .in('text_quality', ['good', 'medium'])
    .order('created_at', { ascending: true })
    .limit(limit);

  if (completedDocIds.length > 0) {
    candidateQuery = candidateQuery.filter('id', 'not.in', `(${completedDocIds.join(',')})`);
  }

  const { data: candidates, error } = await candidateQuery;

  if (error) throw new Error(`Failed to load eligible documents: ${error.message}`);

  const rows = (candidates ?? []) as unknown as DocRow[];

  return rows
    .map((row) => {
      const bid = resolveBid(row.bids);
      if (!bid || !row.extracted_text) return null;
      return {
        documentId: row.id,
        bidId: row.bid_id,
        extractedText: row.extracted_text,
        pageCount: row.page_count,
        textQuality: row.text_quality as 'good' | 'medium',
        bidTitle: bid.title,
        bidAgency: bid.agency,
        bidSourceUrl: bid.source_url,
      };
    })
    .filter((d): d is EligibleDocument => d !== null);
}

// ── DB run lifecycle ──────────────────────────────────────────────

async function createExtractionRun(options: {
  bidId: string;
  documentId: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  sourceTextHash: string;
}): Promise<string> {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from('ai_extraction_runs')
    .insert({
      bid_id: options.bidId,
      document_id: options.documentId,
      provider: 'claude',
      model: options.model,
      status: 'running',
      prompt_version: options.promptVersion,
      schema_version: options.schemaVersion,
      source_text_hash: options.sourceTextHash,
      attempt_count: 1,
      started_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create extraction run: ${error.message}`);
  return data.id as string;
}

async function completeExtractionRun(options: {
  runId: string;
  rawResponse: Record<string, unknown>;
  parsedOutput: Record<string, unknown>;
  warnings: string[];
  confidence: number;
  inputTokens: number;
  outputTokens: number;
}): Promise<{ superseded: boolean }> {
  const supabase = createAdminClient();

  const { error } = await supabase
    .from('ai_extraction_runs')
    .update({
      status: 'completed',
      raw_response: options.rawResponse,
      parsed_output: options.parsedOutput,
      warnings: options.warnings,
      confidence: options.confidence,
      input_tokens: options.inputTokens,
      output_tokens: options.outputTokens,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', options.runId);

  if (error) {
    // Unique constraint violation means another worker already completed this identity
    const isUniqueViolation =
      error.code === '23505' || error.message.includes('unique') || error.message.includes('duplicate');

    if (isUniqueViolation) {
      return { superseded: true };
    }

    console.log(`${LOG_PREFIX} Failed to complete run ${options.runId}: ${error.message}`);
  }

  return { superseded: false };
}

async function failExtractionRun(options: {
  runId: string;
  errorMessage: string;
  validationErrors?: Array<{ path: string; message: string }>;
  reason?: string;
}): Promise<void> {
  const supabase = createAdminClient();

  const message = options.reason
    ? `${options.reason}: ${options.errorMessage}`.slice(0, 500)
    : options.errorMessage.slice(0, 500);

  await supabase
    .from('ai_extraction_runs')
    .update({
      status: 'failed',
      error_message: message,
      validation_errors: options.validationErrors ?? null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', options.runId);
}

// ── Main orchestration loop ───────────────────────────────────────

export async function runClaudeExtraction(
  options: RunClaudeExtractionOptions = {},
): Promise<ClaudeExtractionRunResult> {
  const limit = options.limit ?? 1;
  const config = getExtractionConfig();

  await resetStaleRunningRows();

  const documents = await loadEligibleDocuments(
    limit,
    config.model,
    config.promptVersion,
    config.schemaVersion,
  );

  const errors: string[] = [];
  const extractedDocs: ClaudeExtractionRunResult['extractedDocs'] = [];
  let documents_extracted = 0;
  let documents_skipped = 0;
  let documents_failed = 0;

  console.log(`${LOG_PREFIX} Processing ${documents.length} eligible document(s)...`);

  if (documents.length === 0) {
    console.log(`${LOG_PREFIX} No eligible documents found.`);
    return {
      documents_checked: 0,
      documents_extracted: 0,
      documents_skipped: 0,
      documents_failed: 0,
      errors,
      extractedDocs,
    };
  }

  for (const doc of documents) {
    const label = `document ${doc.documentId} (bid ${doc.bidId})`;
    let runId: string | null = null;

    try {
      const pages = parseStoredTextToPages(doc.extractedText);

      if (pages.length === 0) {
        documents_skipped += 1;
        console.log(`${LOG_PREFIX} Skipped ${label}: no parseable pages in extracted_text.`);
        continue;
      }

      const { text: priorityText, pagesIncluded, wasTruncated } = buildPriorityText(pages);

      if (!priorityText.trim()) {
        documents_skipped += 1;
        console.log(`${LOG_PREFIX} Skipped ${label}: priority text is empty.`);
        continue;
      }

      const sourceTextHash = createHash('sha256')
        .update(priorityText, 'utf8')
        .digest('hex');

      runId = await createExtractionRun({
        bidId: doc.bidId,
        documentId: doc.documentId,
        model: config.model,
        promptVersion: config.promptVersion,
        schemaVersion: config.schemaVersion,
        sourceTextHash,
      });

      const extractionInput: ClaudeExtractionInput = {
        documentId: doc.documentId,
        bidId: doc.bidId,
        bidTitle: doc.bidTitle,
        bidAgency: doc.bidAgency,
        bidSourceUrl: doc.bidSourceUrl,
        priorityText,
        pagesIncluded,
        wasTruncated,
        maxPageCount: doc.pageCount,
      };

      const { output, rawResponse, usage } = await extractWithClaude(extractionInput);

      const { superseded } = await completeExtractionRun({
        runId,
        rawResponse,
        parsedOutput: output as unknown as Record<string, unknown>,
        warnings: output.warnings,
        confidence: output.overall_confidence,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      });

      if (superseded) {
        documents_skipped += 1;
        console.log(`${LOG_PREFIX} Skipped ${label}: superseded by concurrent worker.`);
        await failExtractionRun({ runId, errorMessage: '', reason: 'Superseded by concurrent worker' });
        continue;
      }

      documents_extracted += 1;
      extractedDocs.push({
        documentId: doc.documentId,
        bidId: doc.bidId,
        runId,
        overallConfidence: output.overall_confidence,
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
      });

      console.log(
        `${LOG_PREFIX} Extracted ${label} — ` +
        `confidence=${output.overall_confidence.toFixed(1)}, ` +
        `tokens=${usage.input_tokens}+${usage.output_tokens}, ` +
        `pages=${pagesIncluded.length}${wasTruncated ? ' (truncated)' : ''}`,
      );

      if (output.warnings.length > 0) {
        output.warnings.forEach((w) => console.log(`${LOG_PREFIX}   warning: ${w}`));
      }
    } catch (err) {
      documents_failed += 1;

      let errorMessage: string;
      let validationErrors: Array<{ path: string; message: string }> | undefined;

      if (err instanceof ExtractionValidationError) {
        errorMessage = err.message;
        validationErrors = err.validationErrors.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
        console.log(`${LOG_PREFIX} Validation failed for ${label}: ${errorMessage}`);
      } else {
        errorMessage = err instanceof Error ? err.message : String(err);
        console.log(`${LOG_PREFIX} Extraction failed for ${label}: ${errorMessage}`);
      }

      errors.push(`${label}: ${errorMessage}`);

      if (runId !== null) {
        await failExtractionRun({ runId, errorMessage, validationErrors });
      }
    }
  }

  console.log(
    `${LOG_PREFIX} Done. Checked: ${documents.length}, ` +
    `Extracted: ${documents_extracted}, Skipped: ${documents_skipped}, Failed: ${documents_failed}`,
  );

  return {
    documents_checked: documents.length,
    documents_extracted,
    documents_skipped,
    documents_failed,
    errors,
    extractedDocs,
  };
}
