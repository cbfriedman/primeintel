import { createAdminClient } from '@/lib/supabase/admin';
import { SCHEMA_VERSION } from '../claude-extraction/schema';

import {
  COMPARISON_VERSION,
  NORMALIZATION_VERSION,
} from './comparison-schema';

export type ExtractionPair = {
  documentId: string;
  bidId: string;
  claudeRunId: string;
  openaiRunId: string;
  claudeParsedOutput: Record<string, unknown>;
  openaiParsedOutput: Record<string, unknown>;
  claudeWarnings: string[];
  openaiWarnings: string[];
  claudeWasTruncated: boolean;
  openaiWasTruncated: boolean;
  pageCount: number | null;
};

type ExtractionRunRow = {
  id: string;
  bid_id: string;
  document_id: string;
  parsed_output: Record<string, unknown> | null;
  warnings: string[] | null;
  completed_at: string | null;
};

function hasParsedOutput(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export async function loadEligiblePairs(
  limit: number,
): Promise<ExtractionPair[]> {
  const supabase = createAdminClient();

  const { data: completedComparisons, error: comparisonError } = await supabase
    .from('ai_extraction_comparisons')
    .select('claude_run_id, openai_run_id')
    .eq('status', 'completed')
    .eq('comparison_version', COMPARISON_VERSION)
    .eq('normalization_version', NORMALIZATION_VERSION);

  if (comparisonError) {
    throw new Error(
      `Failed to load completed comparisons: ${comparisonError.message}`,
    );
  }

  const completedPairKeys = new Set(
    (completedComparisons ?? []).map(
      (row) => `${row.claude_run_id}:${row.openai_run_id}`,
    ),
  );

  const { data: claudeRuns, error: claudeError } = await supabase
    .from('ai_extraction_runs')
    .select('id, bid_id, document_id, parsed_output, warnings, completed_at')
    .eq('provider', 'claude')
    .eq('status', 'completed')
    .eq('schema_version', SCHEMA_VERSION)
    .not('document_id', 'is', null)
    .not('parsed_output', 'is', null)
    .order('completed_at', { ascending: false });

  if (claudeError) {
    throw new Error(`Failed to load Claude extraction runs: ${claudeError.message}`);
  }

  const { data: openaiRuns, error: openaiError } = await supabase
    .from('ai_extraction_runs')
    .select('id, bid_id, document_id, parsed_output, warnings, completed_at')
    .eq('provider', 'openai')
    .eq('status', 'completed')
    .eq('schema_version', SCHEMA_VERSION)
    .not('document_id', 'is', null)
    .not('parsed_output', 'is', null)
    .order('completed_at', { ascending: false });

  if (openaiError) {
    throw new Error(`Failed to load OpenAI extraction runs: ${openaiError.message}`);
  }

  const claudeByDocument = new Map<string, ExtractionRunRow>();
  for (const row of (claudeRuns ?? []) as ExtractionRunRow[]) {
    if (!row.document_id || claudeByDocument.has(row.document_id)) continue;
    if (!hasParsedOutput(row.parsed_output)) continue;
    claudeByDocument.set(row.document_id, row);
  }

  const openaiByDocument = new Map<string, ExtractionRunRow>();
  for (const row of (openaiRuns ?? []) as ExtractionRunRow[]) {
    if (!row.document_id || openaiByDocument.has(row.document_id)) continue;
    if (!hasParsedOutput(row.parsed_output)) continue;
    openaiByDocument.set(row.document_id, row);
  }

  const candidateDocumentIds = [...claudeByDocument.keys()].filter((documentId) =>
    openaiByDocument.has(documentId),
  );

  if (candidateDocumentIds.length === 0) {
    return [];
  }

  const { data: documents, error: documentsError } = await supabase
    .from('bid_documents')
    .select('id, bid_id, page_count')
    .in('id', candidateDocumentIds);

  if (documentsError) {
    throw new Error(`Failed to load bid documents: ${documentsError.message}`);
  }

  const documentById = new Map(
    (documents ?? []).map((doc) => [
      doc.id as string,
      {
        bidId: doc.bid_id as string,
        pageCount: (doc.page_count as number | null) ?? null,
      },
    ]),
  );

  const pairs: ExtractionPair[] = [];

  for (const documentId of candidateDocumentIds) {
    const claudeRun = claudeByDocument.get(documentId);
    const openaiRun = openaiByDocument.get(documentId);
    if (!claudeRun || !openaiRun) continue;

    const pairKey = `${claudeRun.id}:${openaiRun.id}`;
    if (completedPairKeys.has(pairKey)) continue;

    const documentMeta = documentById.get(documentId);
    const claudeOutput = claudeRun.parsed_output!;
    const openaiOutput = openaiRun.parsed_output!;

    pairs.push({
      documentId,
      bidId: documentMeta?.bidId ?? claudeRun.bid_id,
      claudeRunId: claudeRun.id,
      openaiRunId: openaiRun.id,
      claudeParsedOutput: claudeOutput,
      openaiParsedOutput: openaiOutput,
      claudeWarnings: Array.isArray(claudeOutput.warnings)
        ? (claudeOutput.warnings as string[])
        : Array.isArray(claudeRun.warnings)
          ? (claudeRun.warnings as string[])
          : [],
      openaiWarnings: Array.isArray(openaiOutput.warnings)
        ? (openaiOutput.warnings as string[])
        : Array.isArray(openaiRun.warnings)
          ? (openaiRun.warnings as string[])
          : [],
      claudeWasTruncated: claudeOutput.was_truncated === true,
      openaiWasTruncated: openaiOutput.was_truncated === true,
      pageCount: documentMeta?.pageCount ?? null,
    });

    if (pairs.length >= limit) {
      break;
    }
  }

  return pairs;
}
