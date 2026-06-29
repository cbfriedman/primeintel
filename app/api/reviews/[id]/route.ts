import { NextResponse } from 'next/server';

import { getReviewById, patchReview } from '@/lib/supabase/reviews';
import type { ManualReviewStatus } from '@/types/extraction';

// TODO(step-16): enforce auth — only admin role may access this endpoint

const VALID_STATUSES: ManualReviewStatus[] = [
  'open',
  'in_progress',
  'approved',
  'corrected',
  'failed',
];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  try {
    const review = await getReviewById(id);
    if (!review) {
      return NextResponse.json({ ok: false, error: 'Review not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, review });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch review', details: message },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { status, corrected_fields, reviewer_notes } = body;

  if (
    status === undefined &&
    corrected_fields === undefined &&
    reviewer_notes === undefined
  ) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'Body must include at least one of: status, corrected_fields, reviewer_notes',
      },
      { status: 400 },
    );
  }

  if (status !== undefined && !VALID_STATUSES.includes(status as ManualReviewStatus)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      },
      { status: 400 },
    );
  }

  if (
    corrected_fields !== undefined &&
    (typeof corrected_fields !== 'object' ||
      corrected_fields === null ||
      Array.isArray(corrected_fields))
  ) {
    return NextResponse.json(
      { ok: false, error: 'corrected_fields must be an object' },
      { status: 400 },
    );
  }

  if (reviewer_notes !== undefined && typeof reviewer_notes !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'reviewer_notes must be a string' },
      { status: 400 },
    );
  }

  try {
    const updated = await patchReview(id, {
      status: status as ManualReviewStatus | undefined,
      corrected_fields: corrected_fields as Record<string, unknown> | undefined,
      reviewer_notes: reviewer_notes as string | undefined,
    });
    return NextResponse.json({ ok: true, review: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'Review not found') {
      return NextResponse.json({ ok: false, error: message }, { status: 404 });
    }
    if (message === 'Invalid status transition') {
      return NextResponse.json({ ok: false, error: message }, { status: 400 });
    }
    return NextResponse.json(
      { ok: false, error: 'Failed to update review', details: message },
      { status: 500 },
    );
  }
}
