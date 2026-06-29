import { createAdminClient } from '@/lib/supabase/admin';
import type { ComparisonResult, FieldComparison } from './comparison-schema';
import type { ClaudeExtractedFields } from '../claude-extraction/schema';

function findProposed(comparisons: FieldComparison[], fieldName: string): unknown {
  return comparisons.find((c) => c.field_name === fieldName)?.proposed_value ?? null;
}

function parseBondPercent(raw: unknown): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const match = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? parseFloat(match[1]!) : null;
}

function parseBondRequired(raw: unknown): boolean | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string') return raw.trim().length > 0;
  return null;
}

function buildDuration(
  contractDuration: unknown,
  workingDays: unknown,
  calendarDays: unknown,
): string | null {
  if (typeof contractDuration === 'string' && contractDuration.trim()) {
    return contractDuration.trim();
  }
  if (typeof workingDays === 'number') return `${workingDays} working days`;
  if (typeof calendarDays === 'number') return `${calendarDays} calendar days`;
  return null;
}

function toDbExtractionStatus(reviewStatus: string): string {
  return reviewStatus === 'auto_accepted' || reviewStatus === 'accepted_with_warning'
    ? 'completed'
    : 'needs_review';
}

export async function writeBidFieldsFromComparison(options: {
  bidId: string;
  comparisonResult: ComparisonResult;
  claudeFields: ClaudeExtractedFields;
}): Promise<void> {
  const { bidId, comparisonResult, claudeFields } = options;
  const fc = comparisonResult.field_comparisons;

  const updates: Record<string, unknown> = {
    extraction_confidence: comparisonResult.overall_comparison_confidence,
    extraction_status: toDbExtractionStatus(comparisonResult.review_status),
    updated_at: new Date().toISOString(),
  };

  // Dates
  const bidDate = findProposed(fc, 'bid_date');
  if (bidDate !== null) updates.bid_date = bidDate;

  const prebidDate = findProposed(fc, 'pre_bid_meeting_date');
  if (prebidDate !== null) updates.prebid_meeting_at = prebidDate;

  const questionDeadline = findProposed(fc, 'question_deadline');
  if (questionDeadline !== null) updates.question_deadline_at = questionDeadline;

  // Financial
  const estimate = findProposed(fc, 'engineers_estimate_cents');
  if (estimate !== null) updates.engineers_estimate_cents = estimate;

  const bidBondPercent = parseBondPercent(findProposed(fc, 'bid_bond'));
  if (bidBondPercent !== null) updates.bid_bond_percent = bidBondPercent;

  const perfBondRequired = parseBondRequired(findProposed(fc, 'performance_bond'));
  if (perfBondRequired !== null) updates.performance_bond_required = perfBondRequired;

  const payBondRequired = parseBondRequired(findProposed(fc, 'payment_bond'));
  if (payBondRequired !== null) updates.payment_bond_required = payBondRequired;

  const liquidatedDamages = findProposed(fc, 'liquidated_damages');
  if (typeof liquidatedDamages === 'string') updates.liquidated_damages = liquidatedDamages;

  // Duration — prefer contract_duration text, fall back to working/calendar days
  const duration = buildDuration(
    findProposed(fc, 'contract_duration'),
    findProposed(fc, 'working_days'),
    findProposed(fc, 'calendar_days'),
  );
  if (duration !== null) updates.project_duration = duration;

  // Requirements
  const licenseReqs = findProposed(fc, 'license_requirements');
  if (typeof licenseReqs === 'string') updates.license_requirements = licenseReqs;

  const dbeGoal = findProposed(fc, 'dbe_goal_percent');
  if (typeof dbeGoal === 'number') updates.dbe_goal_percent = dbeGoal;

  // Contact — not_comparable in comparison engine, use Claude directly
  const contactName = claudeFields.contact_name?.value ?? null;
  if (contactName) updates.contact_name = contactName;

  const contactEmail = claudeFields.contact_email?.value ?? null;
  if (contactEmail) updates.contact_email = contactEmail;

  const contactPhone = claudeFields.contact_phone?.value ?? null;
  if (contactPhone) updates.contact_phone = contactPhone;

  // Description from summary — not_comparable, use Claude directly
  const summary = claudeFields.summary?.value ?? null;
  if (summary) updates.description = summary;

  const supabase = createAdminClient();
  const { error } = await supabase.from('bids').update(updates).eq('id', bidId);

  if (error) {
    throw new Error(`Failed to write extraction fields to bid ${bidId}: ${error.message}`);
  }
}
