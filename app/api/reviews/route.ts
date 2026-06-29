import { NextResponse } from 'next/server';

import { getReviews } from '@/lib/supabase/reviews';
import type { ManualReviewPriority, ManualReviewStatus } from '@/types/extraction';

// TODO(step-16): enforce auth — only admin role may access this endpoint

const VALID_STATUSES: ManualReviewStatus[] = [
  'open',
  'in_progress',
  'approved',
  'corrected',
  'failed',
];
const VALID_PRIORITIES: ManualReviewPriority[] = ['low', 'normal', 'high'];

export async function GET(request: Request): Promise<NextResponse> {
  const { searchParams } = new URL(request.url);

  const statusParam = searchParams.get('status') ?? undefined;
  const priorityParam = searchParams.get('priority') ?? undefined;
  const limitParam = searchParams.get('limit');
  const offsetParam = searchParams.get('offset');

  if (statusParam && !VALID_STATUSES.includes(statusParam as ManualReviewStatus)) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
      },
      { status: 400 },
    );
  }

  if (
    priorityParam &&
    !VALID_PRIORITIES.includes(priorityParam as ManualReviewPriority)
  ) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid priority. Must be one of: ${VALID_PRIORITIES.join(', ')}`,
      },
      { status: 400 },
    );
  }

  const limit = limitParam ? parseInt(limitParam, 10) : 20;
  if (isNaN(limit) || limit < 1 || limit > 100) {
    return NextResponse.json(
      { ok: false, error: 'limit must be an integer between 1 and 100' },
      { status: 400 },
    );
  }

  const offset = offsetParam ? parseInt(offsetParam, 10) : 0;
  if (isNaN(offset) || offset < 0) {
    return NextResponse.json(
      { ok: false, error: 'offset must be a non-negative integer' },
      { status: 400 },
    );
  }

  try {
    const { reviews, total } = await getReviews({
      status: statusParam as ManualReviewStatus | undefined,
      priority: priorityParam as ManualReviewPriority | undefined,
      limit,
      offset,
    });
    return NextResponse.json({ ok: true, reviews, total });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { ok: false, error: 'Failed to fetch reviews', details: message },
      { status: 500 },
    );
  }
}
