/**
 * Updates source health fields in the sources table after each connector run.
 * All functions are non-throwing — health update failures are logged but do
 * not propagate, so a DB hiccup cannot kill the scrape pipeline.
 */

import { createAdminClient } from '@/lib/supabase/admin';

const LOG_PREFIX = '[health-updater]';
const FAILURE_WARNING_THRESHOLD = 3;

export async function recordSourceSuccess(
  slug: string,
  projectsFound: number,
): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const update: Record<string, unknown> = {
    last_successful_run_at: now,
    consecutive_failure_count: 0,
    last_failure_reason: null,
    updated_at: now,
  };

  if (projectsFound > 0) {
    update.last_project_discovered_at = now;
  }

  const { error } = await supabase
    .from('sources')
    .update(update)
    .eq('slug', slug);

  if (error) {
    console.error(`${LOG_PREFIX} Failed to record success for ${slug}: ${error.message}`);
  }
}

export async function recordSourceFailure(
  slug: string,
  errorMessage: string,
): Promise<void> {
  const supabase = createAdminClient();

  // Read current count, increment, write back.
  // Not atomic but acceptable — health data is advisory, not transactional.
  const { data: current, error: readError } = await supabase
    .from('sources')
    .select('consecutive_failure_count')
    .eq('slug', slug)
    .single();

  if (readError) {
    console.error(`${LOG_PREFIX} Failed to read failure count for ${slug}: ${readError.message}`);
    return;
  }

  const newCount = ((current?.consecutive_failure_count as number) ?? 0) + 1;
  const now = new Date().toISOString();

  const { error: writeError } = await supabase
    .from('sources')
    .update({
      consecutive_failure_count: newCount,
      last_failure_reason: errorMessage.slice(0, 500),
      last_failed_run_at: now,
      updated_at: now,
    })
    .eq('slug', slug);

  if (writeError) {
    console.error(`${LOG_PREFIX} Failed to write failure for ${slug}: ${writeError.message}`);
    return;
  }

  if (newCount >= FAILURE_WARNING_THRESHOLD) {
    console.warn(
      `${LOG_PREFIX} WARNING: ${slug} has failed ${newCount} consecutive time(s). Check logs and source health.`,
    );
  }
}

export async function incrementSourceTotals(
  slug: string,
  projectsAdded: number,
  documentsAdded: number,
): Promise<void> {
  if (projectsAdded === 0 && documentsAdded === 0) return;

  const supabase = createAdminClient();

  const { data: current, error: readError } = await supabase
    .from('sources')
    .select('total_projects_discovered, total_documents_downloaded')
    .eq('slug', slug)
    .single();

  if (readError || !current) {
    console.error(`${LOG_PREFIX} Failed to read totals for ${slug}: ${readError?.message}`);
    return;
  }

  const { error: writeError } = await supabase
    .from('sources')
    .update({
      total_projects_discovered:
        (current.total_projects_discovered as number) + projectsAdded,
      total_documents_downloaded:
        (current.total_documents_downloaded as number) + documentsAdded,
      updated_at: new Date().toISOString(),
    })
    .eq('slug', slug);

  if (writeError) {
    console.error(`${LOG_PREFIX} Failed to update totals for ${slug}: ${writeError.message}`);
  }
}
